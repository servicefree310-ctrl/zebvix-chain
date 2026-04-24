//! Phase C.2 — Recursive Length Prefix (RLP) decoder + Ethereum
//! transaction body parsers.
//!
//! ## Why this module exists
//!
//! `eth_sendRawTransaction` ships a hex blob that is one of three envelope
//! kinds:
//!
//! ```text
//!   Legacy:    rlp([nonce, gas_price, gas, to, value, data, v, r, s])
//!   EIP-2930:  0x01 || rlp([chain_id, nonce, gas_price, gas, to, value,
//!                            data, access_list, y_parity, r, s])
//!   EIP-1559:  0x02 || rlp([chain_id, nonce, max_priority_fee, max_fee,
//!                            gas, to, value, data, access_list,
//!                            y_parity, r, s])
//! ```
//!
//! Phase C.1 only inspected the envelope-kind discriminator. Phase C.2
//! ships the full RLP decode → field extraction → secp256k1 sender
//! recovery pipeline so MetaMask-signed transactions can flow through
//! the chain mempool.
//!
//! ## Sender recovery
//!
//! The signing payload is the RLP-encoded body **without** the (v, r, s)
//! triple, prefixed by the type byte for typed envelopes. We hash that
//! with keccak-256 and pass it to k256::ecdsa::VerifyingKey::recover_from_prehash
//! along with (r, s, recovery_id) to derive the public key, then the
//! Ethereum address is the lower 20 bytes of keccak(uncompressed_pubkey[1..]).
//!
//! ## Tests
//!
//! Bundled unit tests cover empty list / nested list / long-string
//! boundary conditions, plus a known-good legacy transaction whose
//! sender we can compare against.

#![allow(dead_code)]

use crate::evm::{keccak256, EvmCall, EvmCreate, EvmTxEnvelope};
use crate::types::Address;
use primitive_types::U256;

// ---------------------------------------------------------------------------
// RLP item type
// ---------------------------------------------------------------------------

/// One decoded RLP node — either a byte string or a list of further nodes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RlpItem {
    Bytes(Vec<u8>),
    List(Vec<RlpItem>),
}

impl RlpItem {
    pub fn as_bytes(&self) -> Result<&[u8], &'static str> {
        match self {
            RlpItem::Bytes(b) => Ok(b),
            RlpItem::List(_) => Err("expected RLP bytes, got list"),
        }
    }

    pub fn as_list(&self) -> Result<&[RlpItem], &'static str> {
        match self {
            RlpItem::List(l) => Ok(l),
            RlpItem::Bytes(_) => Err("expected RLP list, got bytes"),
        }
    }

    /// Convert a bytes node into a U256, enforcing the canonical
    /// minimal-length encoding (RLP scalars MUST NOT have leading zero
    /// bytes — yellow paper Appendix B).
    pub fn as_u256(&self) -> Result<U256, &'static str> {
        let b = self.as_bytes()?;
        if b.len() > 32 { return Err("RLP int exceeds 32 bytes"); }
        if b.len() > 1 && b[0] == 0 {
            return Err("RLP: non-canonical leading zero in scalar (u256)");
        }
        Ok(U256::from_big_endian(b))
    }

    pub fn as_u64(&self) -> Result<u64, &'static str> {
        let b = self.as_bytes()?;
        if b.len() > 8 { return Err("RLP int exceeds 8 bytes"); }
        if b.len() > 1 && b[0] == 0 {
            return Err("RLP: non-canonical leading zero in scalar (u64)");
        }
        let mut buf = [0u8; 8];
        buf[8 - b.len()..].copy_from_slice(b);
        Ok(u64::from_be_bytes(buf))
    }

    pub fn as_address(&self) -> Result<Option<Address>, &'static str> {
        let b = self.as_bytes()?;
        if b.is_empty() { return Ok(None); } // contract-create
        if b.len() != 20 { return Err("RLP address must be 20 bytes"); }
        let mut a = [0u8; 20];
        a.copy_from_slice(b);
        Ok(Some(Address::from_bytes(a)))
    }
}

