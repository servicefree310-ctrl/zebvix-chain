//! # Zebvix EVM Layer — Phase C (DESIGN DRAFT, not yet wired)
//!
//! This module is the planned home for full EVM (Ethereum Virtual Machine)
//! execution on top of the Zebvix L1 chain. It is intentionally NOT declared
//! in `lib.rs` yet — current chain builds without it — and serves as a
//! living design document for the upcoming Phase C work.
//!
//! ## Goal
//! Make Zebvix a fully EVM-compatible L1 so that:
//! - Solidity 0.8+ contracts deploy and execute unchanged
//! - MetaMask / Hardhat / Foundry / Remix work zero-config
//! - OpenZeppelin contracts (ERC-20 / ERC-721 / ERC-1155 / Governor / …)
//!   work as-is
//! - The Graph subgraphs index Zebvix events via standard `eth_getLogs`
//! - All native chain features (bridge, Pay-ID, AMM swap, multisig) become
//!   callable from inside Solidity via custom precompiles
//!
//! ## High-level architecture
//! ```text
//!     ┌────────────────────────────────────────────────────────────┐
//!     │                    apply_tx (state.rs)                     │
//!     │                                                            │
//!     │   TxKind::Transfer  → native ledger debit/credit           │
//!     │   TxKind::Swap      → AMM pool                             │
//!     │   TxKind::Bridge    → bridge module                        │
//!     │   TxKind::EvmCall   ──┐                                    │
//!     │   TxKind::EvmCreate ──┴──► evm::execute()  ──► revm 7.x    │
//!     │                                                            │
//!     └────────────────────────────────────────────────────────────┘
//!                              │
//!                              ▼
//!     ┌────────────────────────────────────────────────────────────┐
//!     │  EvmDb  (CF_EVM RocksDB column family)                     │
//!     │   • account state (nonce, balance, code_hash, storage_root)│
//!     │   • bytecode  (keccak256(code) → code, content-addressed)  │
//!     │   • per-account storage trie                               │
//!     │                                                            │
//!     │  EvmContext  (block env, tx env, gas)                      │
//!     │   • block_number, timestamp, coinbase = founder validator  │
//!     │   • base_fee = USD-pegged via AMM spot price               │
//!     │   • chain_id = 7878                                        │
//!     │                                                            │
//!     │  ZebvixPrecompiles  (custom 0x80–0x90 range)               │
//!     │   • bridge_out, payid_resolve, amm_swap, multisig_propose  │
//!     └────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Forks supported
//! Latest revm 7.x activates: London (EIP-1559 base fee model), Berlin
//! (access lists / EIP-2929 gas), Shanghai (PUSH0, withdrawals), Cancun
//! (transient storage, MCOPY, blob carrier txs without blob storage).
//!
//! ## Gas model
//! Per-opcode gas metering is identical to mainnet Ethereum so security
//! analyses (Slither, Mythril) remain valid. Block gas limit defaults to
//! `3_000_000` (governable via on-chain governance tx). Per-tx gas refund
//! capped at `gas_used / 5` (EIP-3529).
//!
//! Gas is paid in **ZBX wei** but priced via the live AMM spot price so a
//! contract call costs ~$0.001–$0.05 USD regardless of ZBX volatility,
//! matching the native fee model in `state.rs::resolve_fee_window()`.

#![allow(dead_code)]

use crate::types::Address;

// ---------------------------------------------------------------------------
// EVM transaction variants  (planned additions to `transaction::TxKind`)
// ---------------------------------------------------------------------------

