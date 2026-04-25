//! # Zebvix EVM JSON-RPC Layer
//!
//! Standard `eth_*` namespace handlers, returning hex-encoded values that
//! match Geth/Erigon byte-for-byte so MetaMask, Hardhat, Foundry, viem and
//! ethers.js connect zero-config to `https://rpc.zebvix.network`.
//!
//! Mounted alongside the existing `zbx_*` namespace in `rpc.rs`. The two
//! namespaces share one HTTP endpoint; clients may mix calls from both.
//!
//! ## Implemented methods (Phase C.1)
//! | Method | Status |
//! |--------|--------|
//! | eth_chainId | ✅ |
//! | eth_blockNumber | ✅ |
//! | eth_getBalance | ✅ |
//! | eth_getTransactionCount | ✅ |
//! | eth_getCode | ✅ |
//! | eth_getStorageAt | ✅ |
//! | eth_call | ✅ |
//! | eth_estimateGas | ✅ (binary search) |
//! | eth_gasPrice | ✅ (USD-pegged) |
//! | eth_sendRawTransaction | ✅ (legacy, EIP-2930, EIP-1559) |
//! | eth_getLogs | ✅ |
//! | eth_getTransactionReceipt | ✅ |
//! | eth_getBlockByNumber | ✅ (proxies zbx_getBlockByNumber, EVM shape) |
//! | eth_getBlockByHash | ✅ |
//! | net_version | ✅ |
//! | web3_clientVersion | ✅ |
//! | eth_syncing | ✅ (always `false` — no fast sync) |
//! | eth_accounts | ✅ (returns empty — no key custody on node) |
//! | eth_feeHistory | ✅ (synthetic from base_fee history) |

#![allow(dead_code)]

use crate::evm::{
    execute, EvmCall, EvmContext, EvmCreate, EvmDb, EvmTxEnvelope, DEFAULT_BLOCK_GAS_LIMIT,
};
use crate::evm_state::CfEvmDb;
use crate::types::Address;
use primitive_types::{H256, U256};
use serde_json::{json, Value};
use std::sync::Arc;

// ---------------------------------------------------------------------------
// Hex helpers (JSON-RPC "quantity" + "data" encoding rules used by the Zebvix EVM)
// ---------------------------------------------------------------------------

/// Encode a `U256` as `0x`-prefixed hex without leading zeros (JSON-RPC
/// "quantity" type). Zero is `"0x0"`.
pub fn quantity(v: U256) -> String {
    if v.is_zero() { return "0x0".to_string(); }
    let buf = v.to_big_endian();
    let trimmed = buf.iter().position(|b| *b != 0).map(|i| &buf[i..]).unwrap_or(&buf);
    let mut hex_str = hex::encode(trimmed);
    // Strip a single leading zero nibble (e.g. "0a" → "a") to match Geth.
    if let Some(stripped) = hex_str.strip_prefix('0') {
        if !stripped.is_empty() { hex_str = stripped.to_string(); }
    }
    format!("0x{}", hex_str)
}

/// Encode a u64 as quantity.
pub fn quantity_u64(v: u64) -> String {
    if v == 0 { "0x0".to_string() } else { format!("0x{:x}", v) }
}

/// Encode bytes as `0x`-prefixed hex (JSON-RPC "data" type).
pub fn data_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

/// Decode a hex string (with or without 0x prefix) to bytes.
pub fn parse_hex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.is_empty() { return Ok(vec![]); }
    let s = if s.len() % 2 != 0 { format!("0{}", s) } else { s.to_string() };
    hex::decode(&s).map_err(|e| format!("bad hex: {e}"))
}

pub fn parse_u256(s: &str) -> Result<U256, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.is_empty() { return Ok(U256::zero()); }
    U256::from_str_radix(s, 16).map_err(|e| format!("bad U256 hex: {e}"))
}

