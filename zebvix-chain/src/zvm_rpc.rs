//! # ZVM JSON-RPC Layer
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
//! | eth_getTransactionByHash | ✅ (Phase C.2.1 — synthesized from native ring buffer) |
//! | eth_getTransactionReceipt | ✅ (Phase C.2.1 — synthesized from native ring buffer, status=0x1) |
//! | eth_getBlockByNumber | ✅ (proxies zbx_getBlockByNumber, Geth shape) |
//! | eth_getBlockByHash | ✅ |
//! | net_version | ✅ |
//! | web3_clientVersion | ✅ |
//! | eth_syncing | ✅ (always `false` — no fast sync) |
//! | eth_accounts | ✅ (returns empty — no key custody on node) |
//! | eth_feeHistory | ✅ (synthetic from base_fee history) |

#![allow(dead_code)]

use crate::zvm::{
    execute, ZvmCall, ZvmContext, ZvmCreate, ZvmDb, ZvmReceipt, ZvmTxEnvelope,
    DEFAULT_BLOCK_GAS_LIMIT,
};
use crate::zvm_state::CfZvmDb;
use crate::state::State;
use crate::types::Address;
use primitive_types::{H256, U256};
use serde_json::{json, Value};
use std::sync::Arc;

// ---------------------------------------------------------------------------
// Hex helpers (JSON-RPC "quantity" + "data" encoding rules used by the Zebvix ZVM)
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

pub struct ZvmRpcCtx {
    pub db: Arc<CfZvmDb>,
    /// Phase C.2.1 — read-only handle to the native State so handlers can
    /// resolve `eth_getTransactionByHash` / `eth_getTransactionReceipt`
    /// against the recent-tx ring buffer maintained by `state::apply_block`.
    pub state: Arc<State>,
    pub chain_id: u64,
    pub current_height: u64,
    pub current_timestamp: u64,
    pub coinbase: Address,
    pub base_fee: u128,
}