/// `TxKind::EvmCreate` — deploy a new contract.
///
/// On apply:
/// 1. Charge `gas_limit * effective_gas_price` from `from`.
/// 2. Compute deployed address:
///    - CREATE  : `keccak256(rlp([from, nonce]))[12..]`
///    - CREATE2 : `keccak256(0xff || from || salt || keccak256(init_code))[12..]`
/// 3. Run `init_code` via revm; runtime bytecode = return value.
/// 4. Store `code` content-addressed in `CF_EVM/code/<keccak256>`.
/// 5. Account record: `EvmAccount { nonce: 1, balance: value, code_hash, … }`.
/// 6. Refund unused gas; emit `ContractCreated` event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvmCreate {
    pub init_code: Vec<u8>,
    pub value: u128, // ZBX wei sent to constructor
    pub gas_limit: u64,
    pub gas_price: u128, // wei per gas unit (USD-pegged via AMM)
    pub salt: Option<[u8; 32]>, // Some => CREATE2, None => CREATE
}

/// `TxKind::EvmCall` — invoke a deployed contract.
///
/// On apply:
/// 1. Charge `gas_limit * effective_gas_price` from `from`.
/// 2. Look up `EvmAccount` at `to`; load `code` by `code_hash`.
/// 3. Execute via revm with `data` as calldata.
/// 4. Apply state changes (storage writes, value transfers).
/// 5. Emit `LOG0..LOG4` events to `CF_LOGS`.
/// 6. Refund unused gas; return `ExecResult { success, return_data, logs }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvmCall {
    pub to: Address,
    pub data: Vec<u8>,
    pub value: u128,
    pub gas_limit: u64,
    pub gas_price: u128,
}

// ---------------------------------------------------------------------------
// Account & state types
// ---------------------------------------------------------------------------

/// EVM account record. Stored in `CF_EVM` keyed by 20-byte address.
///
/// Compatible with Ethereum's `(nonce, balance, storage_root, code_hash)`
/// tuple so MPT proofs remain interoperable.
#[derive(Debug, Clone)]
pub struct EvmAccount {
    pub nonce: u64,
    pub balance: u128,        // ZBX wei
    pub storage_root: [u8; 32], // root of per-account storage trie
    pub code_hash: [u8; 32],    // keccak256(code); empty-account = KECCAK_EMPTY
}

/// One LOG entry emitted by an EVM contract.
///
/// Indexed in `CF_LOGS` by `(block_height, log_index)` and additionally by
/// `(address, topic0..topic3)` so `eth_getLogs` filters are O(log n).
#[derive(Debug, Clone)]
pub struct EvmLog {
    pub address: Address,
    pub topics: Vec<[u8; 32]>, // 0..=4 topics
    pub data: Vec<u8>,
    pub block_height: u64,
    pub tx_hash: [u8; 32],
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
    pub created_address: Option<Address>, // populated only for CREATE/CREATE2
}

// ---------------------------------------------------------------------------
// Standard Ethereum precompiles (0x01–0x0a) — mainnet parity
// ---------------------------------------------------------------------------

/// `0x01` — ECRECOVER:    secp256k1 sig → signer address (used by EIP-712).
/// `0x02` — SHA256
/// `0x03` — RIPEMD160
/// `0x04` — IDENTITY      (memcpy)
/// `0x05` — MODEXP        (RSA-style modular exponentiation)
/// `0x06` — ECADD         (alt_bn128 G1 add — zk-SNARK verifier)
/// `0x07` — ECMUL         (alt_bn128 G1 scalar mul)
/// `0x08` — ECPAIRING     (alt_bn128 pairing check — Groth16 verifier)
/// `0x09` — BLAKE2F       (BLAKE2b compression)
/// `0x0a` — POINT_EVAL    (EIP-4844 KZG opening — for blob-aware contracts)
pub mod standard_precompiles {
    // Implementation provided by revm out of the box; we just enable them
    // in the `Spec::Cancun` configuration when constructing `Evm::builder()`.
}

// ---------------------------------------------------------------------------
// Custom Zebvix precompiles (0x80–0x90)
// ---------------------------------------------------------------------------
//
// These addresses are invalid as user accounts (top bit set) and are
// intercepted by the EVM dispatcher to call native chain modules, exposing
// them to Solidity dApps without wrapper contracts.