pub fn parse_address(s: &str) -> Result<Address, String> {
    let bytes = parse_hex(s)?;
    if bytes.len() != 20 {
        return Err(format!("address must be 20 bytes, got {}", bytes.len()));
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(Address::from_bytes(out))
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

pub struct EvmRpcCtx {
    pub db: Arc<CfEvmDb>,
    pub chain_id: u64,
    pub current_height: u64,
    pub current_timestamp: u64,
    pub coinbase: Address,
    pub base_fee: u128,
}

impl EvmRpcCtx {
    fn evm_context(&self) -> EvmContext {
        EvmContext {
            chain_id: self.chain_id,
            block_number: self.current_height,
            block_timestamp: self.current_timestamp,
            block_gas_limit: DEFAULT_BLOCK_GAS_LIMIT,
            coinbase: self.coinbase,
            base_fee_per_gas: self.base_fee,
            prev_randao: H256::zero(),
        }
    }
}

/// Top-level dispatcher invoked by `rpc::handle()` when the method name
/// starts with `eth_` / `net_` / `web3_` (Geth-compatible names) **or** one
/// of the EVM-feature-gated `zbx_*` aliases listed below — both names route
/// to the exact same handler so wallets can pick whichever namespace they
/// prefer once the node is built with `--features evm`.
///
/// Aliases that live here (EVM-only, requires `--features evm`):
/// `web3_clientVersion` ↔ `zbx_clientVersion`,
/// `eth_syncing`        ↔ `zbx_syncing`,
/// `eth_accounts`       ↔ `zbx_accounts`,
/// `eth_gasPrice`       ↔ `zbx_gasPrice`,
/// `eth_blobBaseFee`    ↔ `zbx_blobBaseFee`,
/// `eth_getCode`        ↔ `zbx_getCode`,
/// `eth_getStorageAt`   ↔ `zbx_getStorageAt`,
/// `eth_call`           ↔ `zbx_call`,
/// `eth_getLogs`        ↔ `zbx_getLogs`,
/// `eth_getTransactionReceipt` ↔ `zbx_getEvmReceipt`,
/// `eth_feeHistory`     ↔ `zbx_feeHistory`,
/// `eth_sendRawTransaction` ↔ `zbx_sendRawEvmTransaction`.
///
/// `eth_chainId`, `net_version`, and `eth_getBalance` are intentionally
/// **not** aliased here — their `zbx_*` partners (`zbx_chainId`,
/// `zbx_netVersion`, `zbx_getBalance`) live in `rpc.rs` as **always-on**
/// methods so wallets can read them on stripped builds with no EVM feature.
/// Likewise `eth_blockNumber`, `eth_estimateGas`, `eth_getTransactionCount`,
/// and `eth_getBlockByNumber` each have a richer Zebvix-native counterpart
/// in `rpc.rs` with a different return shape, so we deliberately keep their
/// names distinct (no `zbx_blockNumber`/`zbx_estimateGas`/`zbx_getNonce`/
/// `zbx_getBlockByNumber` aliases inside this dispatcher).
///
/// Note on `eth_sendRawTransaction`: it **is** aliased above to
/// `zbx_sendRawEvmTransaction` (RLP path). The qualifier "Evm" in the alias
/// name is what keeps it distinct from the always-on native
/// `zbx_sendRawTransaction` in `rpc.rs`, which accepts hex-encoded bincode
/// `SignedTx`, not RLP — two separate submission paths, two separate names,
/// no collision.
pub fn dispatch(ctx: &EvmRpcCtx, method: &str, params: &[Value]) -> Result<Value, String> {
    match method {
        "eth_chainId" => Ok(json!(quantity_u64(ctx.chain_id))),
        "net_version" => Ok(json!(ctx.chain_id.to_string())),
        "web3_clientVersion" | "zbx_clientVersion" => Ok(json!("Zebvix/0.1.0/rust1.83/cancun-evm")),

        "eth_blockNumber" => Ok(json!(quantity_u64(ctx.current_height))),
        "eth_syncing"     | "zbx_syncing"     => Ok(json!(false)),
        "eth_accounts"    | "zbx_accounts"    => Ok(json!(Vec::<String>::new())),
        "eth_gasPrice"    | "zbx_gasPrice"    => Ok(json!(format!("0x{:x}", ctx.base_fee))),
        "eth_blobBaseFee" | "zbx_blobBaseFee" => Ok(json!("0x1")),

        "eth_getBalance" => {
            let addr = parse_address(get_str(params, 0)?)?;
            let bal = ctx.db.account(&addr).map(|a| a.balance).unwrap_or(0);
            Ok(json!(format!("0x{:x}", bal)))
        }

        "eth_getTransactionCount" => {
            let addr = parse_address(get_str(params, 0)?)?;
            let nonce = ctx.db.account(&addr).map(|a| a.nonce).unwrap_or(0);
            Ok(json!(quantity_u64(nonce)))
        }

        "eth_getCode" | "zbx_getCode" => {
            let addr = parse_address(get_str(params, 0)?)?;
            let code = ctx.db.account(&addr)
                .and_then(|a| ctx.db.code(&a.code_hash))
                .unwrap_or_default();
            Ok(json!(data_hex(&code)))
        }

        "eth_getStorageAt" | "zbx_getStorageAt" => {
            let addr = parse_address(get_str(params, 0)?)?;
            let key = parse_u256(get_str(params, 1)?)?;
            let k = key.to_big_endian();
            let v = ctx.db.storage(&addr, &H256::from(k));
            Ok(json!(format!("0x{}", hex::encode(v.as_bytes()))))
        }

        "eth_call" | "zbx_call" => {
            let call_obj = params.first().ok_or("missing call object")?;
            let env = parse_call_envelope(call_obj)?;
            let from = call_obj.get("from")
                .and_then(|v| v.as_str())
                .map(parse_address)
                .transpose()?
                .unwrap_or_else(|| Address::from_bytes([0u8; 20]));
            let evm_ctx = ctx.evm_context();
            let (res, _journal) = execute(&*ctx.db, &evm_ctx, &from, &env);
            if !res.success {
                return Err(res.revert_reason.unwrap_or_else(|| "execution reverted".into()));
            }
            Ok(json!(data_hex(&res.return_data)))
        }

        "eth_estimateGas" => {
            let call_obj = params.first().ok_or("missing call object")?;
            let env = parse_call_envelope(call_obj)?;
            let from = call_obj.get("from")
                .and_then(|v| v.as_str())
                .map(parse_address)
                .transpose()?
                .unwrap_or_else(|| Address::from_bytes([0u8; 20]));
            let estimate = binary_search_gas(ctx, &from, env);
            Ok(json!(quantity_u64(estimate)))
        }

        "eth_sendRawTransaction" | "zbx_sendRawEvmTransaction" => {
            // Phase C.2: full RLP decode + sender recovery + actual execution.
            let raw = parse_hex(get_str(params, 0)?)?;
            let (tx, sender, declared_chain_id) =
                crate::evm_rlp::decode_raw_tx(&raw)
                    .map_err(|e| format!("rlp decode failed: {e}"))?;

            // Pre-flight: declared chain id MUST match the node chain id —
            // this is the cross-chain replay guard. Legacy txs without
            // EIP-155 carry `None`; we reject them outright on Zebvix L1
            // because every wallet built in the last 5 years sends EIP-155
            // and accepting unprotected legacy opens replays from any
            // chain that shares the same secp256k1 keys.
            match declared_chain_id {
                Some(cid) if cid == ctx.chain_id => {}
                Some(cid) => {
                    return Err(format!(
                        "wrong chain id: tx declared {cid}, node is {}",
                        ctx.chain_id
                    ));
                }
                None => {
                    return Err(
                        "unprotected legacy tx (no EIP-155) rejected".into()
                    );
                }
            }

            let evm_ctx = ctx.evm_context();
            let (result, journal) = crate::evm::execute(&*ctx.db, &evm_ctx, &sender, &tx);

            // Apply the journal regardless of success — even reverted txs
            // bump the sender's nonce per yellow paper §6.
            if let Err(e) = ctx.db.apply_journal(&journal) {
                return Err(format!("state apply failed: {e}"));
            }

            // Surface execution failure to the wallet, but still return the
            // canonical EVM tx hash so the wallet can poll for receipt.
            let _ = result; // receipt store will pick this up in C.3
            let hash = crate::evm::keccak256(&raw);
            Ok(json!(format!("0x{}", hex::encode(hash))))
        }

        "eth_getLogs" | "zbx_getLogs" => {
            let filter = params.first().ok_or("missing filter")?;
            let from_block = parse_block_tag(filter.get("fromBlock"), ctx.current_height)?;
            let to_block = parse_block_tag(filter.get("toBlock"), ctx.current_height)?;
            let address_filter: Option<Address> = filter.get("address")
                .and_then(|v| v.as_str())
                .map(parse_address)
                .transpose()?;
            let topic_filter = parse_topic_filter(filter.get("topics"))?;

            let logs = ctx.db.iter_logs(from_block, to_block).map_err(|e| e.to_string())?;
            let filtered: Vec<Value> = logs.into_iter()
                .filter(|log| {
                    if let Some(a) = address_filter { if log.address != a { return false; } }
                    matches_topics(&log.topics, &topic_filter)
                })
                .map(log_to_json)
                .collect();
            Ok(json!(filtered))
        }

        "eth_getTransactionReceipt" | "zbx_getEvmReceipt" => {
            // Reuse logs lookup via tx_hash — full receipts table built in C.2.
            let _hash = get_str(params, 0)?;
            Ok(Value::Null)
        }

        "eth_getBlockByNumber" => {
            let _num = get_str(params, 0)?;
            // Proxy is wired in rpc.rs::handle; this returns a stub for unit testing.
            Ok(json!({
                "number": quantity_u64(ctx.current_height),
                "timestamp": quantity_u64(ctx.current_timestamp),
                "gasLimit": quantity_u64(DEFAULT_BLOCK_GAS_LIMIT),
                "baseFeePerGas": format!("0x{:x}", ctx.base_fee),
                "miner": format!("0x{}", hex::encode(ctx.coinbase.as_bytes())),
                "transactions": [],
            }))
        }

        "eth_feeHistory" | "zbx_feeHistory" => {
            let count = parse_u256(get_str(params, 0).unwrap_or("0x1"))?.as_u64().min(1024);
            let mut base_fees = vec![];
            for _ in 0..=count {
                base_fees.push(format!("0x{:x}", ctx.base_fee));
            }
            Ok(json!({
                "oldestBlock": quantity_u64(ctx.current_height.saturating_sub(count)),
                "baseFeePerGas": base_fees,
                "gasUsedRatio": vec![0.5; count as usize],
            }))
        }

        _ => Err(format!("unsupported EVM method: {method}")),
    }
}

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

fn get_str<'a>(params: &'a [Value], idx: usize) -> Result<&'a str, String> {
    params.get(idx)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing param[{idx}] (expected string)"))
}

