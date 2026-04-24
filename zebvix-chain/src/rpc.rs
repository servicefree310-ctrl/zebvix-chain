//! Minimal JSON-RPC HTTP server. Methods (Ethereum-style naming):
//!   - eth_chainId            -> "0x1ec6"  (7878)
//!   - eth_blockNumber        -> "0x..."   (Ethereum-compatible hex)
//!   - zbx_blockNumber        -> { height, hex, hash, timestamp_ms, proposer }
//!   - eth_getBalance         -> "0x..."  (wei)
//!   - zbx_getNonce           -> u64
//!   - zbx_sendTransaction    -> tx hash (accepts JSON SignedTx)
//!   - zbx_sendRawTransaction -> tx hash (accepts hex-encoded bincode SignedTx;
//!                                preferred for mobile/light clients to avoid
//!                                JSON encoding pitfalls with u128 / fixed-size
//!                                byte arrays)
//!   - zbx_getBlockByNumber   -> Block JSON
//!   - zbx_supply             -> { minted_wei, premine_wei, pool_seed_wei,
//!                                  pool_reserve_wei, burned_wei,
//!                                  circulating_wei, max_wei,
//!                                  current_block_reward_wei, height }
//!   - zbx_getValidator       -> { address, pubkey, voting_power } | null

use crate::mempool::Mempool;
use crate::p2p::P2PMsg;
use crate::pool::{dynamic_gas_price_wei, fee_bounds_wei};
use crate::state::State;
use crate::tokenomics::{
    cumulative_supply, reward_at_height, BOOTSTRAP_MAX_FEE_WEI, BOOTSTRAP_MIN_FEE_WEI, CHAIN_ID,
    DYNAMIC_GAS_CAP_GWEI, DYNAMIC_GAS_FLOOR_GWEI, MAX_FEE_USD_MICRO, MAX_SWAP_ZBX_WEI,
    MAX_SWAP_ZUSD, MIN_FEE_USD_MICRO, MIN_GAS_UNITS, TARGET_FEE_USD_MICRO, TOTAL_SUPPLY_WEI,
};
use crate::types::{Address, SignedTx};
use crate::vote::VotePool;
use axum::{extract::State as AxState, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct RpcCtx {
    pub state: Arc<State>,
    pub mempool: Arc<Mempool>,
    /// When set (P2P enabled), RPC-submitted txs are immediately gossiped to peers.
    pub p2p_out: Option<tokio::sync::mpsc::UnboundedSender<P2PMsg>>,
    /// Phase B.2: shared in-memory vote pool. `None` only in legacy --no-p2p mode.
    pub votes: Option<Arc<VotePool>>,
    /// Phase C.2 — shared EVM state DB. When `Some`, the RPC layer routes
    /// any unhandled `eth_*` / `net_*` / `web3_*` method through
    /// `crate::evm_rpc::dispatch` so MetaMask/Foundry/ethers.js can speak
    /// the standard JSON-RPC dialect against this node.
    #[cfg(feature = "evm")]
    pub evm_db: Option<Arc<crate::evm_state::CfEvmDb>>,
}

#[derive(Deserialize)]
struct RpcReq {
    #[serde(default)]
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct RpcResp {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

fn ok(id: Value, result: Value) -> RpcResp {
    RpcResp { jsonrpc: "2.0", id, result: Some(result), error: None }
}
fn err(id: Value, code: i32, msg: impl Into<String>) -> RpcResp {
    RpcResp {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(json!({ "code": code, "message": msg.into() })),
    }
}

fn parse_address(v: &Value) -> Option<Address> {
    let s = v.as_str()?;
    Address::from_hex(s).ok()
}

async fn handle(AxState(ctx): AxState<RpcCtx>, Json(req): Json<RpcReq>) -> Json<RpcResp> {
    let _ = req.jsonrpc;
    let id = req.id.clone();
    let resp = match req.method.as_str() {
        "eth_chainId" => ok(id, json!(format!("0x{:x}", CHAIN_ID))),
        "net_version" => ok(id, json!(CHAIN_ID.to_string())),
        "eth_blockNumber" => {
            let (h, _) = ctx.state.tip();
            ok(id, json!(format!("0x{:x}", h)))
        }
        "zbx_blockNumber" => {
            // Richer than eth_blockNumber: also returns hash, timestamp, proposer.
            let (h, hash) = ctx.state.tip();
            let block = ctx.state.block_at(h);
            let (ts, prop) = match &block {
                Some(b) => (b.header.timestamp_ms, b.header.proposer.to_hex()),
                None    => (0, String::from("0x0000000000000000000000000000000000000000")),
            };
            ok(id, json!({
                "height": h,
                "hex": format!("0x{:x}", h),
                "hash": hash.to_hex(),
                "timestamp_ms": ts,
                "proposer": prop,
            }))
        }
        "eth_getBalance" | "zbx_getBalance" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => ok(id, json!(format!("0x{:x}", ctx.state.balance(&a)))),
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_getNonce" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => ok(id, json!(ctx.state.nonce(&a))),
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_sendTransaction" => {
            let tx_v = req.params.get(0).cloned().unwrap_or(Value::Null);
            match serde_json::from_value::<SignedTx>(tx_v) {
                Ok(tx) => {
                    // Try to also gossip the tx (best-effort; only if P2P is up).
                    let gossip_bytes = bincode::serialize(&tx).ok();
                    match ctx.mempool.add(tx) {
                        Ok(h) => {
                            if let (Some(out), Some(b)) = (&ctx.p2p_out, gossip_bytes) {
                                let _ = out.send(P2PMsg::Tx(b));
                            }
                            ok(id, json!(format!("0x{}", hex::encode(h))))
                        }
                        Err(e) => err(id, -32000, format!("{e}")),
                    }
                }
                Err(e) => err(id, -32602, format!("bad tx: {e}")),
            }
        }
        "zbx_sendRawTransaction" => {
            // Accepts a single string param: hex-encoded bincode SignedTx
            // (with or without "0x" prefix). This sidesteps every JSON-vs-Rust
            // encoding mismatch (u128 numbers, [u8;32]/[u8;64] arrays, enum
            // variants, etc.) that tripped up early mobile-client builds.
            let s_owned;
            let s = match req.params.get(0).and_then(|v| v.as_str()) {
                Some(v) => {
                    s_owned = v.to_string();
                    s_owned.strip_prefix("0x").unwrap_or(s_owned.as_str()).to_string()
                }
                None => return Json(err(id, -32602, "expected hex string param")),
            };
            let bytes = match hex::decode(&s) {
                Ok(b) => b,
                Err(e) => return Json(err(id, -32602, format!("bad hex: {e}"))),
            };
            let tx: SignedTx = match bincode::deserialize(&bytes) {
                Ok(t) => t,
                Err(e) => return Json(err(id, -32602, format!("bad bincode: {e}"))),
            };
            let gossip_bytes = bytes.clone();
            match ctx.mempool.add(tx) {
                Ok(h) => {
                    if let Some(out) = &ctx.p2p_out {
                        let _ = out.send(P2PMsg::Tx(gossip_bytes));
                    }
                    ok(id, json!(format!("0x{}", hex::encode(h))))
                }
                Err(e) => err(id, -32000, format!("{e}")),
            }
        }
        "zbx_mempoolStatus" => {
            // Cheap: just sizes, no tx bodies. Safe to poll frequently.
            ok(id, json!({
                "size": ctx.mempool.len(),
                "max_size": ctx.mempool.max_size(),
            }))
        }
        "zbx_mempoolPending" => {
            // Optional `?limit=N` (default 50, cap 500). Returns a summary list
            // of the pending txs currently sitting in the mempool — hash,
            // from/to, amount, fee, nonce, kind tag. Never returns full tx
            // bodies (signatures/pubkeys stripped) to keep the payload small.
            let limit = req.params.get(0)
                .and_then(|v| v.as_u64())
                .unwrap_or(50)
                .min(500) as usize;
            let snap = ctx.mempool.snapshot();
            let total = snap.len();
            let kind_name = |i: u32| match i {
                0 => "Transfer",
                1 => "ValidatorAdd",
                2 => "ValidatorRemove",
                3 => "ValidatorEdit",
                4 => "GovernorChange",
                5 => "Staking",
                6 => "RegisterPayId",
                7 => "Multisig",
                8 => "Swap",
                _ => "Unknown",
            };
            let txs: Vec<Value> = snap.into_iter().take(limit).map(|(h, from, to, amount, fee, nonce, kind)| json!({
                "hash":   format!("0x{}", hex::encode(h)),
                "from":   from.to_hex(),
                "to":     to.to_hex(),
                "amount": amount.to_string(),
                "fee":    fee.to_string(),
                "nonce":  nonce,
                "kind":   kind_name(kind),
            })).collect();
            ok(id, json!({
                "size":     total,
                "max_size": ctx.mempool.max_size(),
                "returned": txs.len(),
                "txs":      txs,
            }))
        }
        "zbx_recentTxs" => {
            // Phase B.9 — Direct read of the on-chain recent-tx ring buffer.
            // Returns the most recent N transactions (default 15, cap 1000)
            // newest first. Backed by `State::recent_txs` (O(N) point lookups,
            // no block scan). Frontends should prefer this over scanning
            // `zbx_getBlockByNumber` in a loop.
            let limit = req.params.get(0)
                .and_then(|v| v.as_u64())
                .unwrap_or(15)
                .min(crate::state::RECENT_TX_CAP) as usize;
            let kind_name = |i: u32| match i {
                0 => "Transfer",
                1 => "ValidatorAdd",
                2 => "ValidatorRemove",
                3 => "ValidatorEdit",
                4 => "GovernorChange",
                5 => "Staking",
                6 => "RegisterPayId",
                7 => "Multisig",
                8 => "Swap",
                _ => "Unknown",
            };
            let recs = ctx.state.recent_txs(limit);
            let total = ctx.state.recent_tx_total();
            let stored = total.min(crate::state::RECENT_TX_CAP);
            let txs: Vec<Value> = recs.into_iter().map(|r| json!({
                "seq":          r.seq,
                "height":       r.height,
                "timestamp_ms": r.timestamp_ms,
                "hash":         format!("0x{}", hex::encode(r.hash)),
                "from":         r.from.to_hex(),
                "to":           r.to.to_hex(),
                "amount":       r.amount.to_string(),
                "fee":          r.fee.to_string(),
                "nonce":        r.nonce,
                "kind":         kind_name(r.kind_index),
                "kind_index":   r.kind_index,
            })).collect();
            ok(id, json!({
                "returned":      txs.len(),
                "stored":        stored,
                "total_indexed": total,
                "max_cap":       crate::state::RECENT_TX_CAP,
                "txs":           txs,
            }))
        }
        "zbx_getBlockByNumber" => {
            let height = req.params.get(0).and_then(|v| v.as_u64()).unwrap_or(0);
            match ctx.state.block_at(height) {
                Some(b) => ok(id, serde_json::to_value(b).unwrap_or(Value::Null)),
                None => ok(id, Value::Null),
            }
        }
        "zbx_supply" => {
            let (h, _) = ctx.state.tip();
            let minted = cumulative_supply(h);
            let premine = crate::tokenomics::FOUNDER_PREMINE_WEI;
            let burn_addr = crate::state::burn_address();
            let burned = ctx.state.account(&burn_addr).balance;
            // Pool genesis seed: when the admin runs `pool-init-genesis`,
            // GENESIS_POOL_ZBX_WEI (10M ZBX) is minted DIRECTLY into the AMM
            // pool reserves. This mint is NOT counted by `cumulative_supply()`
            // (which tracks block rewards only), so we add it back here once
            // the pool is initialized. Before pool init, this is 0.
            let pool = ctx.state.pool();
            let pool_seed = if pool.is_initialized() {
                crate::tokenomics::GENESIS_POOL_ZBX_WEI
            } else {
                0u128
            };
            let pool_reserve = pool.zbx_reserve;
            // Circulating = all ZBX that has ever existed (block-reward mints +
            // pool genesis seed + founder premine) MINUS ZBX permanently sent
            // to the burn address. ZBX held by validators, LPs, the AMM pool
            // reserve, the reward-lock vault, and the treasury all count as
            // circulating because they remain redeemable / spendable on-chain.
            // Only `burned` is removed forever.
            let circulating = minted
                .saturating_add(premine)
                .saturating_add(pool_seed)
                .saturating_sub(burned);
            ok(id, json!({
                "height": h,
                "minted_wei": minted.to_string(),
                "premine_wei": premine.to_string(),
                "pool_seed_wei": pool_seed.to_string(),
                "pool_reserve_wei": pool_reserve.to_string(),
                "burned_wei": burned.to_string(),
                "circulating_wei": circulating.to_string(),
                "max_wei": TOTAL_SUPPLY_WEI.to_string(),
                "current_block_reward_wei": reward_at_height(h + 1).to_string(),
            }))
        }
        "zbx_getPool" => {
            let p = ctx.state.pool();
            let price = p.spot_price_zusd_per_zbx();
            ok(id, json!({
                "initialized": p.is_initialized(),
                "pool_address": crate::state::pool_address().to_hex(),
                "admin_address": ctx.state.current_admin().to_hex(),
                "permissionless": true,
                "zbx_reserve_wei": p.zbx_reserve.to_string(),
                "zusd_reserve": p.zusd_reserve.to_string(),
                "lp_supply": p.lp_supply.to_string(),
                "lp_locked_to_pool": true,
                "spot_price_zusd_per_zbx_q18": price.to_string(),
                "spot_price_usd_per_zbx": format!("{:.6}", price as f64 / 1e18),
                "init_height": p.init_height,
                "last_update_height": p.last_update_height,
                "fee_pct": "0.30",
                "max_swap_zbx_wei": MAX_SWAP_ZBX_WEI.to_string(),
                "max_swap_zusd": MAX_SWAP_ZUSD.to_string(),
                "max_swap_zbx": "100000",
                "max_swap_zusd_display": "100000",
                "loan_outstanding_zusd": p.loan_outstanding_zusd.to_string(),
                "loan_repaid": p.loan_repaid(),
                "fee_acc_zbx": p.fee_acc_zbx.to_string(),
                "fee_acc_zusd": p.fee_acc_zusd.to_string(),
                "lifetime_fees_zusd": p.total_fees_collected_zusd.to_string(),
                "lifetime_admin_paid_zusd": p.total_admin_paid_zusd.to_string(),
                "lifetime_reinvested_zusd": p.total_reinvested_zusd.to_string(),
            }))
        }
        "zbx_swapQuote" => {
            // Phase B.10 — read-only swap preview. Does NOT mutate the pool.
            // Params: [direction: "zbx_to_zusd" | "zusd_to_zbx", amount_in: string]
            // Returns: { expected_out, fee_in, price_impact_bps, would_succeed,
            //            reason, spot_price_before, spot_price_after, recommended_min_out_at_1pct }
            let dir_str = req.params.get(0).and_then(|v| v.as_str()).unwrap_or("");
            let amt_str = req.params.get(1)
                .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_u64().map(|n| n.to_string())))
                .unwrap_or_default();
            let amount_in: u128 = match amt_str.parse() {
                Ok(n) => n,
                Err(_) => return Json(err(id, -32602, format!("invalid amount_in: '{}'", amt_str))),
            };
            let p = ctx.state.pool();
            if !p.is_initialized() {
                return Json(ok(id, json!({
                    "would_succeed": false,
                    "reason": "pool not initialized",
                    "expected_out": "0",
                    "fee_in": "0",
                    "price_impact_bps": 0,
                })));
            }
            // Mutate a CLONE so we don't touch real state.
            let mut sim = p.clone();
            let height = ctx.state.tip().0;
            let spot_before = p.spot_price_zusd_per_zbx();
            const FEE_BPS_NUM: u128 = 3;
            const FEE_BPS_DEN: u128 = 1000;
            let fee_in = amount_in.saturating_mul(FEE_BPS_NUM) / FEE_BPS_DEN;

            let res = match dir_str {
                "zbx_to_zusd" => sim.swap_zbx_for_zusd(amount_in, height),
                "zusd_to_zbx" => sim.swap_zusd_for_zbx(amount_in, height),
                _ => return Json(err(id, -32602,
                    "direction must be 'zbx_to_zusd' or 'zusd_to_zbx'")),
            };
            match res {
                Ok(out) => {
                    let spot_after = sim.spot_price_zusd_per_zbx();
                    // price impact = |spot_after - spot_before| / spot_before * 10000  (bps)
                    let impact_bps = if spot_before == 0 { 0 } else {
                        let diff = if spot_after > spot_before { spot_after - spot_before }
                                   else { spot_before - spot_after };
                        // safe: diff/spot_before <= 1, multiply by 10000 first.
                        ((diff as u128).saturating_mul(10_000) / spot_before) as u64
                    };
                    let min_out_1pct = out.saturating_mul(99) / 100;
                    ok(id, json!({
                        "would_succeed": true,
                        "direction": dir_str,
                        "amount_in": amount_in.to_string(),
                        "fee_in": fee_in.to_string(),
                        "expected_out": out.to_string(),
                        "price_impact_bps": impact_bps,
                        "price_impact_pct": format!("{:.4}", impact_bps as f64 / 100.0),
                        "spot_price_before_q18": spot_before.to_string(),
                        "spot_price_after_q18": spot_after.to_string(),
                        "recommended_min_out_at_0_5pct": (out.saturating_mul(995) / 1000).to_string(),
                        "recommended_min_out_at_1pct": min_out_1pct.to_string(),
                        "recommended_min_out_at_3pct": (out.saturating_mul(97) / 100).to_string(),
                        "fee_pct": "0.30",
                    }))
                }
                Err(e) => ok(id, json!({
                    "would_succeed": false,
                    "reason": e,
                    "direction": dir_str,
                    "amount_in": amount_in.to_string(),
                    "fee_in": fee_in.to_string(),
                    "expected_out": "0",
                    "price_impact_bps": 0,
                    "spot_price_before_q18": spot_before.to_string(),
                })),
            }
        }
        "zbx_recentSwaps" => {
            // Phase B.10 — filtered view of the recent-tx ring buffer:
            // returns only tx records whose kind_index == 8 (Swap).
            // Useful for trade-history panels without re-scanning blocks.
            let limit = req.params.get(0)
                .and_then(|v| v.as_u64())
                .unwrap_or(20)
                .min(crate::state::RECENT_TX_CAP) as usize;
            // Fetch a wider window from the index because filtering may drop most.
            let scan_window = (limit * 8).min(crate::state::RECENT_TX_CAP as usize);
            let recs = ctx.state.recent_txs(scan_window);
            let total = ctx.state.recent_tx_total();
            let swaps: Vec<Value> = recs.into_iter()
                .filter(|r| r.kind_index == 8)
                .take(limit)
                .map(|r| json!({
                    "seq":          r.seq,
                    "height":       r.height,
                    "timestamp_ms": r.timestamp_ms,
                    "hash":         format!("0x{}", hex::encode(r.hash)),
                    "from":         r.from.to_hex(),
                    "amount_in":    r.amount.to_string(),
                    "fee":          r.fee.to_string(),
                    "nonce":        r.nonce,
                }))
                .collect();
            ok(id, json!({
                "returned":      swaps.len(),
                "scan_window":   scan_window,
                "total_indexed": total,
                "max_cap":       crate::state::RECENT_TX_CAP,
                "swaps":         swaps,
            }))
        }
        "zbx_poolStats" => {
            // Phase B.10 — pool overview + recent-window swap stats.
            // Optional param[0] = window in indexed txs (default 200, cap = RECENT_TX_CAP).
            let window = req.params.get(0)
                .and_then(|v| v.as_u64())
                .unwrap_or(200)
                .min(crate::state::RECENT_TX_CAP) as usize;
            let p = ctx.state.pool();
            let recs = ctx.state.recent_txs(window);
            let mut swap_count: u64 = 0;
            let mut volume_in_amount_total: u128 = 0;
            // The recent-tx index does NOT yet carry the swap direction, so we
            // expose only the raw count + summed amounts. A direction-aware
            // breakdown requires extending RecentTxRecord (future work).
            for r in &recs {
                if r.kind_index == 8 {
                    swap_count += 1;
                    volume_in_amount_total = volume_in_amount_total.saturating_add(r.amount);
                }
            }
            let spot = p.spot_price_zusd_per_zbx();
            ok(id, json!({
                "pool_initialized":             p.is_initialized(),
                "zbx_reserve_wei":              p.zbx_reserve.to_string(),
                "zusd_reserve":                 p.zusd_reserve.to_string(),
                "lp_supply":                    p.lp_supply.to_string(),
                "spot_price_zusd_per_zbx_q18": spot.to_string(),
                "spot_price_usd_per_zbx":      format!("{:.6}", spot as f64 / 1e18),
                "fee_pct":                      "0.30",
                "max_swap_zbx":                 "100000",
                "max_swap_zusd":                "100000",
                "loan_outstanding_zusd":        p.loan_outstanding_zusd.to_string(),
                "loan_repaid":                  p.loan_repaid(),
                "lifetime_fees_zusd":           p.total_fees_collected_zusd.to_string(),
                "window_indexed_txs":           recs.len(),
                "window_swap_count":            swap_count,
                "window_swap_amount_sum":       volume_in_amount_total.to_string(),
            }))
        }
        // ───────── Phase B.12 — bridge RPCs ─────────
        "zbx_listBridgeNetworks" => {
            let nets = ctx.state.bridge_list_networks();
            let arr: Vec<Value> = nets.into_iter().map(|n| json!({
                "id":                n.id,
                "name":              n.name,
                "kind":              format!("{:?}", n.kind).to_lowercase(),
                "active":            n.active,
                "registered_height": n.registered_height,
            })).collect();
            ok(id, json!({ "count": arr.len(), "networks": arr }))
        }
        "zbx_getBridgeNetwork" => {
            let nid = req.params.get(0).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            match ctx.state.bridge_get_network(nid) {
                Some(n) => ok(id, json!({
                    "id":                n.id,
                    "name":              n.name,
                    "kind":              format!("{:?}", n.kind).to_lowercase(),
                    "active":            n.active,
                    "registered_height": n.registered_height,
                })),
                None => err(id, -32004, format!("network {} not found", nid)),
            }
        }
        "zbx_listBridgeAssets" => {
            // Optional filter: params[0] = network_id (u32). Empty = all.
            let filter = req.params.get(0).and_then(|v| v.as_u64()).map(|x| x as u32);
            let assets = ctx.state.bridge_list_assets();
            let arr: Vec<Value> = assets.into_iter()
                .filter(|a| filter.map(|f| a.network_id == f).unwrap_or(true))
                .map(|a| json!({
                    "asset_id":          a.asset_id.to_string(),
                    "network_id":        a.network_id,
                    "native":            a.native.symbol(),
                    "native_decimals":   a.native.decimals(),
                    "contract":          a.contract,
                    "decimals":          a.decimals,
                    "active":            a.active,
                    "registered_height": a.registered_height,
                })).collect();
            ok(id, json!({ "count": arr.len(), "assets": arr }))
        }
        "zbx_getBridgeAsset" => {
            let aid = req.params.get(0)
                .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok())
                    .or_else(|| v.as_u64()))
                .unwrap_or(0);
            match ctx.state.bridge_get_asset(aid) {
                Some(a) => ok(id, json!({
                    "asset_id":          a.asset_id.to_string(),
                    "network_id":        a.network_id,
                    "native":            a.native.symbol(),
                    "native_decimals":   a.native.decimals(),
                    "contract":          a.contract,
                    "decimals":          a.decimals,
                    "active":            a.active,
                    "registered_height": a.registered_height,
                })),
                None => err(id, -32004, format!("asset {} not found", aid)),
            }
        }
        "zbx_recentBridgeOutEvents" => {
            // Params: [limit?: u64 (default 50, cap 500)]
            let limit = req.params.get(0).and_then(|v| v.as_u64()).unwrap_or(50)
                .min(500) as usize;
            let events = ctx.state.bridge_recent_out_events(limit);
            let arr: Vec<Value> = events.into_iter().map(|e| json!({
                "seq":           e.seq,
                "asset_id":      e.asset_id.to_string(),
                "native_symbol": e.native_symbol,
                "from":          e.from.to_hex(),
                "dest_address":  e.dest_address,
                "amount":        e.amount.to_string(),
                "height":        e.height,
                "tx_hash":       format!("0x{}", hex::encode(e.tx_hash)),
            })).collect();
            ok(id, json!({
                "returned": arr.len(),
                "total":    ctx.state.bridge_total_out_events(),
                "events":   arr,
            }))
        }
        "zbx_isBridgeClaimUsed" => {
            // Params: [source_tx_hash: 0x… (32 bytes hex)]
            let h = req.params.get(0).and_then(|v| v.as_str()).unwrap_or("");
            let stripped = h.strip_prefix("0x").unwrap_or(h);
            let bytes = match hex::decode(stripped) {
                Ok(b) if b.len() == 32 => b,
                _ => return axum::Json(err(id, -32602, "source_tx_hash must be 0x + 64 hex chars (32 bytes)")),
            };
            let mut h32 = [0u8; 32];
            h32.copy_from_slice(&bytes);
            ok(id, json!({
                "source_tx_hash": format!("0x{}", hex::encode(h32)),
                "claimed":        ctx.state.bridge_is_claim_used(&h32),
            }))
        }
        "zbx_bridgeStats" => {
            let nets = ctx.state.bridge_list_networks();
            let assets = ctx.state.bridge_list_assets();
            ok(id, json!({
                "networks_count":   nets.len(),
                "assets_count":     assets.len(),
                "active_networks":  nets.iter().filter(|n| n.active).count(),
                "active_assets":    assets.iter().filter(|a| a.active).count(),
                "locked_zbx_wei":   ctx.state.bridge_locked_zbx().to_string(),
                "locked_zusd":      ctx.state.bridge_locked_zusd().to_string(),
                "out_events_total": ctx.state.bridge_total_out_events(),
                "claims_used":      ctx.state.bridge_claims_used(),
                "lock_address":     crate::tokenomics::BRIDGE_LOCK_ADDRESS_HEX,
            }))
        }
        "zbx_getAdmin" => {
            ok(id, json!({
                "current_admin": ctx.state.current_admin().to_hex(),
                "genesis_admin": crate::state::admin_address().to_hex(),
                "changes_used": ctx.state.admin_change_count(),
                "max_changes": crate::tokenomics::MAX_ADMIN_CHANGES,
                "changes_remaining": ctx.state.admin_changes_remaining(),
                "locked": ctx.state.admin_changes_remaining() == 0,
            }))
        }
        "zbx_getPriceUSD" => {
            let p = ctx.state.pool();
            let price = p.spot_price_zusd_per_zbx();
            ok(id, json!({
                "zbx_usd": format!("{:.6}", price as f64 / 1e18),
                "source": if p.is_initialized() { "amm-pool-spot" } else { "uninitialized" },
            }))
        }
        "zbx_estimateGas" => {
            let p = ctx.state.pool();
            let gp = dynamic_gas_price_wei(
                &p, TARGET_FEE_USD_MICRO, MIN_GAS_UNITS,
                DYNAMIC_GAS_FLOOR_GWEI, DYNAMIC_GAS_CAP_GWEI,
            );
            let fee_wei = gp.saturating_mul(MIN_GAS_UNITS as u128);
            ok(id, json!({
                "gas_units": MIN_GAS_UNITS,
                "gas_price_wei": gp.to_string(),
                "gas_price_gwei": format!("{:.4}", gp as f64 / 1e9),
                "fee_wei": fee_wei.to_string(),
                "fee_zbx": format!("{:.10}", fee_wei as f64 / 1e18),
                "target_usd": format!("{:.6}", TARGET_FEE_USD_MICRO as f64 / 1e6),
                "pool_initialized": p.is_initialized(),
            }))
        }
        // Live USD-pegged fee window enforced by consensus. Wallets/CLIs read
        // this and pick any value inside [min_wei, max_wei]. The "recommended"
        // value is the geometric/linear midpoint — defaults to ≈ $0.0055.
        "zbx_feeBounds" => {
            let p = ctx.state.pool();
            let (min_w, max_w) = fee_bounds_wei(
                &p, MIN_FEE_USD_MICRO, MAX_FEE_USD_MICRO,
                BOOTSTRAP_MIN_FEE_WEI, BOOTSTRAP_MAX_FEE_WEI,
            );
            // Recommended = min × 2 (≈ $0.002), still safely below max ($0.01).
            let recommended = min_w.saturating_mul(2).min(max_w);
            ok(id, json!({
                "min_fee_wei": min_w.to_string(),
                "min_fee_zbx": format!("{:.10}", min_w as f64 / 1e18),
                "max_fee_wei": max_w.to_string(),
                "max_fee_zbx": format!("{:.10}", max_w as f64 / 1e18),
                "recommended_fee_wei": recommended.to_string(),
                "recommended_fee_zbx": format!("{:.10}", recommended as f64 / 1e18),
                "min_usd": format!("{:.6}", MIN_FEE_USD_MICRO as f64 / 1e6),
                "max_usd": format!("{:.6}", MAX_FEE_USD_MICRO as f64 / 1e6),
                "pool_initialized": p.is_initialized(),
                "source": if p.is_initialized() { "amm-pool-spot" } else { "bootstrap-fixed" },
            }))
        }
        "zbx_getZusdBalance" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => ok(id, json!(ctx.state.account(&a).zusd.to_string())),
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_getLpBalance" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => ok(id, json!(ctx.state.lp_balance(&a).to_string())),
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_chainInfo" => ok(id, json!({
            "chain_id": CHAIN_ID,
            "name": "Zebvix",
            "token": "ZBX",
            "decimals": 18,
            "block_time_secs": crate::tokenomics::BLOCK_TIME_SECS,
        })),
        // Phase B.1: validator-set RPCs
        "zbx_listValidators" => {
            let vals = ctx.state.validators();
            let total = ctx.state.total_voting_power();
            let quorum = ctx.state.quorum_threshold();
            let arr: Vec<Value> = vals.iter().map(|v| json!({
                "address": v.address.to_hex(),
                "pubkey": format!("0x{}", hex::encode(v.pubkey)),
                "voting_power": v.voting_power,
            })).collect();
            ok(id, json!({
                "count": arr.len(),
                "total_voting_power": total,
                "quorum_threshold": quorum,
                "validators": arr,
            }))
        }
        "zbx_voteStats" => {
            // Params: [{ "height": u64 } | u64 | null]
            let height = req.params.get(0).and_then(|v| {
                if v.is_u64() { v.as_u64() }
                else if let Some(o) = v.as_object() { o.get("height").and_then(|x| x.as_u64()) }
                else { None }
            }).unwrap_or_else(|| ctx.state.tip().0);
            let validator_set = ctx.state.validators();
            let total_power: u64 = validator_set.iter().map(|v| v.voting_power).sum();
            let quorum = ctx.state.quorum_threshold();
            match &ctx.votes {
                None => ok(id, json!({
                    "height": height,
                    "total_voting_power": total_power,
                    "quorum_threshold": quorum,
                    "rounds": [],
                    "note": "vote pool disabled (--no-p2p mode)",
                })),
                Some(pool) => {
                    let snap = pool.snapshot_height(height);
                    let rounds: Vec<Value> = snap.into_iter().map(|(round, vt, votes)| {
                        // Group votes by target hash and sum power.
                        let mut by_target: std::collections::BTreeMap<String, u64> = Default::default();
                        for v in &votes {
                            let target = v.data.block_hash.map(|h| h.to_hex())
                                .unwrap_or_else(|| "nil".to_string());
                            let power = validator_set.iter()
                                .find(|x| x.address == v.validator_address)
                                .map(|x| x.voting_power).unwrap_or(0);
                            *by_target.entry(target).or_insert(0) += power;
                        }
                        let targets: Vec<Value> = by_target.iter().map(|(t, p)| json!({
                            "block_hash": t,
                            "power": p,
                            "has_quorum": quorum > 0 && *p >= quorum,
                        })).collect();
                        json!({
                            "round": round,
                            "type": vt.as_str(),
                            "vote_count": votes.len(),
                            "targets": targets,
                            "voters": votes.iter().map(|v| v.validator_address.to_hex()).collect::<Vec<_>>(),
                        })
                    }).collect();
                    ok(id, json!({
                        "height": height,
                        "total_voting_power": total_power,
                        "quorum_threshold": quorum,
                        "rounds": rounds,
                    }))
                }
            }
        }
        "zbx_getValidator" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => match ctx.state.get_validator(&a) {
                    Some(v) => ok(id, json!({
                        "address": v.address.to_hex(),
                        "pubkey": format!("0x{}", hex::encode(v.pubkey)),
                        "voting_power": v.voting_power,
                    })),
                    None => ok(id, Value::Null),
                },
                None => err(id, -32602, "invalid address"),
            }
        }
        // ───────── Phase B.3.2 — Governor ─────────
        "zbx_getGovernor" => ok(id, json!({
            "current_governor": ctx.state.current_governor().to_hex(),
            "genesis_governor": crate::state::governor_address().to_hex(),
            "changes_used": ctx.state.governor_change_count(),
            "max_changes": crate::tokenomics::MAX_GOVERNOR_CHANGES,
            "changes_remaining": ctx.state.governor_changes_remaining(),
            "locked": ctx.state.governor_changes_remaining() == 0,
        })),
        // ───────── Phase B.4 — Staking ─────────
        "zbx_getStaking" => {
            let sm = ctx.state.staking();
            let validators: Vec<Value> = sm.validators.values().map(|v| json!({
                "address": v.address.to_hex(),
                "operator": v.operator.to_hex(),
                "pubkey": format!("0x{}", hex::encode(v.pubkey)),
                "total_stake_wei": v.total_stake.to_string(),
                "total_shares": v.total_shares.to_string(),
                "commission_bps": v.commission_bps,
                "commission_pool_wei": v.commission_pool.to_string(),
                "jailed": v.jailed,
                "jailed_until_epoch": v.jailed_until,
                "last_commission_edit_epoch": v.last_commission_edit_epoch,
            })).collect();
            let unbonding: Vec<Value> = sm.unbonding_queue.iter().map(|u| json!({
                "delegator": u.delegator.to_hex(),
                "validator": u.validator.to_hex(),
                "amount_wei": u.amount.to_string(),
                "mature_at_epoch": u.mature_at_epoch,
            })).collect();
            let active = sm.active_set();
            ok(id, json!({
                "current_epoch": sm.current_epoch,
                "epoch_blocks": crate::staking::EPOCH_BLOCKS,
                "epoch_reward_wei": crate::staking::STAKING_EPOCH_REWARD_WEI.to_string(),
                "unbonding_epochs": crate::staking::UNBONDING_EPOCHS,
                "min_self_bond_wei": crate::staking::MIN_SELF_BOND_WEI.to_string(),
                "min_self_bond_usd_micro": crate::staking::MIN_SELF_BOND_USD_MICRO,
                "min_self_bond_dynamic_wei": crate::staking::dynamic_min_self_bond_wei(
                    ctx.state.pool().spot_price_zusd_per_zbx()
                ).to_string(),
                "min_delegation_wei": crate::staking::MIN_DELEGATION_WEI.to_string(),
                "max_commission_bps": crate::staking::MAX_COMMISSION_BPS,
                "max_commission_delta_bps": crate::staking::MAX_COMMISSION_BPS_DELTA,
                "total_slashed_wei": sm.total_slashed.to_string(),
                "validator_count": validators.len(),
                "delegation_count": sm.delegations.len(),
                "unbonding_count": unbonding.len(),
                "validators": validators,
                "unbonding_queue": unbonding,
                "active_set": active.iter().map(|v| json!({
                    "address": v.address.to_hex(),
                    "voting_power": v.voting_power,
                })).collect::<Vec<_>>(),
            }))
        }
        "zbx_getStakingValidator" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => {
                    let sm = ctx.state.staking();
                    match sm.validators.get(&a) {
                        Some(v) => ok(id, json!({
                            "address": v.address.to_hex(),
                            "operator": v.operator.to_hex(),
                            "pubkey": format!("0x{}", hex::encode(v.pubkey)),
                            "total_stake_wei": v.total_stake.to_string(),
                            "total_shares": v.total_shares.to_string(),
                            "commission_bps": v.commission_bps,
                            "commission_pool_wei": v.commission_pool.to_string(),
                            "jailed": v.jailed,
                            "jailed_until_epoch": v.jailed_until,
                        })),
                        None => ok(id, Value::Null),
                    }
                }
                None => err(id, -32602, "invalid validator address"),
            }
        }
        "zbx_getDelegation" => {
            let delegator = req.params.get(0).and_then(parse_address);
            let validator = req.params.get(1).and_then(parse_address);
            match (delegator, validator) {
                (Some(d), Some(v)) => {
                    let sm = ctx.state.staking();
                    let shares = sm.delegations.get(&(d, v)).copied().unwrap_or(0);
                    let value = sm.delegation_value(d, v);
                    ok(id, json!({
                        "delegator": d.to_hex(),
                        "validator": v.to_hex(),
                        "shares": shares.to_string(),
                        "value_wei": value.to_string(),
                    }))
                }
                _ => err(id, -32602, "params: [delegator_address, validator_address]"),
            }
        }
        "zbx_getDelegationsByDelegator" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(d) => {
                    let sm = ctx.state.staking();
                    let mut entries: Vec<Value> = Vec::new();
                    let mut total: u128 = 0;
                    for ((deleg, val), shares) in sm.delegations.iter() {
                        if *deleg != d { continue; }
                        let value = sm.delegation_value(*deleg, *val);
                        total = total.saturating_add(value);
                        entries.push(json!({
                            "validator": val.to_hex(),
                            "shares": shares.to_string(),
                            "value_wei": value.to_string(),
                        }));
                    }
                    ok(id, json!({
                        "delegator": d.to_hex(),
                        "total_value_wei": total.to_string(),
                        "delegations": entries,
                    }))
                }
                None => err(id, -32602, "invalid delegator address"),
            }
        }
        // ───────── Phase B.5 — Locked rewards + Burn stats ─────────
        "zbx_getLockedRewards" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => {
                    let sm = ctx.state.staking();
                    let current_h = ctx.state.tip().0;
                    let snap = sm.locked_snapshot(a);
                    let (claimable, next_drip, next_bulk, locked_after) =
                        sm.preview_unlock(a, current_h);
                    let stake = sm.total_stake_of(a);
                    let daily_drip_wei = (stake.saturating_mul(
                        crate::tokenomics::DRIP_BPS_PER_DAY as u128,
                    ))
                        / 10_000u128;
                    let (balance_wei, last_drip_h, last_bulk_h, total_released) =
                        snap.unwrap_or((0, current_h, current_h, 0));
                    ok(id, json!({
                        "address": a.to_hex(),
                        "current_height": current_h,
                        "locked_balance_wei": balance_wei.to_string(),
                        "claimable_now_wei": claimable.to_string(),
                        "locked_after_claim_wei": locked_after.to_string(),
                        "stake_wei": stake.to_string(),
                        "daily_drip_wei": daily_drip_wei.to_string(),
                        "drip_bps_per_day": crate::tokenomics::DRIP_BPS_PER_DAY,
                        "bulk_release_bps": crate::tokenomics::BULK_RELEASE_BPS,
                        "bulk_interval_blocks": crate::tokenomics::BULK_INTERVAL_BLOCKS,
                        "last_drip_height": last_drip_h,
                        "last_bulk_height": last_bulk_h,
                        "next_drip_height": next_drip,
                        "next_bulk_height": next_bulk,
                        "blocks_to_next_bulk": next_bulk.saturating_sub(current_h),
                        "total_released_wei": total_released.to_string(),
                    }))
                }
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_getBurnStats" => {
            let burn_addr = crate::state::burn_address();
            let burned = ctx.state.account(&burn_addr).balance;
            let cap = crate::tokenomics::BURN_CAP_WEI;
            let phase = if burned >= cap { "liquidity" } else { "burn" };
            let progress_bps = if cap > 0 {
                ((burned.min(cap) as u128).saturating_mul(10_000) / cap) as u64
            } else { 0 };
            ok(id, json!({
                "burn_address": burn_addr.to_hex(),
                "total_burned_wei": burned.to_string(),
                "burn_cap_wei": cap.to_string(),
                "phase": phase,
                "progress_bps": progress_bps,
                "fee_split": {
                    "validator_bps": crate::tokenomics::GAS_FEE_VALIDATOR_BPS,
                    "delegators_bps": crate::tokenomics::GAS_FEE_DELEGATORS_BPS,
                    "treasury_bps": crate::tokenomics::GAS_FEE_TREASURY_BPS,
                    "burn_or_liquidity_bps": crate::tokenomics::GAS_FEE_BURN_BPS,
                },
            }))
        }
        // ───────── Phase B.7 — Pay-ID registry ─────────
        "zbx_lookupPayId" => {
            let raw = req.params.get(0).and_then(|v| v.as_str()).unwrap_or("");
            match crate::state::validate_payid(raw) {
                Ok(canon) => match ctx.state.get_address_by_payid(&canon) {
                    Some(a) => {
                        let (_pid, name) = ctx.state.get_payid_by_address(&a)
                            .unwrap_or((canon.clone(), String::new()));
                        ok(id, json!({
                            "pay_id": canon,
                            "address": a.to_hex(),
                            "name": name,
                        }))
                    }
                    None => err(id, -32004, format!("pay-id '{}' not registered", canon)),
                },
                Err(e) => err(id, -32602, e.to_string()),
            }
        }
        "zbx_getPayIdOf" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => match ctx.state.get_payid_by_address(&a) {
                    Some((pid, name)) => ok(id, json!({
                        "address": a.to_hex(),
                        "pay_id": pid,
                        "name": name,
                    })),
                    None => err(id, -32004, format!("address {} has no Pay-ID", a)),
                },
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_payIdCount" => ok(id, json!({ "total": ctx.state.pay_id_count() })),
        // ───────── Phase B.8 — Multisig wallets ─────────
        "zbx_getMultisig" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => match ctx.state.get_multisig(&a) {
                    Some(ms) => ok(id, json!({
                        "address": ms.address.to_hex(),
                        "owners": ms.owners.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
                        "threshold": ms.threshold,
                        "created_height": ms.created_height,
                        "proposal_seq": ms.proposal_seq,
                    })),
                    None => err(id, -32004, format!("multisig {} not found", a)),
                },
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_getMultisigProposal" => {
            let addr = req.params.get(0).and_then(parse_address);
            let pid = req.params.get(1).and_then(|v| v.as_u64());
            match (addr, pid) {
                (Some(a), Some(pid)) => {
                    let ms = ctx.state.get_multisig(&a);
                    match ctx.state.get_ms_proposal(&a, pid) {
                        Some(p) => {
                            let threshold = ms.as_ref().map(|m| m.threshold).unwrap_or(0);
                            let current_h = ctx.state.tip().0;
                            let expired = current_h > p.expiry_height;
                            ok(id, json!({
                                "multisig": p.multisig.to_hex(),
                                "id": p.id,
                                "proposer": p.proposer.to_hex(),
                                "approvals": p.approvals.iter().map(|x| x.to_hex()).collect::<Vec<_>>(),
                                "threshold": threshold,
                                "created_height": p.created_height,
                                "expiry_height": p.expiry_height,
                                "executed": p.executed,
                                "expired": expired && !p.executed,
                                "action_human": p.action.human(),
                                "action": match &p.action {
                                    crate::multisig::MultisigAction::Transfer { to, amount } =>
                                        json!({ "kind": "Transfer", "to": to.to_hex(), "amount_wei": amount.to_string() }),
                                },
                            }))
                        }
                        None => err(id, -32004, format!("proposal #{} not found on {}", pid, a)),
                    }
                }
                _ => err(id, -32602, "invalid params: expect [address, proposal_id]"),
            }
        }
        "zbx_getMultisigProposals" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => {
                    let ms = ctx.state.get_multisig(&a);
                    let threshold = ms.as_ref().map(|m| m.threshold).unwrap_or(0);
                    let current_h = ctx.state.tip().0;
                    let arr: Vec<Value> = ctx.state.list_ms_proposals(&a).into_iter().map(|p| {
                        let expired = current_h > p.expiry_height;
                        json!({
                            "multisig": p.multisig.to_hex(),
                            "id": p.id,
                            "proposer": p.proposer.to_hex(),
                            "approvals": p.approvals.iter().map(|x| x.to_hex()).collect::<Vec<_>>(),
                            "threshold": threshold,
                            "created_height": p.created_height,
                            "expiry_height": p.expiry_height,
                            "executed": p.executed,
                            "expired": expired && !p.executed,
                            "action_human": p.action.human(),
                        })
                    }).collect();
                    ok(id, json!(arr))
                }
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_listMultisigsByOwner" => {
            let addr = req.params.get(0).and_then(parse_address);
            match addr {
                Some(a) => {
                    let arr: Vec<Value> = ctx.state.list_ms_by_owner(&a).into_iter()
                        .map(|m| json!(m.to_hex())).collect();
                    ok(id, json!(arr))
                }
                None => err(id, -32602, "invalid address"),
            }
        }
        "zbx_multisigCount" => ok(id, json!({ "total": ctx.state.multisig_count() })),
        m => {
            // Phase C.2 — Standard EVM JSON-RPC fallthrough. Any `eth_*`,
            // `net_*`, or `web3_*` method that the legacy native dispatcher
            // above did not handle is routed to `evm_rpc::dispatch` so the
            // node speaks Geth-compatible JSON-RPC for wallets and tooling.
            #[cfg(feature = "evm")]
            if m.starts_with("eth_") || m.starts_with("net_") || m.starts_with("web3_") {
                if let Some(resp) = try_evm_dispatch(&ctx, &id, m, &req.params) {
                    return Json(resp);
                }
            }
            err(id, -32601, format!("method not found: {m}"))
        }
    };
    Json(resp)
}

