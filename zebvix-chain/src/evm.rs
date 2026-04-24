//! # Zebvix EVM Layer — Phase C
//!
//! Production-grade EVM (Ethereum Virtual Machine) execution layer for the
//! Zebvix L1 chain. Activated by the `evm` cargo feature; without it the
//! chain compiles unchanged so existing operators are not forced to rebuild
//! until they want to enable EVM.
//!
//! ## Goals
//! - Solidity 0.8+ contracts deploy and execute unchanged.
//! - MetaMask / Hardhat / Foundry / Remix work zero-config against
//!   `https://rpc.zebvix.network` because the [`evm_rpc`] module exposes the
//!   standard `eth_*` namespace alongside our existing `zbx_*` namespace.
//! - OpenZeppelin contracts (ERC-20 / ERC-721 / ERC-1155 / Governor) work
//!   as-is — no Zebvix-specific patches required.
//! - Native chain features (bridge, Pay-ID, AMM swap, multisig) become
//!   callable from inside Solidity via custom precompiles 0x80–0x83 in
//!   [`evm_precompiles`].
//!
//! ## Architecture
//! ```text
//!     ┌────────────────────────────────────────────────────────────┐
//!     │                    apply_tx (state.rs)                     │
//!     │                                                            │
//!     │   TxKind::Transfer  → native ledger debit/credit           │
//!     │   TxKind::Swap      → AMM pool                             │
//!     │   TxKind::Bridge    → bridge module                        │
//!     │   TxKind::EvmCall   ──┐                                    │
//!     │   TxKind::EvmCreate ──┴──► evm::execute()                  │
//!     │                              │                             │
//!     │                              ▼                             │
//!     │                       evm_interp::Interp                   │
//!     │                          │      │                          │
//!     │                          │      ▼                          │
//!     │                          │  evm_precompiles::dispatch      │
//!     │                          ▼                                 │
//!     │                    evm_state::CfEvmDb                      │
//!     │                          │                                 │
//!     │                          ▼                                 │
//!     │                   RocksDB (CF_EVM, CF_LOGS)                │
//!     └────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Forks supported
//! Cancun gas table & opcode set — PUSH0, transient storage (TLOAD/TSTORE),
//! MCOPY, EIP-3855, EIP-3860 init-code limit, EIP-1153, EIP-3651 warm
//! coinbase, EIP-3529 reduced refunds.
//!
//! ## Gas model
//! Per-opcode gas matches mainnet Ethereum so security tools (Slither,
//! Mythril, Manticore) remain valid. Block gas limit defaults to
//! `30_000_000` and is governance-mutable via `TxKind::GovernorChange`.
//! Per-tx refund capped at `gas_used / 5` (EIP-3529).
//!
//! Gas is paid in **ZBX wei** but priced via the AMM spot price so a
//! contract call costs ~$0.001–$0.05 USD regardless of ZBX volatility,
//! matching the native fee model in `state.rs::resolve_fee_window()`.

#![allow(dead_code, clippy::too_many_arguments)]

use crate::types::Address;
use primitive_types::{H256, U256};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Constants — Cancun gas table
// ---------------------------------------------------------------------------

/// Maximum stack depth (yellow paper §9.1).
pub const STACK_LIMIT: usize = 1024;

/// Maximum call depth (EIP-150).
pub const CALL_DEPTH_LIMIT: usize = 1024;

/// Maximum init-code size (EIP-3860).
pub const MAX_INITCODE_SIZE: usize = 2 * 24576;

/// Maximum runtime code size (EIP-170).
pub const MAX_CODE_SIZE: usize = 24576;

/// Per-block default gas limit (governance-mutable via `GovernorChange`).
pub const DEFAULT_BLOCK_GAS_LIMIT: u64 = 30_000_000;

/// Intrinsic transaction gas cost (21,000 base + zero/non-zero data words).
pub const G_TRANSACTION: u64 = 21_000;
pub const G_TX_CREATE: u64 = 32_000;
pub const G_TXDATA_ZERO: u64 = 4;
pub const G_TXDATA_NONZERO: u64 = 16;
pub const G_INITCODEWORD: u64 = 2; // EIP-3860 per-32-byte cost

/// keccak256("") — empty-account marker.
pub const KECCAK_EMPTY: [u8; 32] = [
    0xc5, 0xd2, 0x46, 0x01, 0x86, 0xf7, 0x23, 0x3c, 0x92, 0x7e, 0x7d, 0xb2, 0xdc, 0xc7, 0x03, 0xc0,
    0xe5, 0x00, 0xb6, 0x53, 0xca, 0x82, 0x27, 0x3b, 0x7b, 0xfa, 0xd8, 0x04, 0x5d, 0x85, 0xa4, 0x70,
];