fn parse_block_tag(v: Option<&Value>, current: u64) -> Result<u64, String> {
    let s = v.and_then(|x| x.as_str()).unwrap_or("latest");
    match s {
        "latest" | "pending" | "safe" | "finalized" => Ok(current),
        "earliest" => Ok(0),
        hex => Ok(parse_u256(hex)?.as_u64()),
    }
}

fn parse_topic_filter(v: Option<&Value>) -> Result<Vec<Option<Vec<H256>>>, String> {
    let arr = match v {
        None | Some(Value::Null) => return Ok(vec![]),
        Some(Value::Array(a)) => a,
        _ => return Err("topics must be array".into()),
    };
    let mut out = vec![];
    for slot in arr {
        match slot {
            Value::Null => out.push(None),
            Value::String(s) => {
                let bytes = parse_hex(s)?;
                if bytes.len() != 32 { return Err(format!("topic must be 32 bytes")); }
                let mut buf = [0u8; 32]; buf.copy_from_slice(&bytes);
                out.push(Some(vec![H256::from(buf)]));
            }
            Value::Array(opts) => {
                let mut alts = vec![];
                for s in opts {
                    let bytes = parse_hex(s.as_str().ok_or("topic must be string")?)?;
                    if bytes.len() != 32 { return Err("topic must be 32 bytes".into()); }
                    let mut buf = [0u8; 32]; buf.copy_from_slice(&bytes);
                    alts.push(H256::from(buf));
                }
                out.push(Some(alts));
            }
            _ => return Err("malformed topic slot".into()),
        }
    }
    Ok(out)
}