/// Phase C.2 — bridge between the legacy native RPC dispatcher and the
/// EVM JSON-RPC handler in `evm_rpc::dispatch`. Returns `None` when the
/// EVM DB is not configured (so the catch-all can return `method not found`).
#[cfg(feature = "evm")]
fn try_evm_dispatch(
    ctx: &RpcCtx,
    id: &Value,
    method: &str,
    params: &Value,
) -> Option<RpcResp> {
    let db = ctx.evm_db.as_ref()?.clone();
    let (height, _) = ctx.state.tip();
    let block_ts_ms = ctx.state.block_at(height)
        .map(|b| b.header.timestamp_ms)
        .unwrap_or(0);

    let pool = ctx.state.pool();
    let base_fee = crate::pool::dynamic_gas_price_wei(
        &pool,
        TARGET_FEE_USD_MICRO,
        MIN_GAS_UNITS,
        DYNAMIC_GAS_FLOOR_GWEI,
        DYNAMIC_GAS_CAP_GWEI,
    );

    let evm_ctx = crate::evm_rpc::EvmRpcCtx {
        db,
        chain_id: CHAIN_ID,
        current_height: height,
        current_timestamp: block_ts_ms / 1000,
        coinbase: Address::from_bytes([0u8; 20]),
        base_fee,
    };

    let params_arr: Vec<Value> = match params {
        Value::Array(a) => a.clone(),
        Value::Null => vec![],
        other => vec![other.clone()],
    };

    Some(match crate::evm_rpc::dispatch(&evm_ctx, method, &params_arr) {
        Ok(v) => ok(id.clone(), v),
        Err(e) => err(id.clone(), -32000, e),
    })
}

pub fn router(ctx: RpcCtx) -> Router {
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    Router::new()
        .route("/", post(handle))
        .with_state(ctx)
        .layer(cors)
}