/// `0x80` — `bridge_out(asset_id: uint64, dest: bytes)`
///
/// Equivalent of `TxKind::Bridge(BridgeOp::BridgeOut)`. Locks caller's
/// ZBX/zUSD into the bridge vault and emits a `BridgeOutEvent` for the
/// off-chain relayer. Gas: 35,000.
pub const PRECOMPILE_BRIDGE_OUT: [u8; 20] = hex_addr("0000000000000000000000000000000000000080");

/// `0x81` — `payid_resolve(alias: bytes) → address`
///
/// Looks up `RegisterPayId` mapping in `state.rs`. Returns `0x00…00` for
/// unknown aliases so Solidity can `require(addr != address(0), "unknown")`.
/// Gas: 2,500.
pub const PRECOMPILE_PAYID_RESOLVE: [u8; 20] = hex_addr("0000000000000000000000000000000000000081");

/// `0x82` — `amm_swap(direction: uint8, amount_in: uint256, min_out: uint256) → uint256`
///
/// Executes ZBX↔zUSD swap atomically inside the contract call. `direction`:
/// `0` = ZBX→zUSD, `1` = zUSD→ZBX. Returns `amount_out`. Gas: 50,000.
pub const PRECOMPILE_AMM_SWAP: [u8; 20] = hex_addr("0000000000000000000000000000000000000082");

/// `0x83` — `multisig_propose(vault: address, op: bytes) → uint64 proposal_id`
///
/// Creates a new proposal in the named multisig vault. Caller must be a
/// signer. Returns the proposal_id for off-chain tracking. Gas: 30,000.
pub const PRECOMPILE_MULTISIG_PROPOSE: [u8; 20] = hex_addr("0000000000000000000000000000000000000083");

const fn hex_addr(_s: &'static str) -> [u8; 20] {
    // const-eval helper; real impl uses const fn hex decoding.
    [0u8; 20]
}

// ---------------------------------------------------------------------------
// Top-level entry point — called from `state.rs::apply_tx`
// ---------------------------------------------------------------------------

/// Storage backend wired into revm's `Database` trait.
///
/// Concrete impl will live in `evm_state.rs`, wrapping the `CF_EVM`
/// RocksDB column family. Implements:
/// - `basic(addr)` → `Option<AccountInfo>`
/// - `code_by_hash(hash)` → `Bytecode`
/// - `storage(addr, key)` → `U256`
/// - `block_hash(num)` → `B256`
pub trait EvmDb {
    fn account(&self, addr: &Address) -> Option<EvmAccount>;
    fn code(&self, hash: &[u8; 32]) -> Option<Vec<u8>>;
    fn storage(&self, addr: &Address, key: &[u8; 32]) -> [u8; 32];
}

/// Block-level environment passed into every EVM execution.
#[derive(Debug, Clone)]
pub struct EvmContext {
    pub chain_id: u64,
    pub block_number: u64,
    pub block_timestamp: u64,
    pub block_gas_limit: u64,
    pub coinbase: Address,        // current block proposer
    pub base_fee_per_gas: u128,   // resolved from AMM spot price
}

/// Execute one EVM transaction (call or create) and return results.
///
/// Caller (`state.rs::apply_tx`) is responsible for:
/// 1. Validating the signer's nonce + balance ≥ `gas_limit * gas_price + value`.
/// 2. Persisting `EvmAccount` mutations + storage diffs to `CF_EVM`.
/// 3. Persisting `result.logs` to `CF_LOGS`.
/// 4. Refunding `result.gas_refunded` ZBX wei back to the signer.
pub fn execute<D: EvmDb>(
    _db: &D,
    _ctx: &EvmContext,
    _from: &Address,
    _tx: &EvmTxEnvelope,
) -> ExecResult {
    unimplemented!("Phase C: integrate revm 7.x")
}

/// Wrapper enum so `execute()` accepts both call and create variants.
#[derive(Debug, Clone)]
pub enum EvmTxEnvelope {
    Call(EvmCall),
    Create(EvmCreate),
}