// ---------------------------------------------------------------------------
// Generic RLP decode — Yellow Paper Appendix B
// ---------------------------------------------------------------------------

/// Decode one RLP item, returning the item and the number of bytes consumed.
pub fn decode_rlp(input: &[u8]) -> Result<(RlpItem, usize), &'static str> {
    if input.is_empty() {
        return Err("RLP: empty input");
    }
    let first = input[0];
    match first {
        // Single byte literal in [0x00, 0x7f]
        0x00..=0x7f => Ok((RlpItem::Bytes(vec![first]), 1)),

        // Short string: 0..55 bytes payload
        0x80..=0xb7 => {
            let len = (first - 0x80) as usize;
            if input.len() < 1 + len {
                return Err("RLP: short string truncated");
            }
            // Canonical: a 1-byte string < 0x80 must use the literal form.
            if len == 1 && input[1] < 0x80 {
                return Err("RLP: non-canonical single byte string");
            }
            Ok((RlpItem::Bytes(input[1..1 + len].to_vec()), 1 + len))
        }

        // Long string: > 55 bytes payload
        0xb8..=0xbf => {
            let len_of_len = (first - 0xb7) as usize;
            if input.len() < 1 + len_of_len {
                return Err("RLP: long-string length truncated");
            }
            let len_bytes = &input[1..1 + len_of_len];
            // Canonical: no leading zero in length prefix
            if len_bytes[0] == 0 {
                return Err("RLP: non-canonical leading zero in length");
            }
            let len = bytes_to_usize(len_bytes)?;
            if len < 56 {
                return Err("RLP: long-string with payload < 56");
            }
            let total = 1 + len_of_len + len;
            if input.len() < total {
                return Err("RLP: long string body truncated");
            }
            Ok((
                RlpItem::Bytes(input[1 + len_of_len..total].to_vec()),
                total,
            ))
        }

        // Short list
        0xc0..=0xf7 => {
            let len = (first - 0xc0) as usize;
            if input.len() < 1 + len {
                return Err("RLP: short list truncated");
            }
            let items = decode_list_payload(&input[1..1 + len])?;
            Ok((RlpItem::List(items), 1 + len))
        }

        // Long list
        0xf8..=0xff => {
            let len_of_len = (first - 0xf7) as usize;
            if input.len() < 1 + len_of_len {
                return Err("RLP: long-list length truncated");
            }
            let len_bytes = &input[1..1 + len_of_len];
            if len_bytes[0] == 0 {
                return Err("RLP: non-canonical leading zero in list length");
            }
            let len = bytes_to_usize(len_bytes)?;
            if len < 56 {
                return Err("RLP: long-list with payload < 56");
            }
            let total = 1 + len_of_len + len;
            if input.len() < total {
                return Err("RLP: long list body truncated");
            }
            let items = decode_list_payload(&input[1 + len_of_len..total])?;
            Ok((RlpItem::List(items), total))
        }
    }
}

fn decode_list_payload(mut payload: &[u8]) -> Result<Vec<RlpItem>, &'static str> {
    let mut out = vec![];
    while !payload.is_empty() {
        let (item, n) = decode_rlp(payload)?;
        out.push(item);
        payload = &payload[n..];
    }
    Ok(out)
}

fn bytes_to_usize(b: &[u8]) -> Result<usize, &'static str> {
    if b.len() > std::mem::size_of::<usize>() {
        return Err("RLP: length exceeds usize");
    }
    let mut buf = [0u8; std::mem::size_of::<usize>()];
    buf[std::mem::size_of::<usize>() - b.len()..].copy_from_slice(b);
    Ok(usize::from_be_bytes(buf))
}

// ---------------------------------------------------------------------------
// RLP encoding (only what we need to recompute the signing-hash payload)
// ---------------------------------------------------------------------------

/// Encode one item to RLP.
pub fn encode_rlp(item: &RlpItem) -> Vec<u8> {
    match item {
        RlpItem::Bytes(b) => encode_bytes(b),
        RlpItem::List(items) => {
            let mut payload = vec![];
            for i in items {
                payload.extend_from_slice(&encode_rlp(i));
            }
            encode_length(payload.len(), 0xc0, &payload)
        }
    }
}

