use crate::types::{Address, Hash, SignedTx, TxBody, ADDRESS_LEN};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha3::{Digest, Keccak256};

pub fn keccak256(data: &[u8]) -> Hash {
    let mut h = Keccak256::new();
    h.update(data);
    let out = h.finalize();
    let mut a = [0u8; 32];
    a.copy_from_slice(&out);
    Hash(a)
}

/// EVM-style 20-byte address: last 20 bytes of Keccak256(pubkey).
pub fn address_from_pubkey(pubkey: &[u8; 32]) -> Address {
    let h = keccak256(pubkey);
    let mut a = [0u8; ADDRESS_LEN];
    a.copy_from_slice(&h.0[12..]);
    Address(a)
}

pub fn generate_keypair() -> ([u8; 32], [u8; 32]) {
    let mut csprng = rand::rngs::OsRng;
    let sk = SigningKey::generate(&mut csprng);
    let vk: VerifyingKey = sk.verifying_key();
    (sk.to_bytes(), vk.to_bytes())
}

pub fn keypair_from_secret(secret: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    let sk = SigningKey::from_bytes(secret);
    let vk = sk.verifying_key();
    (sk.to_bytes(), vk.to_bytes())
}

pub fn sign_bytes(secret: &[u8; 32], msg: &[u8]) -> [u8; 64] {
    let sk = SigningKey::from_bytes(secret);
    sk.sign(msg).to_bytes()
}

pub fn verify_signature(pubkey: &[u8; 32], msg: &[u8], sig: &[u8; 64]) -> bool {
    let Ok(vk) = VerifyingKey::from_bytes(pubkey) else { return false };
    let Ok(sig) = Signature::from_slice(sig) else { return false };
    vk.verify(msg, &sig).is_ok()
}

/// Canonical bytes for signing a tx body (BCS-style via bincode).
pub fn tx_signing_bytes(body: &TxBody) -> Vec<u8> {
    bincode::serialize(body).expect("body serialization cannot fail")
}

pub fn sign_tx(secret: &[u8; 32], body: TxBody) -> SignedTx {
    let (_, pubkey) = keypair_from_secret(secret);
    let msg = tx_signing_bytes(&body);
    let signature = sign_bytes(secret, &msg);
    SignedTx { body, pubkey, signature }
}

pub fn verify_tx(tx: &SignedTx) -> bool {
    if address_from_pubkey(&tx.pubkey) != tx.body.from {
        return false;
    }
    let msg = tx_signing_bytes(&tx.body);
    verify_signature(&tx.pubkey, &msg, &tx.signature)
}

/// High-throughput batch verification of many signed transactions.
///
/// Uses two stacked optimizations:
///   1. **Rayon parallel iterator** — distributes work across all CPU cores.
///   2. **ed25519-dalek batch verify** — verifies a chunk of signatures in a single
///      multi-scalar multiplication, which is ~3-5x faster than individual `verify`.
///
/// Returns `true` only if **every** tx is valid (matching `from`/`pubkey` and a
/// valid Ed25519 signature). On any failure it short-circuits and returns `false`.
pub fn verify_txs_batch(txs: &[SignedTx]) -> bool {
    use ed25519_dalek::{Signature, VerifyingKey};
    use rayon::prelude::*;

    if txs.is_empty() {
        return true;
    }

    // Step 1 — parallel from/pubkey binding check (cheap, parallel-safe).
    let binding_ok = txs
        .par_iter()
        .all(|tx| address_from_pubkey(&tx.pubkey) == tx.body.from);
    if !binding_ok {
        return false;
    }

    // Step 2 — split into chunks; each chunk is batch-verified on a worker thread.
    const BATCH_CHUNK: usize = 64;
    txs.par_chunks(BATCH_CHUNK).all(|chunk| {
        let mut msgs: Vec<Vec<u8>> = Vec::with_capacity(chunk.len());
        let mut sigs: Vec<Signature> = Vec::with_capacity(chunk.len());
        let mut keys: Vec<VerifyingKey> = Vec::with_capacity(chunk.len());

        for tx in chunk {
            msgs.push(tx_signing_bytes(&tx.body));
            let Ok(sig) = Signature::from_slice(&tx.signature) else { return false };
            let Ok(vk) = VerifyingKey::from_bytes(&tx.pubkey) else { return false };
            sigs.push(sig);
            keys.push(vk);
        }
        let msg_refs: Vec<&[u8]> = msgs.iter().map(|m| m.as_slice()).collect();
        ed25519_dalek::verify_batch(&msg_refs, &sigs, &keys).is_ok()
    })
}

pub fn tx_hash(tx: &SignedTx) -> Hash {
    let bytes = bincode::serialize(tx).expect("tx ser cannot fail");
    keccak256(&bytes)
}

pub fn header_signing_bytes(header: &crate::types::BlockHeader) -> Vec<u8> {
    bincode::serialize(header).expect("header ser cannot fail")
}

pub fn block_hash(header: &crate::types::BlockHeader) -> Hash {
    keccak256(&header_signing_bytes(header))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn address_is_20_bytes() {
        let (_, pk) = generate_keypair();
        let a = address_from_pubkey(&pk);
        assert_eq!(a.0.len(), 20);
    }
    #[test]
    fn sign_and_verify_roundtrip() {
        let (sk, pk) = generate_keypair();
        let from = address_from_pubkey(&pk);
        let body = TxBody { from, to: Address::ZERO, amount: 100, nonce: 0, fee: 1, chain_id: 7777 };
        let tx = sign_tx(&sk, body);
        assert!(verify_tx(&tx));
    }
}