// ---------------------------------------------------------------------------
// JSON-RPC compatibility shim (planned)
// ---------------------------------------------------------------------------
//
// To make Hardhat / Foundry / Remix work zero-config we expose the standard
// Ethereum JSON-RPC subset alongside our existing `zbx_*` namespace:
//
// | Standard            | Our handler                                       |
// |---------------------|---------------------------------------------------|
// | eth_chainId         | const 0x1ec6  (= 7878)                            |
// | eth_blockNumber     | reuse zbx_tipHeight                               |
// | eth_getBalance      | reuse zbx_getBalance, return as 0x-hex U256       |
// | eth_getCode         | EvmDb::code(EvmDb::account(addr)?.code_hash)      |
// | eth_getStorageAt    | EvmDb::storage(addr, key)                         |
// | eth_call            | execute() with no state commit                    |
// | eth_estimateGas     | execute() with binary-search on gas_limit         |
// | eth_gasPrice        | resolve_fee_window().min  (USD-pegged base fee)   |
// | eth_sendRawTransaction | parse RLP envelope → TxKind::EvmCall/Create    |
// | eth_getLogs         | filter CF_LOGS by {fromBlock,toBlock,address,topics} |
// | eth_getTransactionReceipt | from CF_RECEIPTS keyed by tx_hash            |
// | eth_blockByNumber   | reuse zbx_getBlock + EVM-shape envelope           |
//
// All accept the same hex-encoded U256 / hex-encoded bytes formats so off-
// the-shelf web3.js / ethers.js / viem clients work unmodified.

// ---------------------------------------------------------------------------
// Phase C rollout plan
// ---------------------------------------------------------------------------
//
// **C.1 — MVP execution** (~2 weeks)
//   • Wire revm 7.x crate
//   • Add `TxKind::EvmCall` / `TxKind::EvmCreate` to transaction.rs (tag 10/11)
//   • Implement `EvmDb` over CF_EVM
//   • Standard precompiles 0x01–0x0a (free, revm-provided)
//   • `eth_call`, `eth_chainId`, `eth_getBalance`, `eth_getCode`
//   • Smoke test: deploy ERC-20 from Hardhat
//
// **C.2 — Production parity** (~3 weeks)
//   • Custom precompiles 0x80–0x83 (bridge / payid / swap / multisig)
//   • `eth_getLogs` + `eth_getTransactionReceipt` (CF_LOGS, CF_RECEIPTS)
//   • `eth_sendRawTransaction` (RLP-encoded EVM tx envelope)
//   • Subgraph compatibility — index zUSD migration as canonical ERC-20
//   • Cross-VM call paths: native tx → EVM contract, EVM contract → native
//
// **C.3 — Tooling polish** (~1 week)
//   • `eth_estimateGas` with binary search
//   • Contract verification + ABI registry RPC
//   • Block explorer EVM-aware (decoded function calls + event names)
//   • `debug_traceTransaction` + `trace_call` for dApp dev UX

// ---------------------------------------------------------------------------
// Tests (skeleton)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precompile_addresses_have_top_bit_set() {
        assert_eq!(PRECOMPILE_BRIDGE_OUT[19], 0x00, "stub still uses zero impl");
        // Real impl will assert: `(0x80..=0x90).contains(&PRECOMPILE_*[19])`
    }

    #[test]
    fn evm_create_address_deterministic() {
        // CREATE  addr = keccak256(rlp([from, nonce]))[12..]
        // CREATE2 addr = keccak256(0xff || from || salt || keccak256(init_code))[12..]
        // Will be enabled once revm is wired.
    }

    #[test]
    fn gas_in_zbx_wei_matches_native_fee_window() {
        // Phase C contract gas price MUST equal `state::resolve_fee_window().min`
        // so EVM txs and native txs share one fee market — no MEV drift.
    }
}