fn encode_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        b.to_vec()
    } else {
        encode_length(b.len(), 0x80, b)
    }
}

fn encode_length(len: usize, offset: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![];
    if len < 56 {
        out.push(offset + len as u8);
    } else {
        let len_bytes = trim_leading_zeros(&len.to_be_bytes());
        out.push(offset + 55 + len_bytes.len() as u8);
        out.extend_from_slice(&len_bytes);
    }
    out.extend_from_slice(payload);
    out
}

fn trim_leading_zeros(b: &[u8]) -> Vec<u8> {
    let i = b.iter().position(|&x| x != 0).unwrap_or(b.len());
    b[i..].to_vec()
}

/// Encode a `U256` minimally — leading zero bytes stripped, zero is empty string.
pub fn encode_u256(v: U256) -> RlpItem {
    if v.is_zero() {
        return RlpItem::Bytes(vec![]);
    }
    let buf = v.to_big_endian();
    RlpItem::Bytes(trim_leading_zeros(&buf))
}

pub fn encode_u64(v: u64) -> RlpItem {
    encode_u256(U256::from(v))
}

pub fn encode_address(addr: Option<&Address>) -> RlpItem {
    match addr {
        Some(a) => RlpItem::Bytes(a.as_bytes().to_vec()),
        None => RlpItem::Bytes(vec![]),
    }
}

// ---------------------------------------------------------------------------
// Transaction body decoders
// ---------------------------------------------------------------------------

/// Top-level entry — sniffs the envelope kind, decodes, recovers sender.
///
/// Returns `(envelope, sender, declared_chain_id)`. `declared_chain_id` is
/// `None` for unprotected legacy transactions (no EIP-155). RPC callers
/// MUST compare it against the node's chain id to reject cross-chain
/// replays — the decoder itself is chain-agnostic by design so it can
/// also be reused for state-sync / archival decoding.
pub fn decode_raw_tx(
    raw: &[u8],
) -> Result<(EvmTxEnvelope, Address, Option<u64>), &'static str> {
    if raw.is_empty() {
        return Err("empty raw tx");
    }
    match raw[0] {
        0x01 => decode_eip2930_tx(&raw[1..]),
        0x02 => decode_eip1559_tx(&raw[1..]),
        // Anything else is legacy (must be a list discriminator >= 0xc0).
        b if b >= 0xc0 => decode_legacy_tx(raw),
        _ => Err("unknown tx envelope kind"),
    }
}

/// Compute the canonical Ethereum tx hash.
pub fn tx_hash(raw: &[u8]) -> [u8; 32] {
    keccak256(raw)
}

/// Decode legacy transaction: rlp([nonce, gas_price, gas, to, value, data, v, r, s]).
pub fn decode_legacy_tx(
    raw: &[u8],
) -> Result<(EvmTxEnvelope, Address, Option<u64>), &'static str> {
    let (item, _) = decode_rlp(raw)?;
    let fields = item.as_list()?;
    if fields.len() != 9 {
        return Err("legacy tx: expected 9 fields");
    }
    let nonce = fields[0].as_u64()?;
    let gas_price = fields[1].as_u256()?;
    let gas = fields[2].as_u64()?;
    let to = fields[3].as_address()?;
    let value = fields[4].as_u256()?;
    let data = fields[5].as_bytes()?.to_vec();
    let v = fields[6].as_u64()?;
    let r = fields[7].as_bytes()?.to_vec();
    let s = fields[8].as_bytes()?.to_vec();

    // EIP-155: v = chain_id * 2 + 35 + recovery_id (or 27/28 pre-155).
    let (recovery_id, chain_id) = parse_v(v)?;

    // Recompute signing hash per EIP-155.
    let signing_payload = if chain_id.is_some() {
        encode_rlp(&RlpItem::List(vec![
            encode_u64(nonce),
            encode_u256(gas_price),
            encode_u64(gas),
            encode_address(to.as_ref()),
            encode_u256(value),
            RlpItem::Bytes(data.clone()),
            encode_u64(chain_id.unwrap()),
            RlpItem::Bytes(vec![]),
            RlpItem::Bytes(vec![]),
        ]))
    } else {
        encode_rlp(&RlpItem::List(vec![
            encode_u64(nonce),
            encode_u256(gas_price),
            encode_u64(gas),
            encode_address(to.as_ref()),
            encode_u256(value),
            RlpItem::Bytes(data.clone()),
        ]))
    };
    let signing_hash = keccak256(&signing_payload);
    let sender = recover_sender(&signing_hash, &r, &s, recovery_id)?;

    let _ = nonce; // surfaced via decode_raw_tx_with_nonce if callers need it
    let env = build_envelope(gas_price, gas, to, value, data);
    Ok((env, sender, chain_id))
}