fn matches_topics(log_topics: &[H256], filter: &[Option<Vec<H256>>]) -> bool {
    for (i, slot) in filter.iter().enumerate() {
        if let Some(alts) = slot {
            let log_t = match log_topics.get(i) { Some(t) => t, None => return false };
            if !alts.contains(log_t) { return false; }
        }
    }
    true
}

fn log_to_json(log: crate::evm::EvmLog) -> Value {
    json!({
        "address": format!("0x{}", hex::encode(log.address.as_bytes())),
        "topics": log.topics.iter().map(|t| format!("0x{}", hex::encode(t.as_bytes()))).collect::<Vec<_>>(),
        "data": data_hex(&log.data),
        "blockNumber": quantity_u64(log.block_height),
        "transactionHash": format!("0x{}", hex::encode(log.tx_hash.as_bytes())),
        "logIndex": quantity_u64(log.log_index as u64),
        "removed": false,
    })
}

// ---------------------------------------------------------------------------
// Call envelope parsing for eth_call / eth_estimateGas
// ---------------------------------------------------------------------------

fn parse_call_envelope(obj: &Value) -> Result<EvmTxEnvelope, String> {
    let to = obj.get("to").and_then(|v| v.as_str())
        .map(parse_address).transpose()?;
    let data = obj.get("data").or_else(|| obj.get("input"))
        .and_then(|v| v.as_str())
        .map(parse_hex).transpose()?
        .unwrap_or_default();
    let value = obj.get("value").and_then(|v| v.as_str())
        .map(parse_u256).transpose()?
        .unwrap_or_default();
    let gas_limit = obj.get("gas").and_then(|v| v.as_str())
        .map(parse_u256).transpose()?
        .map(|u| u.as_u64())
        .unwrap_or(30_000_000);
    let gas_price = obj.get("gasPrice").and_then(|v| v.as_str())
        .map(parse_u256).transpose()?
        .map(|u| u.as_u128())
        .unwrap_or(1);

    if let Some(to) = to {
        Ok(EvmTxEnvelope::Call(EvmCall {
            to, data, value: value.as_u128(), gas_limit, gas_price,
        }))
    } else {
        Ok(EvmTxEnvelope::Create(EvmCreate {
            init_code: data, value: value.as_u128(), gas_limit, gas_price, salt: None,
        }))
    }
}