// ---------------------------------------------------------------------------
// EVM transaction variants — additions to `transaction::TxKind`
// ---------------------------------------------------------------------------

/// `TxKind::EvmCreate` — deploy a new contract.
///
/// On apply:
/// 1. Charge `gas_limit * effective_gas_price` from `from`.
/// 2. Compute deployed address:
///    - CREATE  : `keccak256(rlp([from, nonce]))[12..]`
///    - CREATE2 : `keccak256(0xff || from || salt || keccak256(init_code))[12..]`
/// 3. Run `init_code` via [`crate::evm_interp::Interp`]; runtime bytecode is
///    the return value subject to the `MAX_CODE_SIZE` limit.
/// 4. Store `code` content-addressed in `CF_EVM/code/<keccak256>`.
/// 5. Account record: `EvmAccount { nonce: 1, balance: value, code_hash, … }`.
/// 6. Refund unused gas; emit `ContractCreated` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvmCreate {
    pub init_code: Vec<u8>,
    pub value: u128,
    pub gas_limit: u64,
    pub gas_price: u128,
    pub salt: Option<[u8; 32]>,
}

/// `TxKind::EvmCall` — invoke a deployed contract or native EOA transfer.
///
/// On apply:
/// 1. Charge `gas_limit * effective_gas_price` from `from`.
/// 2. Look up `EvmAccount` at `to`; load `code` by `code_hash`.
/// 3. Execute via [`crate::evm_interp::Interp`] with `data` as calldata.
/// 4. Apply state changes (storage writes, value transfers).
/// 5. Emit `LOG0..LOG4` events to `CF_LOGS`.
/// 6. Refund unused gas; return [`ExecResult`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvmCall {
    pub to: Address,
    pub data: Vec<u8>,
    pub value: u128,
    pub gas_limit: u64,
    pub gas_price: u128,
}

/// Wrapper enum so [`execute`] accepts both call and create variants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EvmTxEnvelope {
    Call(EvmCall),
    Create(EvmCreate),
}

impl EvmTxEnvelope {
    pub fn gas_limit(&self) -> u64 {
        match self {
            Self::Call(c) => c.gas_limit,
            Self::Create(c) => c.gas_limit,
        }
    }

    pub fn gas_price(&self) -> u128 {
        match self {
            Self::Call(c) => c.gas_price,
            Self::Create(c) => c.gas_price,
        }
    }

    pub fn value(&self) -> u128 {
        match self {
            Self::Call(c) => c.value,
            Self::Create(c) => c.value,
        }
    }

    /// Intrinsic gas cost (21k base + per-word calldata cost + create extras).
    pub fn intrinsic_gas(&self) -> u64 {
        let (base, data) = match self {
            Self::Call(c) => (G_TRANSACTION, &c.data[..]),
            Self::Create(c) => {
                let initcode_words = (c.init_code.len() as u64 + 31) / 32;
                (G_TRANSACTION + G_TX_CREATE + initcode_words * G_INITCODEWORD, &c.init_code[..])
            }
        };
        let mut data_cost: u64 = 0;
        for byte in data {
            data_cost = data_cost.saturating_add(if *byte == 0 { G_TXDATA_ZERO } else { G_TXDATA_NONZERO });
        }
        base.saturating_add(data_cost)
    }
}

// ---------------------------------------------------------------------------
// Account & state types
// ---------------------------------------------------------------------------

/// EVM account record. Stored in `CF_EVM` keyed by 20-byte address.
///
/// Compatible with Ethereum's `(nonce, balance, storage_root, code_hash)`
/// tuple so MPT proofs remain interoperable with archive-node clients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvmAccount {
    pub nonce: u64,
    pub balance: u128,
    pub storage_root: [u8; 32],
    pub code_hash: [u8; 32],
}

impl Default for EvmAccount {
    fn default() -> Self {
        Self {
            nonce: 0,
            balance: 0,
            storage_root: [0u8; 32],
            code_hash: KECCAK_EMPTY,
        }
    }
}

impl EvmAccount {
    pub fn is_empty(&self) -> bool {
        self.nonce == 0 && self.balance == 0 && self.code_hash == KECCAK_EMPTY
    }
}

/// One LOG entry emitted by an EVM contract (LOG0..LOG4 opcodes).
///
/// Indexed in `CF_LOGS` by `(block_height, log_index)` and additionally by
/// `(address, topic0..topic3)` so `eth_getLogs` filters are O(log n).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvmLog {
    pub address: Address,
    pub topics: Vec<H256>,
    pub data: Vec<u8>,
    pub block_height: u64,
    pub tx_hash: H256,
    pub log_index: u32,
}