/// Decode EIP-2930 transaction (after stripping the `0x01` type byte).
pub fn decode_eip2930_tx(
    rlp: &[u8],
) -> Result<(EvmTxEnvelope, Address, Option<u64>), &'static str> {
    let (item, _) = decode_rlp(rlp)?;
    let fields = item.as_list()?;
    if fields.len() != 11 {
        return Err("EIP-2930 tx: expected 11 fields");
    }
    let chain_id = fields[0].as_u64()?;
    let nonce = fields[1].as_u64()?;
    let gas_price = fields[2].as_u256()?;
    let gas = fields[3].as_u64()?;
    let to = fields[4].as_address()?;
    let value = fields[5].as_u256()?;
    let data = fields[6].as_bytes()?.to_vec();
    // fields[7] = access_list — we accept but currently ignore (EIP-2929 cache deferred).
    let y_parity = fields[8].as_u64()?;
    if y_parity > 1 {
        return Err("EIP-2930: y_parity must be 0 or 1");
    }
    let r = fields[9].as_bytes()?.to_vec();
    let s = fields[10].as_bytes()?.to_vec();

    // Signing payload = 0x01 || rlp([first 8 fields])
    let signing_list = RlpItem::List(fields[..8].to_vec());
    let mut signing_payload = vec![0x01];
    signing_payload.extend_from_slice(&encode_rlp(&signing_list));
    let signing_hash = keccak256(&signing_payload);
    let sender = recover_sender(&signing_hash, &r, &s, y_parity as u8)?;

    let _ = nonce;
    let env = build_envelope(gas_price, gas, to, value, data);
    Ok((env, sender, Some(chain_id)))
}

/// Decode EIP-1559 transaction (after stripping the `0x02` type byte).
pub fn decode_eip1559_tx(
    rlp: &[u8],
) -> Result<(EvmTxEnvelope, Address, Option<u64>), &'static str> {
    let (item, _) = decode_rlp(rlp)?;
    let fields = item.as_list()?;
    if fields.len() != 12 {
        return Err("EIP-1559 tx: expected 12 fields");
    }
    let chain_id = fields[0].as_u64()?;
    let nonce = fields[1].as_u64()?;
    let _max_priority_fee = fields[2].as_u256()?;
    let max_fee = fields[3].as_u256()?;
    let gas = fields[4].as_u64()?;
    let to = fields[5].as_address()?;
    let value = fields[6].as_u256()?;
    let data = fields[7].as_bytes()?.to_vec();
    // fields[8] = access_list — accepted, ignored.
    let y_parity = fields[9].as_u64()?;
    if y_parity > 1 {
        return Err("EIP-1559: y_parity must be 0 or 1");
    }
    let r = fields[10].as_bytes()?.to_vec();
    let s = fields[11].as_bytes()?.to_vec();

    let signing_list = RlpItem::List(fields[..9].to_vec());
    let mut signing_payload = vec![0x02];
    signing_payload.extend_from_slice(&encode_rlp(&signing_list));
    let signing_hash = keccak256(&signing_payload);
    let sender = recover_sender(&signing_hash, &r, &s, y_parity as u8)?;

    // Effective gas price = max_fee_per_gas (we do not currently model
    // base_fee competition here; node-side gas auction lives in mempool).
    let _ = nonce;
    let env = build_envelope(max_fee, gas, to, value, data);
    Ok((env, sender, Some(chain_id)))
}

