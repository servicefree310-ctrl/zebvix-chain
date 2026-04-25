//! # Zebvix EVM Precompiles
//!
//! Precompiles are pseudo-contracts implemented in native Rust. The
//! interpreter intercepts calls to specific addresses and dispatches to
//! these handlers, returning gas-metered output without ever entering
//! bytecode interpretation.
//!
//! ## Standard EVM precompiles (0x01–0x09)
//! - `0x01` ECRECOVER  — secp256k1 sig recovery (used by `EIP-712`, ERC-2612)
//! - `0x02` SHA256
//! - `0x03` RIPEMD160  — stub returns zero, see notes below
//! - `0x04` IDENTITY   — memcpy
//! - `0x05` MODEXP     — stub for now (see Phase C.2 plan)
//! - `0x06`–`0x09`     — alt_bn128 / blake2f, deferred to Phase C.2
//!
//! ## Custom Zebvix precompiles (0x80–0x83)
//! These addresses sit in the unused top-bit range so they cannot collide
//! with user accounts. They expose native Zebvix features to Solidity
//! contracts without wrapper contracts:
//!
//! | Addr | Name              | Native module    | Gas    |
//! |------|-------------------|------------------|--------|
//! | 0x80 | bridge_out        | `bridge.rs`      | 35,000 |
//! | 0x81 | payid_resolve     | `state.rs`       |  2,500 |
//! | 0x82 | amm_swap          | `pool.rs`        | 50,000 |
//! | 0x83 | multisig_propose  | `multisig.rs`    | 30,000 |
//!
//! All precompiles return either a single `bytes32` (for resolve/swap result)
//! or a packed `(uint64 id, bytes32 hash)` (for bridge/multisig).
//!
//! ## Why `RIPEMD160` is a stub
//! The RIPEMD160 precompile is rarely used in modern dApps (its main user,
//! Bitcoin-style address derivation, is handled off-chain). Adding the
//! `ripemd` crate just for one opcode wastes binary size; we return all-zero
//! and document the deviation. If a contract actually depends on it we will
//! pull in the dep in Phase C.2.

#![allow(dead_code)]

use crate::evm::keccak256;
use crate::types::Address;
use primitive_types::U256;

// ---------------------------------------------------------------------------
// Standard precompile addresses 0x01–0x09
// ---------------------------------------------------------------------------

pub const PC_ECRECOVER: [u8; 20] = addr_lo(0x01);
pub const PC_SHA256: [u8; 20] = addr_lo(0x02);
pub const PC_RIPEMD160: [u8; 20] = addr_lo(0x03);
pub const PC_IDENTITY: [u8; 20] = addr_lo(0x04);
pub const PC_MODEXP: [u8; 20] = addr_lo(0x05);

// ---------------------------------------------------------------------------
// Custom Zebvix precompile addresses 0x80–0x83
// ---------------------------------------------------------------------------

pub const PC_BRIDGE_OUT: [u8; 20] = addr_lo(0x80);
pub const PC_PAYID_RESOLVE: [u8; 20] = addr_lo(0x81);
pub const PC_AMM_SWAP: [u8; 20] = addr_lo(0x82);
pub const PC_MULTISIG_PROPOSE: [u8; 20] = addr_lo(0x83);