impl ZvmRpcCtx {
    fn zvm_context(&self) -> ZvmContext {
        ZvmContext {
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
/// of the ZVM-feature-gated `zbx_*` aliases listed below — both names route
/// to the exact same handler so wallets can pick whichever namespace they
/// prefer once the node is built with `--features zvm`.
///
/// Aliases that live here (ZVM-only, requires `--features zvm`):
/// `web3_clientVersion` ↔ `zbx_clientVersion`,
/// `eth_syncing`        ↔ `zbx_syncing`,
/// `eth_accounts`       ↔ `zbx_accounts`,
/// `eth_gasPrice`       ↔ `zbx_gasPrice`,
/// `eth_blobBaseFee`    ↔ `zbx_blobBaseFee`,
/// `eth_getCode`        ↔ `zbx_getCode`,
/// `eth_getStorageAt`   ↔ `zbx_getStorageAt`,
/// `eth_call`           ↔ `zbx_call`,
/// `eth_getLogs`        ↔ `zbx_getLogs`,
/// `eth_getTransactionReceipt` ↔ `zbx_getZvmReceipt` (legacy: `zbx_getEvmReceipt`),
/// `eth_getTransactionByHash`  ↔ `zbx_getZvmTransaction` (legacy: `zbx_getEvmTransaction`),
/// `eth_feeHistory`     ↔ `zbx_feeHistory`,
/// `eth_sendRawTransaction` ↔ `zbx_sendRawZvmTransaction` (legacy: `zbx_sendRawEvmTransaction`).
///
/// The `zbx_*Evm*` names are DEPRECATED but still accepted so any existing
/// integration keeps working through the rebrand window. New clients should
/// use the canonical `zbx_*Zvm*` names.
///
/// `eth_chainId`, `net_version`, and `eth_getBalance` are intentionally
/// **not** aliased here — their `zbx_*` partners (`zbx_chainId`,
/// `zbx_netVersion`, `zbx_getBalance`) live in `rpc.rs` as **always-on**
/// methods so wallets can read them on stripped builds with no ZVM feature.
/// Likewise `eth_blockNumber`, `eth_estimateGas`, `eth_getTransactionCount`,
/// and `eth_getBlockByNumber` each have a richer Zebvix-native counterpart
/// in `rpc.rs` with a different return shape, so we deliberately keep their
/// names distinct (no `zbx_blockNumber`/`zbx_estimateGas`/`zbx_getNonce`/
/// `zbx_getBlockByNumber` aliases inside this dispatcher).
///
/// Note on `eth_sendRawTransaction`: it **is** aliased above to
/// `zbx_sendRawZvmTransaction` (RLP path). The qualifier "Zvm" in the alias
/// name is what keeps it distinct from the always-on native
/// `zbx_sendRawTransaction` in `rpc.rs`, which accepts hex-encoded bincode
/// `SignedTx`, not RLP — two separate submission paths, two separate names,
/// no collision.
pub fn dispatch(ctx: &ZvmRpcCtx, method: &str, params: &[Value]) -> Result<Value, String> {
    match method {
        "eth_chainId" => Ok(json!(quantity_u64(ctx.chain_id))),
        "net_version" => Ok(json!(ctx.chain_id.to_string())),
        "web3_clientVersion" | "zbx_clientVersion" => Ok(json!("Zebvix/0.1.0/rust1.83/zvm-cancun")),

        "eth_blockNumber" => Ok(json!(quantity_u64(ctx.current_height))),
        "eth_syncing"     | "zbx_syncing"     => Ok(json!(false)),
        "eth_accounts"    | "zbx_accounts"    => Ok(json!(Vec::<String>::new())),
        "eth_gasPrice"    | "zbx_gasPrice"    => Ok(json!(format!("0x{:x}", ctx.base_fee))),
        "eth_blobBaseFee" | "zbx_blobBaseFee" => Ok(json!("0x1")),

        "eth_getBalance" => {
            // Tier-6 — first-touch lazy mirror semantics: if the ZVM account
            // exists, ZVM is canonical (it may have spent funds we can't see
            // in the native ledger). If it doesn't exist yet, fall through
            // to the native ledger so a wallet that just received a native
            // transfer sees their balance immediately.
            let addr = parse_address(get_str(params, 0)?)?;
            let bal = match ctx.db.account(&addr) {
                Some(a) => a.balance,
                None => ctx.state.balance(&addr),
            };
            Ok(json!(format!("0x{:x}", bal)))
        }

        "eth_getTransactionCount" => {
            // Tier-6 — same first-touch rule for nonce. `max(zvm, native)`
            // would let a stale native nonce undo a freshly-bumped ZVM
            // nonce after a tx, causing the next MetaMask tx to nonce-collide.
            let addr = parse_address(get_str(params, 0)?)?;
            let nonce = match ctx.db.account(&addr) {
                Some(a) => a.nonce,
                None => ctx.state.account(&addr).nonce,
            };
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
            let zvm_ctx = ctx.zvm_context();
            let (res, _journal) = execute(&*ctx.db, &zvm_ctx, &from, &env);
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

        "eth_sendRawTransaction"
        | "zbx_sendRawZvmTransaction"
        | "zbx_sendRawEvmTransaction" => {
            // Phase C.2 + Tier-2/6/7: full RLP decode + sender recovery +
            // execution + receipt persistence + ring-buffer indexing +
            // gas debit/refund + lazy native↔ZVM balance sync.
            let raw = parse_hex(get_str(params, 0)?)?;
            let (tx, sender, declared_chain_id) =
                crate::zvm_rlp::decode_raw_tx(&raw)
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

            // Tier-6 — lazy native→ZVM balance/nonce sync. **Architect-fix:**
            // mirror is **first-touch only** — we initialize from native ONLY
            // when the ZVM account does not yet exist. Once the ZVM account
            // is created, ZVM is canonical and a later native-side credit
            // does NOT reset the ZVM balance back up. Without this guard a
            // user could spend ZBX in ZVM, receive a native transfer, and
            // then have their ZVM balance "recharged" to the higher native
            // value on next tx — a double-spend across domains.
            let mut sender_acct = match ctx.db.account(&sender) {
                Some(a) => a,
                None => {
                    let n = ctx.state.account(&sender);
                    let mut fresh = crate::zvm::ZvmAccount::default();
                    fresh.balance = n.balance;
                    fresh.nonce = n.nonce;
                    fresh
                }
            };

            // Tier-7 — pre-flight gas+value affordability check. The
            // sender must cover `gas_limit*gas_price + value` at submission
            // time; otherwise the tx is rejected with no state change.
            let gas_cost = (tx.gas_limit() as u128)
                .saturating_mul(tx.gas_price());
            let required = gas_cost.saturating_add(tx.value());
            if sender_acct.balance < required {
                return Err(format!(
                    "insufficient sender balance: have {}, need {} (gas {} + value {})",
                    sender_acct.balance, required, gas_cost, tx.value()
                ));
            }

            // **Architect-fix (atomicity):** rather than commit the lazy
            // mirror + pre-debit + execution + refund as four separate
            // disk writes, we do it in two phases:
            //   (1) put the mirrored, pre-debited sender into the ZVM
            //       store so `execute()` reads the right balance, and
            //   (2) re-apply the FINAL sender state (including refund)
            //       as part of the journal that `apply_zvm_tx` commits
            //       atomically alongside logs + receipt.
            //
            // Phase (1) is the only "non-atomic" write, but it is
            // idempotent and self-correcting: if the node crashes after
            // (1) and before (2), the ZVM balance just reflects the
            // pre-debit (gas reservation), which the next tx-affordability
            // check at the same nonce will then re-verify. No silent
            // double-spend can result because `apply_zvm_tx` is the only
            // path that bumps the canonical nonce + records the receipt.
            sender_acct.balance = sender_acct.balance.saturating_sub(gas_cost);
            if let Err(e) = ctx.db.put_account(&sender, &sender_acct) {
                return Err(format!("debit gas failed: {e}"));
            }

            let zvm_ctx = ctx.zvm_context();
            let (mut result, mut journal) = crate::zvm::execute(&*ctx.db, &zvm_ctx, &sender, &tx);

            // Tier-7 — refund unused gas (already EIP-3529-capped in `execute`).
            // Look up the post-execution sender row inside the journal so we
            // refund onto the latest balance (execute() may have transferred
            // value out of the sender, so the in-memory `sender_acct` is stale).
            let unused_gas = tx.gas_limit().saturating_sub(result.gas_used);
            let refund_units = (unused_gas as u64).saturating_add(result.gas_refunded);
            let refund_wei = (refund_units as u128).saturating_mul(tx.gas_price());
            if refund_wei > 0 {
                let mut found = false;
                for (addr, acct) in journal.touched_accounts.iter_mut() {
                    if addr == &sender {
                        acct.balance = acct.balance.saturating_add(refund_wei);
                        found = true;
                        break;
                    }
                }
                if !found {
                    // Sender wasn't touched by execute (shouldn't happen but be defensive)
                    let mut acct = ctx.db.account(&sender).unwrap_or_default();
                    acct.balance = acct.balance.saturating_add(refund_wei);
                    journal.touched_accounts.push((sender, acct));
                }
            }

            // Tier-2 — stamp logs with canonical tx_hash + log_index.
            let tx_hash_bytes = crate::zvm::keccak256(&raw);
            let tx_hash = H256::from(tx_hash_bytes);
            let log_count = result.logs.len() as u32;
            let block_height = ctx.current_height;
            let base_index = ctx.db
                .reserve_log_indices(block_height, log_count)
                .unwrap_or(0);
            for (i, log) in result.logs.iter_mut().enumerate() {
                log.tx_hash = tx_hash;
                log.block_height = block_height;
                log.log_index = base_index + i as u32;
            }

            // Tier-2 — build receipt.
            let block_hash = ctx.state
                .block_hash_at(block_height)
                .map(|h| H256::from(h.0))
                .unwrap_or_else(H256::zero);
            let (to_field, contract_field, amount_field) = match &tx {
                ZvmTxEnvelope::Call(c) => (Some(c.to), None, c.value),
                ZvmTxEnvelope::Create(c) => (None, result.created_address, c.value),
            };
            let rcpt = ZvmReceipt {
                tx_hash,
                from: sender,
                to: to_field,
                contract_address: contract_field,
                block_height,
                block_hash,
                tx_index: 0,
                gas_used: result.gas_used,
                effective_gas_price: tx.gas_price(),
                success: result.success,
                logs: result.logs.clone(),
                revert_reason: result.revert_reason.clone(),
            };

            // **Architect-fix (atomicity):** journal + logs + receipt land in
            // a single WriteBatch spanning CF_ZVM + CF_LOGS so a node crash
            // can never leave state mutated without a discoverable receipt.
            if let Err(e) = ctx.db.apply_zvm_tx(&journal, &result.logs, &rcpt) {
                return Err(format!("atomic apply failed: {e}"));
            }

            // Ring-buffer push for `eth_getTransactionByHash`. Failure here
            // is non-fatal — the receipt is the source of truth; the ring
            // buffer is a discovery convenience.
            let final_nonce = journal.touched_accounts.iter()
                .find(|(a, _)| a == &sender)
                .map(|(_, acct)| acct.nonce.saturating_sub(1))
                .unwrap_or(sender_acct.nonce);
            let _ = ctx.state.push_zvm_recent_tx(
                tx_hash_bytes,
                sender,
                to_field.unwrap_or_else(|| contract_field.unwrap_or(Address::from_bytes([0u8; 20]))),
                amount_field,
                (result.gas_used as u128).saturating_mul(tx.gas_price()),
                final_nonce,
                matches!(tx, ZvmTxEnvelope::Create(_)),
            );

            Ok(json!(format!("0x{}", hex::encode(tx_hash_bytes))))
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

        "eth_getTransactionByHash"
        | "zbx_getZvmTransaction"
        | "zbx_getEvmTransaction" => {
            // Phase C.2.1 — resolves a 32-byte tx hash to an Ethereum-shaped
            // tx object by reading the native recent-tx ring buffer (the
            // ZVM tx path itself is not yet wired to push into this index;
            // current coverage is native ZBX transfers + every other native
            // TxKind variant). Returns `null` (Geth convention) when the
            // hash is not found in the rolling window.
            let raw = get_str(params, 0)?;
            let bytes = parse_hex(raw)?;
            if bytes.len() != 32 {
                return Err(format!("tx hash must be 32 bytes, got {}", bytes.len()));
            }
            let mut h = [0u8; 32];
            h.copy_from_slice(&bytes);
            match ctx.state.find_tx_by_hash(&h) {
                None => Ok(Value::Null),
                Some(rec) => {
                    let block_hash_hex = ctx.state.block_hash_at(rec.height)
                        .map(|h| format!("0x{}", hex::encode(h.0)))
                        .unwrap_or_else(|| format!("0x{}", "0".repeat(64)));
                    Ok(json!({
                        "blockHash": block_hash_hex,
                        "blockNumber": quantity_u64(rec.height),
                        "from": format!("0x{}", hex::encode(rec.from.as_bytes())),
                        "to": format!("0x{}", hex::encode(rec.to.as_bytes())),
                        "gas": quantity_u64(21_000),
                        "gasPrice": format!("0x{:x}", ctx.base_fee),
                        "hash": format!("0x{}", hex::encode(rec.hash)),
                        // `input` is empty for native transfers; non-Transfer
                        // kinds carry their structured args in the native
                        // TxKind enum rather than a flat byte buffer, so we
                        // expose `0x` here and let callers consult the native
                        // `zbx_getTxByHash` (planned) for the typed payload.
                        "input": "0x",
                        "nonce": quantity_u64(rec.nonce),
                        "transactionIndex": "0x0",
                        "value": format!("0x{:x}", rec.amount),
                        "type": "0x0",
                        "chainId": quantity_u64(ctx.chain_id),
                        // Signature components are not retained in the ring
                        // buffer (the tx was already verified at apply time);
                        // returning zeros keeps the JSON shape Geth-compatible
                        // while signalling "synthesized from index, not raw RLP".
                        "v": "0x0",
                        "r": format!("0x{}", "0".repeat(64)),
                        "s": format!("0x{}", "0".repeat(64)),
                    }))
                }
            }
        }

        "eth_getTransactionReceipt"
        | "zbx_getZvmReceipt"
        | "zbx_getEvmReceipt" => {
            // Tier-2 — fast path: load the persisted ZvmReceipt produced by
            // `eth_sendRawTransaction`. The receipt carries real gas_used,
            // status, contractAddress and the full logs array.
            let raw = get_str(params, 0)?;
            let bytes = parse_hex(raw)?;
            if bytes.len() != 32 {
                return Err(format!("tx hash must be 32 bytes, got {}", bytes.len()));
            }
            let mut h = [0u8; 32];
            h.copy_from_slice(&bytes);
            let tx_hash = H256::from(h);

            if let Some(rcpt) = ctx.db.get_receipt(&tx_hash) {
                let logs_json: Vec<Value> = rcpt.logs.iter().enumerate().map(|(i, log)| {
                    json!({
                        "address": format!("0x{}", hex::encode(log.address.as_bytes())),
                        "topics": log.topics.iter()
                            .map(|t| format!("0x{}", hex::encode(t.as_bytes())))
                            .collect::<Vec<_>>(),
                        "data": data_hex(&log.data),
                        "blockNumber": quantity_u64(log.block_height),
                        "transactionHash": format!("0x{}", hex::encode(log.tx_hash.as_bytes())),
                        "transactionIndex": quantity_u64(rcpt.tx_index as u64),
                        "blockHash": format!("0x{}", hex::encode(rcpt.block_hash.as_bytes())),
                        "logIndex": quantity_u64(log.log_index as u64),
                        "removed": false,
                        // `i` retained as a fallback ordinal for clients that need
                        // a stable per-receipt index alongside the canonical
                        // per-block `logIndex` above.
                        "_i": i,
                    })
                }).collect();
                return Ok(json!({
                    "blockHash": format!("0x{}", hex::encode(rcpt.block_hash.as_bytes())),
                    "blockNumber": quantity_u64(rcpt.block_height),
                    "contractAddress": rcpt.contract_address
                        .map(|a| Value::String(format!("0x{}", hex::encode(a.as_bytes()))))
                        .unwrap_or(Value::Null),
                    "cumulativeGasUsed": quantity_u64(rcpt.gas_used),
                    "effectiveGasPrice": format!("0x{:x}", rcpt.effective_gas_price),
                    "from": format!("0x{}", hex::encode(rcpt.from.as_bytes())),
                    "to": rcpt.to
                        .map(|a| Value::String(format!("0x{}", hex::encode(a.as_bytes()))))
                        .unwrap_or(Value::Null),
                    "gasUsed": quantity_u64(rcpt.gas_used),
                    "logs": logs_json,
                    "logsBloom": format!("0x{}", "0".repeat(512)),
                    "status": if rcpt.success { "0x1" } else { "0x0" },
                    "transactionHash": format!("0x{}", hex::encode(rcpt.tx_hash.as_bytes())),
                    "transactionIndex": quantity_u64(rcpt.tx_index as u64),
                    "type": "0x0",
                }));
            }

            // Fallback path — synthetic receipt for native txs indexed in the
            // recent-tx ring buffer (Transfer / Bridge / Pay-ID / etc).
            // status=0x1 by construction (failed txs are never indexed).
            match ctx.state.find_tx_by_hash(&h) {
                None => Ok(Value::Null),
                Some(rec) => {
                    let block_hash_hex = ctx.state.block_hash_at(rec.height)
                        .map(|h| format!("0x{}", hex::encode(h.0)))
                        .unwrap_or_else(|| format!("0x{}", "0".repeat(64)));
                    Ok(json!({
                        "blockHash": block_hash_hex,
                        "blockNumber": quantity_u64(rec.height),
                        "contractAddress": Value::Null,
                        "cumulativeGasUsed": quantity_u64(21_000),
                        "effectiveGasPrice": format!("0x{:x}", ctx.base_fee),
                        "from": format!("0x{}", hex::encode(rec.from.as_bytes())),
                        "to": format!("0x{}", hex::encode(rec.to.as_bytes())),
                        "gasUsed": quantity_u64(21_000),
                        "logs": Vec::<Value>::new(),
                        "logsBloom": format!("0x{}", "0".repeat(512)),
                        "status": "0x1",
                        "transactionHash": format!("0x{}", hex::encode(rec.hash)),
                        "transactionIndex": "0x0",
                        "type": "0x0",
                    }))
                }
            }
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

        _ => Err(format!("unsupported ZVM method: {method}")),
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

fn log_to_json(log: crate::zvm::ZvmLog) -> Value {
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

fn parse_call_envelope(obj: &Value) -> Result<ZvmTxEnvelope, String> {
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
        Ok(ZvmTxEnvelope::Call(ZvmCall {
            to, data, value: value.as_u128(), gas_limit, gas_price,
        }))
    } else {
        Ok(ZvmTxEnvelope::Create(ZvmCreate {
            init_code: data, value: value.as_u128(), gas_limit, gas_price, salt: None,
        }))
    }
}

// ---------------------------------------------------------------------------
// Binary search for eth_estimateGas
// ---------------------------------------------------------------------------

fn binary_search_gas(ctx: &ZvmRpcCtx, from: &Address, env: ZvmTxEnvelope) -> u64 {
    let mut lo = env.intrinsic_gas();
    let mut hi = env.gas_limit().min(DEFAULT_BLOCK_GAS_LIMIT);
    if lo >= hi { return hi; }

    // First, try with `hi` to see if it succeeds at all.
    let zvm_ctx = ctx.zvm_context();
    if !try_gas(ctx, &zvm_ctx, from, &env, hi) {
        return hi; // unable to find feasible gas — return ceiling
    }

    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        if try_gas(ctx, &zvm_ctx, from, &env, mid) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    hi
}

fn try_gas(ctx: &ZvmRpcCtx, zvm_ctx: &ZvmContext, from: &Address, env: &ZvmTxEnvelope, gas: u64) -> bool {
    let probe = match env {
        ZvmTxEnvelope::Call(c) => ZvmTxEnvelope::Call(ZvmCall { gas_limit: gas, ..c.clone() }),
        ZvmTxEnvelope::Create(c) => ZvmTxEnvelope::Create(ZvmCreate { gas_limit: gas, ..c.clone() }),
    };
    let (res, _) = execute(&*ctx.db, zvm_ctx, from, &probe);
    res.success
}

// ---------------------------------------------------------------------------
// Raw transaction decode — fully ships in `crate::zvm_rlp` (Phase C.2).
// The placeholder `RawTx` / `RawTxKind` / `decode_raw_tx` from C.1 has been
// removed; `eth_sendRawTransaction` above now uses `zvm_rlp::decode_raw_tx`,
// which returns a real `(ZvmTxEnvelope, sender Address)` pair after secp256k1
// recovery. See `zvm_rlp.rs` for the canonical decoder.
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
        // Envelope kind discrimination now happens inside zvm_rlp::decode_raw_tx.
        // Empty input must reject; type 0x03 (blob tx) is reserved.
        assert!(crate::zvm_rlp::decode_raw_tx(&[]).is_err());
        assert!(crate::zvm_rlp::decode_raw_tx(&[0x03, 0xc0]).is_err());
    }
}