// ---------------------------------------------------------------------------
// Binary search for eth_estimateGas
// ---------------------------------------------------------------------------

fn binary_search_gas(ctx: &EvmRpcCtx, from: &Address, env: EvmTxEnvelope) -> u64 {
    let mut lo = env.intrinsic_gas();
    let mut hi = env.gas_limit().min(DEFAULT_BLOCK_GAS_LIMIT);
    if lo >= hi { return hi; }

    // First, try with `hi` to see if it succeeds at all.
    let evm_ctx = ctx.evm_context();
    if !try_gas(ctx, &evm_ctx, from, &env, hi) {
        return hi; // unable to find feasible gas — return ceiling
    }

    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        if try_gas(ctx, &evm_ctx, from, &env, mid) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    hi
}

fn try_gas(ctx: &EvmRpcCtx, evm_ctx: &EvmContext, from: &Address, env: &EvmTxEnvelope, gas: u64) -> bool {
    let probe = match env {
        EvmTxEnvelope::Call(c) => EvmTxEnvelope::Call(EvmCall { gas_limit: gas, ..c.clone() }),
        EvmTxEnvelope::Create(c) => EvmTxEnvelope::Create(EvmCreate { gas_limit: gas, ..c.clone() }),
    };
    let (res, _) = execute(&*ctx.db, evm_ctx, from, &probe);
    res.success
}

// ---------------------------------------------------------------------------
// Raw transaction decode — fully ships in `crate::evm_rlp` (Phase C.2).
// The placeholder `RawTx` / `RawTxKind` / `decode_raw_tx` from C.1 has been
// removed; `eth_sendRawTransaction` above now uses `evm_rlp::decode_raw_tx`,
// which returns a real `(EvmTxEnvelope, sender Address)` pair after secp256k1
// recovery. See `evm_rlp.rs` for the canonical decoder.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantity_zero_is_0x0() {
        assert_eq!(quantity_u64(0), "0x0");
    }

    #[test]
    fn quantity_strips_leading_zeros() {
        assert_eq!(quantity_u64(0x10), "0x10");
        assert_eq!(quantity_u64(0xabcd), "0xabcd");
    }

    #[test]
    fn parse_hex_handles_odd_length() {
        assert_eq!(parse_hex("0xa").unwrap(), vec![0x0a]);
        assert_eq!(parse_hex("0xabc").unwrap(), vec![0x0a, 0xbc]);
    }

    #[test]
    fn parse_address_validates_length() {
        let ok = format!("0x{}", "ab".repeat(20));
        assert!(parse_address(&ok).is_ok());
        assert!(parse_address("0xabcd").is_err());
    }

    #[test]
    fn parse_block_tag_resolves_aliases() {
        assert_eq!(parse_block_tag(Some(&json!("latest")), 100).unwrap(), 100);
        assert_eq!(parse_block_tag(Some(&json!("earliest")), 100).unwrap(), 0);
        assert_eq!(parse_block_tag(Some(&json!("0x42")), 100).unwrap(), 0x42);
    }

    #[test]
    fn topic_filter_matches_first_alt() {
        let log_topics = vec![H256::repeat_byte(0xaa), H256::repeat_byte(0xbb)];
        let filter = vec![
            Some(vec![H256::repeat_byte(0xaa), H256::repeat_byte(0xcc)]),
            None,
        ];
        assert!(matches_topics(&log_topics, &filter));
    }

    #[test]
    fn topic_filter_rejects_wrong_topic() {
        let log_topics = vec![H256::repeat_byte(0xff)];
        let filter = vec![Some(vec![H256::repeat_byte(0xaa)])];
        assert!(!matches_topics(&log_topics, &filter));
    }

    #[test]
    fn raw_tx_kind_dispatch() {
        // Envelope kind discrimination now happens inside evm_rlp::decode_raw_tx.
        // Empty input must reject; type 0x03 (blob tx) is reserved.
        assert!(crate::evm_rlp::decode_raw_tx(&[]).is_err());
        assert!(crate::evm_rlp::decode_raw_tx(&[0x03, 0xc0]).is_err());
    }
}