const fn addr_lo(byte: u8) -> [u8; 20] {
    let mut a = [0u8; 20];
    a[19] = byte;
    a
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PrecompileOutput {
    pub gas_used: u64,
    pub return_data: Vec<u8>,
    pub success: bool,
}

impl PrecompileOutput {
    pub fn ok(gas_used: u64, return_data: Vec<u8>) -> Self {
        Self { gas_used, return_data, success: true }
    }
    pub fn err(gas_used: u64) -> Self {
        Self { gas_used, return_data: vec![], success: false }
    }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// Top-level precompile dispatcher. Returns `None` if `addr` is not a
/// precompile so the interpreter falls back to bytecode execution.
pub fn dispatch(addr: &Address, input: &[u8], gas_limit: u64) -> Option<PrecompileOutput> {
    let bytes = addr.as_bytes();
    match bytes {
        b if b == &PC_ECRECOVER => Some(ecrecover(input, gas_limit)),
        b if b == &PC_SHA256 => Some(sha256(input, gas_limit)),
        b if b == &PC_RIPEMD160 => Some(ripemd160_stub(input, gas_limit)),
        b if b == &PC_IDENTITY => Some(identity(input, gas_limit)),
        b if b == &PC_MODEXP => Some(modexp_stub(input, gas_limit)),

        b if b == &PC_BRIDGE_OUT => Some(bridge_out(input, gas_limit)),
        b if b == &PC_PAYID_RESOLVE => Some(payid_resolve(input, gas_limit)),
        b if b == &PC_AMM_SWAP => Some(amm_swap(input, gas_limit)),
        b if b == &PC_MULTISIG_PROPOSE => Some(multisig_propose(input, gas_limit)),

        _ => None,
    }
}

// ---------------------------------------------------------------------------
// 0x01 — ECRECOVER (secp256k1)
// ---------------------------------------------------------------------------
//
// Input layout: hash (32) || v (32) || r (32) || s (32)
// Output      : 20-byte address left-padded to 32 bytes (or empty on fail)
// Gas         : 3,000

const G_ECRECOVER: u64 = 3_000;

pub fn ecrecover(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    if gas_limit < G_ECRECOVER {
        return PrecompileOutput::err(gas_limit);
    }
    let mut padded = [0u8; 128];
    padded[..input.len().min(128)].copy_from_slice(&input[..input.len().min(128)]);

    let hash = &padded[0..32];
    let v_bytes = &padded[32..64];
    let r = &padded[64..96];
    let s = &padded[96..128];

    // v must fit in u8 and be 27 or 28 (legacy) or 0/1 (post-EIP-2098).
    for byte in &v_bytes[..31] {
        if *byte != 0 {
            return PrecompileOutput::ok(G_ECRECOVER, vec![]);
        }
    }
    let v = v_bytes[31];
    let recovery_id = match v {
        27 | 28 => v - 27,
        0 | 1 => v,
        _ => return PrecompileOutput::ok(G_ECRECOVER, vec![]),
    };

    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
    let mut sig_bytes = [0u8; 64];
    sig_bytes[..32].copy_from_slice(r);
    sig_bytes[32..].copy_from_slice(s);
    let sig = match Signature::from_slice(&sig_bytes) {
        Ok(s) => s,
        Err(_) => return PrecompileOutput::ok(G_ECRECOVER, vec![]),
    };
    let rid = match RecoveryId::try_from(recovery_id) {
        Ok(r) => r,
        Err(_) => return PrecompileOutput::ok(G_ECRECOVER, vec![]),
    };
    let vk = match VerifyingKey::recover_from_prehash(hash, &sig, rid) {
        Ok(v) => v,
        Err(_) => return PrecompileOutput::ok(G_ECRECOVER, vec![]),
    };

    // EVM address = keccak256(uncompressed_pubkey[1..])[12..]
    let pk_bytes = vk.to_encoded_point(false);
    let pk_bytes = pk_bytes.as_bytes();
    let h = keccak256(&pk_bytes[1..]);
    let mut out = [0u8; 32];
    out[12..].copy_from_slice(&h[12..]);
    PrecompileOutput::ok(G_ECRECOVER, out.to_vec())
}

// ---------------------------------------------------------------------------
// 0x02 — SHA256
// ---------------------------------------------------------------------------

const G_SHA256_BASE: u64 = 60;
const G_SHA256_WORD: u64 = 12;

pub fn sha256(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    let words = (input.len() as u64 + 31) / 32;
    let cost = G_SHA256_BASE + G_SHA256_WORD * words;
    if gas_limit < cost {
        return PrecompileOutput::err(gas_limit);
    }
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(input);
    PrecompileOutput::ok(cost, h.finalize().to_vec())
}

// ---------------------------------------------------------------------------
// 0x03 — RIPEMD160 (stub — returns zero)
// ---------------------------------------------------------------------------

const G_RIPEMD_BASE: u64 = 600;
const G_RIPEMD_WORD: u64 = 120;

pub fn ripemd160_stub(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    let words = (input.len() as u64 + 31) / 32;
    let cost = G_RIPEMD_BASE + G_RIPEMD_WORD * words;
    if gas_limit < cost {
        return PrecompileOutput::err(gas_limit);
    }
    // 20 zero bytes left-padded to 32.
    PrecompileOutput::ok(cost, vec![0u8; 32])
}

// ---------------------------------------------------------------------------
// 0x04 — IDENTITY (memcpy)
// ---------------------------------------------------------------------------

const G_IDENTITY_BASE: u64 = 15;
const G_IDENTITY_WORD: u64 = 3;

pub fn identity(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    let words = (input.len() as u64 + 31) / 32;
    let cost = G_IDENTITY_BASE + G_IDENTITY_WORD * words;
    if gas_limit < cost {
        return PrecompileOutput::err(gas_limit);
    }
    PrecompileOutput::ok(cost, input.to_vec())
}

// ---------------------------------------------------------------------------
// 0x05 — MODEXP (stub returns 0; deferred to Phase C.2)
// ---------------------------------------------------------------------------

pub fn modexp_stub(_input: &[u8], gas_limit: u64) -> PrecompileOutput {
    let cost = 200; // minimum gas per EIP-2565
    if gas_limit < cost {
        return PrecompileOutput::err(gas_limit);
    }
    PrecompileOutput::ok(cost, vec![0u8; 32])
}

// ---------------------------------------------------------------------------
// 0x80 — bridge_out
// ---------------------------------------------------------------------------
//
// Solidity ABI:
//   function bridge_out(uint64 asset_id, bytes32 dest_chain, bytes recipient)
//       external returns (uint64 nonce, bytes32 evt_hash);
//
// Encoded input layout (head-tail ABI):
//   [0..32]   asset_id (uint64 left-padded)
//   [32..64]  dest_chain (bytes32)
//   [64..96]  recipient_offset (= 0x60)
//   [96..128] recipient_length
//   [128..]   recipient bytes (right-padded to 32)
//
// Returns:
//   [0..8]    bridge nonce (u64 BE)
//   [8..32]   pad
//   [32..64]  keccak256(asset_id || dest_chain || recipient || nonce)

const G_BRIDGE_OUT: u64 = 35_000;

pub fn bridge_out(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    if gas_limit < G_BRIDGE_OUT { return PrecompileOutput::err(gas_limit); }
    if input.len() < 128 { return PrecompileOutput::err(G_BRIDGE_OUT); }

    let asset_id = U256::from_big_endian(&input[0..32]).as_u64();
    let dest_chain = &input[32..64];
    let recipient_len = U256::from_big_endian(&input[96..128]).as_usize();
    if input.len() < 128 + recipient_len { return PrecompileOutput::err(G_BRIDGE_OUT); }
    let recipient = &input[128..128 + recipient_len];

    // The actual wire-up to bridge.rs is performed by `state::apply_tx`
    // when it sees this precompile call. Here we construct the
    // deterministic event hash that the relayer will index.
    let nonce = generate_bridge_nonce(asset_id, recipient);

    let mut hash_input = Vec::with_capacity(8 + 32 + recipient.len() + 8);
    hash_input.extend_from_slice(&asset_id.to_be_bytes());
    hash_input.extend_from_slice(dest_chain);
    hash_input.extend_from_slice(recipient);
    hash_input.extend_from_slice(&nonce.to_be_bytes());
    let evt_hash = keccak256(&hash_input);

    let mut out = vec![0u8; 64];
    out[24..32].copy_from_slice(&nonce.to_be_bytes());
    out[32..64].copy_from_slice(&evt_hash);

    PrecompileOutput::ok(G_BRIDGE_OUT, out)
}

/// Bridge-out nonce derivation. In production this is a chain-state counter
/// guarded by `state::reserve_bridge_nonce()`. Here we hash the inputs to
/// surface a deterministic placeholder until the full handshake is wired
/// (Phase C.2 connects this to the same `BridgeOutEvent` sequence used by
/// `TxKind::Bridge(BridgeOp::BridgeOut)`).
fn generate_bridge_nonce(asset_id: u64, recipient: &[u8]) -> u64 {
    let mut buf = Vec::with_capacity(8 + recipient.len());
    buf.extend_from_slice(&asset_id.to_be_bytes());
    buf.extend_from_slice(recipient);
    let h = keccak256(&buf);
    u64::from_be_bytes(h[..8].try_into().unwrap_or([0u8; 8]))
}

// ---------------------------------------------------------------------------
// 0x81 — payid_resolve
// ---------------------------------------------------------------------------
//
// Solidity ABI:
//   function payid_resolve(string alias) external view returns (address);
//
// Returns the 20-byte address mapped to `alias` in `state::CF_PAYIDS`,
// left-padded to 32 bytes. Unknown aliases return `address(0)`.

const G_PAYID: u64 = 2_500;

pub fn payid_resolve(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    if gas_limit < G_PAYID { return PrecompileOutput::err(gas_limit); }
    if input.len() < 64 { return PrecompileOutput::err(G_PAYID); }
    let alias_len = U256::from_big_endian(&input[32..64]).as_usize();
    if input.len() < 64 + alias_len { return PrecompileOutput::err(G_PAYID); }
    let _alias = &input[64..64 + alias_len];
    // The actual lookup is performed by `state::apply_tx` post-dispatch.
    // Stand-in: return zero so contracts can `require(addr != address(0))`.
    PrecompileOutput::ok(G_PAYID, vec![0u8; 32])
}

// ---------------------------------------------------------------------------
// 0x82 — amm_swap
// ---------------------------------------------------------------------------
//
// Solidity ABI:
//   function amm_swap(uint8 direction, uint256 amount_in, uint256 min_out)
//       external returns (uint256 amount_out);
//
// `direction`: 0 = ZBX → zUSD, 1 = zUSD → ZBX
// Settles atomically against the chain's main AMM pool. The interpreter
// frame's `caller` is debited and credited inside `state::apply_tx` after
// the precompile returns the predicted `amount_out`.

const G_AMM_SWAP: u64 = 50_000;

pub fn amm_swap(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    if gas_limit < G_AMM_SWAP { return PrecompileOutput::err(gas_limit); }
    if input.len() < 96 { return PrecompileOutput::err(G_AMM_SWAP); }
    let direction = U256::from_big_endian(&input[0..32]).low_u32() & 1;
    let amount_in = U256::from_big_endian(&input[32..64]);
    let min_out = U256::from_big_endian(&input[64..96]);

    // Constant-product formula preview using current pool reserves.
    // Exact reserves are wired in `state::apply_tx`; here we return a
    // deterministic placeholder = amount_in * 95 / 100 to satisfy
    // contracts that gas-estimate before applying.
    let amount_out = amount_in * U256::from(95u32) / U256::from(100u32);
    if amount_out < min_out {
        return PrecompileOutput::err(G_AMM_SWAP);
    }
    let _ = direction; // sign so future patch can branch on it
    let out = amount_out.to_big_endian().to_vec();
    PrecompileOutput::ok(G_AMM_SWAP, out)
}

// ---------------------------------------------------------------------------
// 0x83 — multisig_propose
// ---------------------------------------------------------------------------
//
// Solidity ABI:
//   function multisig_propose(address vault, bytes op) external returns (uint64);
//
// Caller must already be a registered signer in the named vault. Returns
// the `proposal_id` so the dApp can track signing progress via the
// `zbx_multisigGetProposal` RPC.

const G_MULTISIG: u64 = 30_000;

pub fn multisig_propose(input: &[u8], gas_limit: u64) -> PrecompileOutput {
    if gas_limit < G_MULTISIG { return PrecompileOutput::err(gas_limit); }
    if input.len() < 96 { return PrecompileOutput::err(G_MULTISIG); }
    let _vault = &input[12..32];
    let op_len = U256::from_big_endian(&input[64..96]).as_usize();
    if input.len() < 96 + op_len { return PrecompileOutput::err(G_MULTISIG); }
    let op = &input[96..96 + op_len];

    // Deterministic stand-in proposal_id. State machine is performed by
    // `state::apply_tx` via the existing `multisig::propose()` helper.
    let h = keccak256(op);
    let pid = u64::from_be_bytes(h[..8].try_into().unwrap_or([0u8; 8]));

    let mut out = vec![0u8; 32];
    out[24..32].copy_from_slice(&pid.to_be_bytes());
    PrecompileOutput::ok(G_MULTISIG, out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precompile_addresses_distinct() {
        let all = [
            PC_ECRECOVER, PC_SHA256, PC_RIPEMD160, PC_IDENTITY, PC_MODEXP,
            PC_BRIDGE_OUT, PC_PAYID_RESOLVE, PC_AMM_SWAP, PC_MULTISIG_PROPOSE,
        ];
        for i in 0..all.len() {
            for j in (i + 1)..all.len() {
                assert_ne!(all[i], all[j], "precompile addrs must be distinct");
            }
        }
    }

    #[test]
    fn identity_round_trip() {
        let out = identity(b"hello world", 100_000);
        assert!(out.success);
        assert_eq!(out.return_data, b"hello world");
    }

    #[test]
    fn sha256_known_vector() {
        let out = sha256(b"abc", 100_000);
        assert!(out.success);
        // SHA256("abc") = ba7816bf...
        assert_eq!(out.return_data[0], 0xba);
        assert_eq!(out.return_data[1], 0x78);
    }

    #[test]
    fn dispatch_returns_none_for_unknown_addr() {
        let unknown = Address::from_bytes([0xff; 20]);
        assert!(dispatch(&unknown, &[], 100_000).is_none());
    }

    #[test]
    fn bridge_out_returns_64_bytes() {
        let mut input = vec![0u8; 128];
        input[31] = 0x01; // asset_id = 1
        input[127] = 0x14; // recipient_len = 20
        input.extend_from_slice(&[0xab; 32]); // recipient padded
        let out = bridge_out(&input, 100_000);
        assert!(out.success);
        assert_eq!(out.return_data.len(), 64);
    }

    #[test]
    fn amm_swap_respects_min_out() {
        let mut input = vec![0u8; 96];
        input[31] = 0; // direction = 0
        // amount_in = 1000
        let amount_in = U256::from(1000u32);
        input[32..64].copy_from_slice(&amount_in.to_big_endian());
        // min_out = 2000 (more than 95% of 1000), should fail
        let min_out = U256::from(2000u32);
        input[64..96].copy_from_slice(&min_out.to_big_endian());
        let out = amm_swap(&input, 100_000);
        assert!(!out.success, "min_out > amount_out * 0.95 must revert");
    }
}
