//! Minimal JSON-RPC HTTP server. Methods (Ethereum-style naming):
//!   - eth_chainId            -> "0x1ec6"  (7878)
//!   - eth_blockNumber        -> "0x..."
//!   - eth_getBalance         -> "0x..."  (wei)
//!   - zbx_getNonce           -> u64
//!   - zbx_sendTransaction    -> tx hash (accepts JSON SignedTx)
//!   - zbx_getBlockByNumber   -> Block JSON
//!   - zbx_supply             -> { minted_wei, max_wei, current_reward_wei }

use crate::mempool::Mempool;
use crate::p2p::P2PMsg;
use crate::pool::dynamic_gas_price_wei;
use crate::state::State;
use crate::tokenomics::{
    cumulative_supply, reward_at_height, CHAIN_ID, DYNAMIC_GAS_CAP_GWEI, DYNAMIC_GAS_FLOOR_GWEI,
    MAX_SWAP_ZBX_WEI, MAX_SWAP_ZUSD, MIN_GAS_UNITS, TARGET_FEE_USD_MICRO, TOTAL_SUPPLY_WEI,
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
        "zbx_getBlockByNumber" => {
            let height = req.params.get(0).and_then(|v| v.as_u64()).unwrap_or(0);
            match ctx.state.block_at(height) {
                Some(b) => ok(id, serde_json::to_value(b).unwrap_or(Value::Null)),
                None => ok(id, Value::Null),
            }
        }
        "zbx_supply" => {
            let (h, _) = ctx.state.tip();
            ok(id, json!({
                "height": h,
                "minted_wei": cumulative_supply(h).to_string(),
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
        m => err(id, -32601, format!("method not found: {m}")),
    };
    Json(resp)
}

pub fn router(ctx: RpcCtx) -> Router {
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    Router::new()
        .route("/", post(handle))
        .with_state(ctx)
        .layer(cors)
}