/// Result of executing an EVM call/create.
#[derive(Debug, Clone)]
pub struct ExecResult {
    pub success: bool,
    pub gas_used: u64,
    pub gas_refunded: u64,
    pub return_data: Vec<u8>,
    pub logs: Vec<EvmLog>,
    pub created_address: Option<Address>,
    pub revert_reason: Option<String>,
}

impl ExecResult {
    pub fn revert(reason: impl Into<String>, gas_used: u64) -> Self {
        Self {
            success: false,
            gas_used,
            gas_refunded: 0,
            return_data: vec![],
            logs: vec![],
            created_address: None,
            revert_reason: Some(reason.into()),
        }
    }

    pub fn ok(gas_used: u64, gas_refunded: u64, return_data: Vec<u8>, logs: Vec<EvmLog>) -> Self {
        Self {
            success: true,
            gas_used,
            gas_refunded,
            return_data,
            logs,
            created_address: None,
            revert_reason: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Database trait — implemented by `evm_state::CfEvmDb`
// ---------------------------------------------------------------------------

/// Read-only view of EVM state. The interpreter calls this trait to fetch
/// accounts, code and storage. Mutations are journaled in [`StateJournal`]
/// and committed at the end of a successful execution.
pub trait EvmDb {
    /// Look up an account by address. Returns `None` if absent.
    fn account(&self, addr: &Address) -> Option<EvmAccount>;

    /// Fetch contract bytecode by `keccak256(code)`. Empty for EOAs.
    fn code(&self, hash: &[u8; 32]) -> Option<Vec<u8>>;

    /// Read one storage slot. Defaults to all-zeroes when absent.
    fn storage(&self, addr: &Address, key: &H256) -> H256;

    /// Resolve a historic block hash for the BLOCKHASH opcode.
    /// Only the last 256 blocks are accessible per the yellow paper.
    fn block_hash(&self, number: u64) -> H256;
}

/// Journaled state mutations produced by one EVM execution.
/// Caller (`state.rs::apply_tx`) commits these atomically along with the
/// outer transaction's other side-effects.
#[derive(Debug, Default, Clone)]
pub struct StateJournal {
    pub touched_accounts: Vec<(Address, EvmAccount)>,
    pub storage_writes: Vec<(Address, H256, H256)>,
    pub new_code: Vec<([u8; 32], Vec<u8>)>,
    pub destructed: Vec<Address>,
}

impl StateJournal {
    pub fn merge(&mut self, other: StateJournal) {
        self.touched_accounts.extend(other.touched_accounts);
        self.storage_writes.extend(other.storage_writes);
        self.new_code.extend(other.new_code);
        self.destructed.extend(other.destructed);
    }
}

// ---------------------------------------------------------------------------
// Block-level environment
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct EvmContext {
    pub chain_id: u64,
    pub block_number: u64,
    pub block_timestamp: u64,
    pub block_gas_limit: u64,
    pub coinbase: Address,
    pub base_fee_per_gas: u128,
    pub prev_randao: H256,
}

impl EvmContext {
    pub fn zebvix_default(block_number: u64, timestamp: u64, coinbase: Address, base_fee: u128) -> Self {
        Self {
            chain_id: crate::rpc::CHAIN_ID,
            block_number,
            block_timestamp: timestamp,
            block_gas_limit: DEFAULT_BLOCK_GAS_LIMIT,
            coinbase,
            base_fee_per_gas: base_fee,
            prev_randao: H256::zero(),
        }
    }
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

use crate::evm_interp::Interp;

/// Execute one EVM transaction (call or create) and return the result and
/// journaled state mutations.
///
/// The caller (`state.rs::apply_tx`) is responsible for:
/// 1. Validating signer's nonce + balance ≥ `gas_limit * gas_price + value`.
/// 2. Persisting `journal.touched_accounts`/`storage_writes`/`new_code`
///    to `CF_EVM`.
/// 3. Persisting `result.logs` to `CF_LOGS`.
/// 4. Refunding `result.gas_refunded` ZBX wei back to the signer.
pub fn execute<D: EvmDb>(
    db: &D,
    ctx: &EvmContext,
    from: &Address,
    tx: &EvmTxEnvelope,
) -> (ExecResult, StateJournal) {
    let intrinsic = tx.intrinsic_gas();
    if intrinsic > tx.gas_limit() {
        return (
            ExecResult::revert("intrinsic gas exceeds gas_limit", tx.gas_limit()),
            StateJournal::default(),
        );
    }

    let mut journal = StateJournal::default();

    // Increment caller nonce + debit value (caller is paying gas separately).
    let mut caller_acct = db.account(from).unwrap_or_default();
    if caller_acct.balance < tx.value() {
        return (
            ExecResult::revert("insufficient balance for value", tx.gas_limit()),
            journal,
        );
    }
    caller_acct.nonce = caller_acct.nonce.saturating_add(1);
    caller_acct.balance = caller_acct.balance.saturating_sub(tx.value());

    let gas_remaining = tx.gas_limit().saturating_sub(intrinsic);

    let exec_result = match tx {
        EvmTxEnvelope::Create(c) => {
            // Compute new contract address.
            let new_addr = match c.salt {
                Some(salt) => create2_address(from, &salt, &c.init_code),
                None => create_address(from, caller_acct.nonce.saturating_sub(1)),
            };

            // EIP-3860 init-code size limit.
            if c.init_code.len() > MAX_INITCODE_SIZE {
                return (
                    ExecResult::revert("init code exceeds EIP-3860 limit", tx.gas_limit()),
                    journal,
                );
            }

            // Architect-review Medium fix: yellow paper §7 forbids deploying
            // over an account that already has a non-zero nonce or non-empty
            // code (EIP-684 / Spurious Dragon). Pre-existing balance is
            // allowed and inherited per spec.
            let existing = db.account(&new_addr).unwrap_or_default();
            if existing.nonce != 0 || existing.code_hash != [0u8; 32] {
                return (
                    ExecResult::revert("address collision: account already has code/nonce", tx.gas_limit()),
                    journal,
                );
            }

            // Credit value to new contract (existing balance preserved).
            let mut new_acct = existing;
            new_acct.balance = new_acct.balance.saturating_add(c.value);
            new_acct.nonce = 1;

            // Run init code.
            let mut interp = Interp::new(db, ctx, gas_remaining);
            interp.set_caller(*from);
            interp.set_address(new_addr);
            interp.set_value(c.value);
            interp.set_calldata(vec![]);

            let mut res = interp.run(&c.init_code);

            if res.success {
                // Runtime code = return data.
                if res.return_data.len() > MAX_CODE_SIZE {
                    res = ExecResult::revert("deployed code exceeds EIP-170 limit", tx.gas_limit());
                } else if !res.return_data.is_empty() && res.return_data[0] == 0xef {
                    // EIP-3541: contracts cannot start with 0xEF.
                    res = ExecResult::revert("deployed code starts with 0xEF (EIP-3541)", tx.gas_limit());
                } else {
                    let code_hash = keccak256(&res.return_data);
                    new_acct.code_hash = code_hash;
                    journal.new_code.push((code_hash, res.return_data.clone()));
                    journal.touched_accounts.push((new_addr, new_acct.clone()));
                    res.created_address = Some(new_addr);
                    journal.merge(interp.into_journal());
                }
            }
            res
        }

        EvmTxEnvelope::Call(c) => {
            // Credit value to recipient.
            let mut to_acct = db.account(&c.to).unwrap_or_default();
            to_acct.balance = to_acct.balance.saturating_add(c.value);
            journal.touched_accounts.push((c.to, to_acct.clone()));

            let code = if to_acct.code_hash != KECCAK_EMPTY {
                db.code(&to_acct.code_hash).unwrap_or_default()
            } else {
                vec![]
            };

            if code.is_empty() {
                // Plain ZBX transfer to EOA.
                ExecResult::ok(intrinsic, 0, vec![], vec![])
            } else {
                let mut interp = Interp::new(db, ctx, gas_remaining);
                interp.set_caller(*from);
                interp.set_address(c.to);
                interp.set_value(c.value);
                interp.set_calldata(c.data.clone());

                let res = interp.run(&code);
                if res.success {
                    journal.merge(interp.into_journal());
                }
                res
            }
        }
    };

    // Always commit the caller's nonce/balance change even on revert
    // (canonical Ethereum semantics: revert refunds value but not nonce).
    if !exec_result.success {
        // Refund value on failed call/create.
        caller_acct.balance = caller_acct.balance.saturating_add(tx.value());
    }
    journal.touched_accounts.push((*from, caller_acct));

    (exec_result, journal)
}

// ---------------------------------------------------------------------------
// Address derivation helpers
// ---------------------------------------------------------------------------

/// CREATE: `keccak256(rlp([sender, nonce]))[12..]`
pub fn create_address(sender: &Address, nonce: u64) -> Address {
    let rlp = rlp_encode_sender_nonce(sender, nonce);
    let h = keccak256(&rlp);
    let mut out = [0u8; 20];
    out.copy_from_slice(&h[12..]);
    Address::from_bytes(out)
}

/// CREATE2: `keccak256(0xff || sender || salt || keccak256(init_code))[12..]`
pub fn create2_address(sender: &Address, salt: &[u8; 32], init_code: &[u8]) -> Address {
    let mut buf = Vec::with_capacity(1 + 20 + 32 + 32);
    buf.push(0xff);
    buf.extend_from_slice(sender.as_bytes());
    buf.extend_from_slice(salt);
    buf.extend_from_slice(&keccak256(init_code));
    let h = keccak256(&buf);
    let mut out = [0u8; 20];
    out.copy_from_slice(&h[12..]);
    Address::from_bytes(out)
}

/// Tiny RLP encoder for the (address, nonce) pair used in CREATE.
/// We do not pull in the full `rlp` crate to stay dep-light.
fn rlp_encode_sender_nonce(sender: &Address, nonce: u64) -> Vec<u8> {
    fn rlp_uint(mut n: u64) -> Vec<u8> {
        if n == 0 {
            return vec![0x80];
        }
        let mut bytes = vec![];
        while n > 0 {
            bytes.push((n & 0xff) as u8);
            n >>= 8;
        }
        bytes.reverse();
        if bytes.len() == 1 && bytes[0] < 0x80 {
            bytes
        } else {
            let mut out = vec![0x80 + bytes.len() as u8];
            out.extend_from_slice(&bytes);
            out
        }
    }

    fn rlp_bytes(b: &[u8]) -> Vec<u8> {
        let mut out = vec![0x80 + b.len() as u8];
        out.extend_from_slice(b);
        out
    }

    let payload = {
        let mut p = vec![];
        p.extend_from_slice(&rlp_bytes(sender.as_bytes()));
        p.extend_from_slice(&rlp_uint(nonce));
        p
    };
    let mut out = vec![0xc0 + payload.len() as u8];
    out.extend_from_slice(&payload);
    out
}

/// keccak256 — re-export under a stable name so other modules don't repeat
/// the import incantation.
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    use sha3::{Digest, Keccak256};
    let mut h = Keccak256::new();
    h.update(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(&h.finalize());
    out
}

/// Big-endian `U256` ↔ `[u8; 32]`.
pub fn u256_to_bytes(v: U256) -> [u8; 32] {
    let mut buf = [0u8; 32];
    v.to_big_endian(&mut buf);
    buf
}

pub fn bytes_to_u256(b: &[u8]) -> U256 {
    if b.len() == 32 {
        U256::from_big_endian(b)
    } else if b.len() < 32 {
        let mut padded = [0u8; 32];
        padded[32 - b.len()..].copy_from_slice(b);
        U256::from_big_endian(&padded)
    } else {
        U256::from_big_endian(&b[..32])
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keccak_empty_constant_is_correct() {
        assert_eq!(keccak256(b""), KECCAK_EMPTY);
    }

    #[test]
    fn create_address_deterministic() {
        let sender = Address::from_bytes([0x42u8; 20]);
        let a0 = create_address(&sender, 0);
        let a1 = create_address(&sender, 1);
        assert_ne!(a0, a1, "different nonces must produce different addresses");
    }

    #[test]
    fn create2_address_deterministic() {
        let sender = Address::from_bytes([0x42u8; 20]);
        let salt = [0x01u8; 32];
        let init = b"hello";
        let a0 = create2_address(&sender, &salt, init);
        let a1 = create2_address(&sender, &salt, init);
        assert_eq!(a0, a1, "same inputs must produce same address");
    }

    #[test]
    fn intrinsic_gas_call_baseline() {
        let tx = EvmTxEnvelope::Call(EvmCall {
            to: Address::from_bytes([0u8; 20]),
            data: vec![],
            value: 0,
            gas_limit: 100_000,
            gas_price: 1,
        });
        assert_eq!(tx.intrinsic_gas(), G_TRANSACTION);
    }

    #[test]
    fn intrinsic_gas_call_with_data() {
        let tx = EvmTxEnvelope::Call(EvmCall {
            to: Address::from_bytes([0u8; 20]),
            data: vec![0, 1, 2, 0, 0, 3],
            value: 0,
            gas_limit: 100_000,
            gas_price: 1,
        });
        // 21000 base + 3 zeros (4 each) + 3 nonzeros (16 each) = 21060
        assert_eq!(tx.intrinsic_gas(), 21_000 + 3 * 4 + 3 * 16);
    }

    #[test]
    fn u256_roundtrip() {
        let v = U256::from(0xdeadbeefu64);
        let b = u256_to_bytes(v);
        assert_eq!(bytes_to_u256(&b), v);
    }
}
