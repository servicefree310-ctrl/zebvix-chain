//! Minimal JSON-RPC HTTP server. Methods (Ethereum-style naming):
//!   - eth_chainId            -> "0x1ec6"  (7878)
//!   - eth_blockNumber        -> "0x..."
//!   - eth_getBalance         -> "0x..."  (wei)
//!   - zbx_getNonce           -> u64
//!   - zbx_sendTransaction    -> tx hash (accepts JSON SignedTx)
//!   - zbx_getBlockByNumber   -> Block JSON
//!   - zbx_supply             -> { minted_wei, max_wei, current_reward_wei }

use crate::mempool::Mempool;
use crate::state::State;
use crate::tokenomics::{cumulative_supply, reward_at_height, CHAIN_ID, TOTAL_SUPPLY_WEI};
use crate::types::{Address, SignedTx};
use axum::{extract::State as AxState, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct RpcCtx {
    pub state: Arc<State>,
    pub mempool: Arc<Mempool>,
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
                Ok(tx) => match ctx.mempool.add(tx) {
                    Ok(h) => ok(id, json!(format!("0x{}", hex::encode(h)))),
                    Err(e) => err(id, -32000, format!("{e}")),
                },
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
        "zbx_chainInfo" => ok(id, json!({
            "chain_id": CHAIN_ID,
            "name": "Zebvix",
            "token": "ZBX",
            "decimals": 18,
            "block_time_secs": crate::tokenomics::BLOCK_TIME_SECS,
        })),
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
