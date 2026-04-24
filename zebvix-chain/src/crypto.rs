//! Phase B.11 — secp256k1 / ETH-compatible cryptography.
//!
//! Zebvix used Ed25519 through B.10 with a Keccak256-of-32-byte-pubkey address
//! derivation. That gave EVM-shaped addresses but the keys themselves were not
//! interoperable with Ethereum: a single 32-byte secret interpreted as Ed25519
//! vs. secp256k1 produces totally different pubkeys, so the same MetaMask
//! private key gave different addresses on ETH and ZBX.
//!
//! This module is the secp256k1 cutover: one ETH private key now derives the
//! **same 20-byte address** on both Ethereum and ZBX.
//!
//! ## Address derivation (ETH-standard)
//!
//! ```text
//! addr = keccak256( uncompressed_pubkey[1..] )[12..]
//! ```
//!
//! where `uncompressed_pubkey` is `0x04 || X || Y` (65 bytes). We slice off
//! the `0x04` prefix, hash the 64-byte (X||Y) concatenation, and take the
//! last 20 bytes. This matches `eth_address(secp256k1_pubkey)` exactly.
//!
//! ## Wire encoding
//!
//! - **secret**: `[u8; 32]` (unchanged from Ed25519 — both curves use 32-byte secrets)
//! - **public**: `[u8; 33]` *compressed* SEC1 (`0x02|0x03 || X`)
//! - **signature**: `[u8; 64]` *compact* ECDSA (`r || s`, big-endian)
//!
//! Signatures are ECDSA over the SHA-256 hash of `bincode(body)`. We hash with
//! SHA-256 (not Keccak256) because that's the k256 default and matches every
//! standard ECDSA-secp256k1 verifier; the Keccak hashing remains for *address*
//! derivation only (ETH compatibility).

use crate::types::{Address, Hash, SignedTx, TxBody, ADDRESS_LEN};
use k256::ecdsa::{
    signature::{Signer, Verifier},
    Signature, SigningKey, VerifyingKey,
};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use sha3::{Digest, Keccak256};

pub fn keccak256(data: &[u8]) -> Hash {
    let mut h = Keccak256::new();
    h.update(data);
    let out = h.finalize();
    let mut a = [0u8; 32];
    a.copy_from_slice(&out);
    Hash(a)
}

/// ETH-style 20-byte address derivation from a **compressed 33-byte secp256k1
/// pubkey**. The pubkey is decompressed to its full (X, Y) point, prefixed
/// with `0x04`, then we drop that prefix and take `keccak256(X||Y)[12..]`.
///
/// On invalid pubkey bytes we fall back to `Address::ZERO` — the chain's
/// `verify_tx` checks pubkey validity earlier and rejects malformed txs, so
/// this branch should be unreachable for any signed tx that hits the state
/// machine. Tests / CLI keygen produce only valid points.
pub fn address_from_pubkey(pubkey_compressed: &[u8; 33]) -> Address {
    let Ok(vk) = VerifyingKey::from_sec1_bytes(pubkey_compressed) else {
        return Address::ZERO;
    };
    let uncompressed = vk.to_encoded_point(false); // 0x04 || X || Y, 65 bytes
    let bytes = uncompressed.as_bytes();
    debug_assert_eq!(bytes.len(), 65);
    debug_assert_eq!(bytes[0], 0x04);
    let h = keccak256(&bytes[1..]); // hash X||Y (without 0x04 prefix)
    let mut a = [0u8; ADDRESS_LEN];
    a.copy_from_slice(&h.0[12..]);
    Address(a)
}

/// Generate a fresh secp256k1 keypair using OS RNG.
/// Returns `(secret_32B, compressed_pubkey_33B)`.
pub fn generate_keypair() -> ([u8; 32], [u8; 33]) {
    let sk = SigningKey::random(&mut rand::rngs::OsRng);
    let mut sec = [0u8; 32];
    sec.copy_from_slice(&sk.to_bytes());
    let pk = compressed_from_signing(&sk);
    (sec, pk)
}

/// Recover `(secret, compressed_pubkey)` from a known 32-byte secret.
/// Returns the same `secret` bytes back so callers can store them
/// uniformly (matches the previous Ed25519 API).
pub fn keypair_from_secret(secret: &[u8; 32]) -> ([u8; 32], [u8; 33]) {
    let sk = SigningKey::from_bytes(secret.into())
        .expect("secret must be a valid secp256k1 scalar (non-zero, < curve order)");
    (*secret, compressed_from_signing(&sk))
}

fn compressed_from_signing(sk: &SigningKey) -> [u8; 33] {
    let vk = sk.verifying_key();
    let enc = vk.to_encoded_point(true); // compressed
    let bytes = enc.as_bytes();
    debug_assert_eq!(bytes.len(), 33);
    let mut out = [0u8; 33];
    out.copy_from_slice(bytes);
    out
}

/// Sign an arbitrary message with an ECDSA-secp256k1 secret. Returns the
/// 64-byte compact (r || s) signature.
pub fn sign_bytes(secret: &[u8; 32], msg: &[u8]) -> [u8; 64] {
    let sk = SigningKey::from_bytes(secret.into())
        .expect("secret must be a valid secp256k1 scalar");
    let sig: Signature = sk.sign(msg); // RFC6979 deterministic, hashes with SHA-256
    let bytes = sig.to_bytes();
    let mut out = [0u8; 64];
    out.copy_from_slice(&bytes);
    out
}

/// Verify a 64-byte ECDSA-secp256k1 signature against a 33-byte compressed pubkey.
pub fn verify_signature(pubkey: &[u8; 33], msg: &[u8], sig: &[u8; 64]) -> bool {
    let Ok(vk) = VerifyingKey::from_sec1_bytes(pubkey) else { return false };
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

/// Parallel verification of many signed transactions.
///
/// k256 has no batch-verify primitive (ECDSA-secp256k1 doesn't admit one
/// without recovery), so we just parallelize per-tx verification across
/// all CPU cores via rayon. On any failure we short-circuit and return false.
pub fn verify_txs_batch(txs: &[SignedTx]) -> bool {
    use rayon::prelude::*;
    if txs.is_empty() {
        return true;
    }
    txs.par_iter().all(verify_tx)
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
        let body = TxBody {
            from,
            to: Address::ZERO,
            amount: 100,
            nonce: 0,
            fee: 1,
            chain_id: 7878,
            kind: crate::types::TxKind::Transfer,
        };
        let tx = sign_tx(&sk, body);
        assert!(verify_tx(&tx));
    }
    /// ETH compat: a known secret derives the canonical Ethereum address.
    /// Test vector from go-ethereum docs:
    ///   sk = 4646464646464646464646464646464646464646464646464646464646464646
    ///   addr = 0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f
    #[test]
    fn matches_eth_test_vector() {
        let sk_hex = "4646464646464646464646464646464646464646464646464646464646464646";
        let sk_bytes = hex::decode(sk_hex).unwrap();
        let mut sk = [0u8; 32];
        sk.copy_from_slice(&sk_bytes);
        let (_, pk) = keypair_from_secret(&sk);
        let addr = address_from_pubkey(&pk);
        assert_eq!(addr.to_hex(), "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f");
    }
}