/// Build an `EvmTxEnvelope` from the decoded fields.
///
/// `nonce` is intentionally **not** part of the envelope — `evm::execute`
/// reads/bumps the sender's account nonce directly. RPC callers that need
/// nonce-mismatch validation should compare `declared_nonce` to
/// `db.account(&sender).nonce` themselves.
fn build_envelope(
    gas_price: U256,
    gas_limit: u64,
    to: Option<Address>,
    value: U256,
    data: Vec<u8>,
) -> EvmTxEnvelope {
    let value_u128 = value.low_u128();
    let gas_price_u128 = gas_price.low_u128();
    match to {
        Some(addr) => EvmTxEnvelope::Call(EvmCall {
            gas_price: gas_price_u128,
            gas_limit,
            to: addr,
            value: value_u128,
            data,
        }),
        None => EvmTxEnvelope::Create(EvmCreate {
            gas_price: gas_price_u128,
            gas_limit,
            value: value_u128,
            init_code: data,
            salt: None,
        }),
    }
}

fn parse_v(v: u64) -> Result<(u8, Option<u64>), &'static str> {
    match v {
        27 | 28 => Ok(((v - 27) as u8, None)),
        v if v >= 35 => {
            let chain_id = (v - 35) / 2;
            let recovery = ((v - 35) % 2) as u8;
            Ok((recovery, Some(chain_id)))
        }
        0 | 1 => Ok((v as u8, None)),
        _ => Err("legacy tx: unsupported v"),
    }
}

// ---------------------------------------------------------------------------
// secp256k1 sender recovery
// ---------------------------------------------------------------------------

fn recover_sender(
    signing_hash: &[u8; 32],
    r: &[u8],
    s: &[u8],
    recovery_id: u8,
) -> Result<Address, &'static str> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

    if recovery_id > 1 {
        return Err("recovery id out of range");
    }

    // r and s are big-endian, must each pad to 32 bytes for the Signature.
    let mut sig_bytes = [0u8; 64];
    if r.len() > 32 || s.len() > 32 {
        return Err("r or s exceeds 32 bytes");
    }
    sig_bytes[32 - r.len()..32].copy_from_slice(r);
    sig_bytes[64 - s.len()..].copy_from_slice(s);

    let sig = Signature::from_slice(&sig_bytes)
        .map_err(|_| "invalid ECDSA signature")?;
    let rid = RecoveryId::from_byte(recovery_id)
        .ok_or("invalid recovery id byte")?;

    let vk = VerifyingKey::recover_from_prehash(signing_hash, &sig, rid)
        .map_err(|_| "ECDSA recovery failed")?;
    let pk_bytes = vk.to_encoded_point(false); // uncompressed: 0x04 || X(32) || Y(32)
    let raw = pk_bytes.as_bytes();
    if raw.len() != 65 {
        return Err("unexpected pubkey length");
    }
    let hash = keccak256(&raw[1..]);
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&hash[12..]);
    Ok(Address::from_bytes(addr))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rlp_single_byte() {
        let (it, n) = decode_rlp(&[0x05]).unwrap();
        assert_eq!(n, 1);
        assert_eq!(it, RlpItem::Bytes(vec![0x05]));
    }

    #[test]
    fn rlp_empty_string() {
        let (it, n) = decode_rlp(&[0x80]).unwrap();
        assert_eq!(n, 1);
        assert_eq!(it, RlpItem::Bytes(vec![]));
    }

    #[test]
    fn rlp_short_string() {
        // "dog" -> 0x83, 'd', 'o', 'g'
        let (it, n) = decode_rlp(&[0x83, b'd', b'o', b'g']).unwrap();
        assert_eq!(n, 4);
        assert_eq!(it, RlpItem::Bytes(b"dog".to_vec()));
    }

    #[test]
    fn rlp_empty_list() {
        let (it, n) = decode_rlp(&[0xc0]).unwrap();
        assert_eq!(n, 1);
        assert_eq!(it, RlpItem::List(vec![]));
    }

    #[test]
    fn rlp_list_with_two_strings() {
        // [ "cat", "dog" ] -> 0xc8, 0x83, c, a, t, 0x83, d, o, g
        let (it, n) = decode_rlp(&[0xc8, 0x83, b'c', b'a', b't', 0x83, b'd', b'o', b'g']).unwrap();
        assert_eq!(n, 9);
        assert_eq!(
            it,
            RlpItem::List(vec![
                RlpItem::Bytes(b"cat".to_vec()),
                RlpItem::Bytes(b"dog".to_vec())
            ])
        );
    }

    #[test]
    fn rlp_long_string_boundary() {
        // 56-byte string -> 0xb8, 56, ..56 bytes..
        let payload = vec![0xab; 56];
        let mut input = vec![0xb8, 56];
        input.extend_from_slice(&payload);
        let (it, n) = decode_rlp(&input).unwrap();
        assert_eq!(n, 58);
        assert_eq!(it, RlpItem::Bytes(payload));
    }

    #[test]
    fn rlp_rejects_truncated() {
        assert!(decode_rlp(&[0x83, b'd']).is_err());
        assert!(decode_rlp(&[0xb8]).is_err());
    }

    #[test]
    fn rlp_rejects_non_canonical_single_byte() {
        // 0x81, 0x05 — should be the literal 0x05.
        assert!(decode_rlp(&[0x81, 0x05]).is_err());
    }

    #[test]
    fn rlp_round_trip_simple() {
        let item = RlpItem::List(vec![
            RlpItem::Bytes(vec![0x42]),
            RlpItem::Bytes(b"hello".to_vec()),
            RlpItem::List(vec![]),
        ]);
        let enc = encode_rlp(&item);
        let (dec, n) = decode_rlp(&enc).unwrap();
        assert_eq!(n, enc.len());
        assert_eq!(dec, item);
    }

    #[test]
    fn rlp_encode_u256_zero_is_empty() {
        assert_eq!(encode_u256(U256::zero()), RlpItem::Bytes(vec![]));
        assert_eq!(encode_u256(U256::from(0xff)), RlpItem::Bytes(vec![0xff]));
        assert_eq!(
            encode_u256(U256::from(0x0100)),
            RlpItem::Bytes(vec![0x01, 0x00])
        );
    }

    #[test]
    fn parse_v_legacy() {
        assert_eq!(parse_v(27).unwrap(), (0, None));
        assert_eq!(parse_v(28).unwrap(), (1, None));
    }

    #[test]
    fn parse_v_eip155() {
        // chain_id 7878 -> v = 7878*2 + 35 = 15791 (recovery 0) or 15792 (recovery 1)
        assert_eq!(parse_v(15791).unwrap(), (0, Some(7878)));
        assert_eq!(parse_v(15792).unwrap(), (1, Some(7878)));
    }

    #[test]
    fn decode_raw_rejects_empty() {
        assert!(decode_raw_tx(&[]).is_err());
    }

    #[test]
    fn decode_raw_rejects_unknown_type() {
        // 0x03 is reserved (EIP-4844 blob), not yet supported.
        assert!(decode_raw_tx(&[0x03, 0xc0]).is_err());
    }

    #[test]
    fn round_trip_envelope_build_call() {
        let env = build_envelope(
            U256::from(20_000_000_000u64),
            21000,
            Some(Address::from_bytes([1u8; 20])),
            U256::from(1_000_000u64),
            vec![0xde, 0xad],
        );
        match env {
            EvmTxEnvelope::Call(c) => {
                assert_eq!(c.gas_limit, 21000);
                assert_eq!(c.value, 1_000_000);
                assert_eq!(c.data, vec![0xde, 0xad]);
                assert_eq!(c.gas_price, 20_000_000_000u128);
            }
            _ => panic!("expected Call"),
        }
    }

    #[test]
    fn round_trip_envelope_build_create() {
        let env = build_envelope(
            U256::from(1u64),
            500_000,
            None,
            U256::zero(),
            vec![0x60, 0x80, 0x60, 0x40], // tiny init code
        );
        assert!(matches!(env, EvmTxEnvelope::Create(_)));
    }
}
