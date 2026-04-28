//! Minimal JSON-RPC HTTP server. Methods are exposed under TWO equivalent
//! namespaces wherever a native Zebvix-side handler exists:
//!
//!   * `zbx_*` — Zebvix-native, ALWAYS-ON (compiled into every node, no
//!     feature flag required). This is the production / canonical surface
//!     mobile/light/dashboard clients should use.
//!   * `eth_*` / `net_*` / `web3_*` — EVM wire-protocol aliases (the names
//!     every wallet/library speaks). The ones listed below are mirrored by
//!     `rpc.rs` itself (always-on); anything else in the EVM namespace
//!     (eth_call, eth_estimateGas,
//!     eth_sendRawTransaction, eth_getCode, eth_getStorageAt,
//!     eth_getTransactionReceipt, eth_getLogs, eth_gasPrice,
//!     web3_clientVersion, eth_syncing …) is gated behind the
//!     `--features zvm` build flag and lives in `zvm_rpc.rs`.
//!
//!   Always-on dual-name methods (no `--features zvm` needed):
//!   - eth_chainId      | zbx_chainId       -> "0x1ec6"  (7878)
//!   - net_version      | zbx_netVersion    -> "7878"
//!   - eth_blockNumber                       -> "0x..."   (EVM hex tip)
//!   - zbx_blockNumber                       -> { height, hex, hash,
//!                                                 timestamp_ms, proposer }
//!   - eth_getBalance   | zbx_getBalance    -> "0x..." (wei, native ledger)
//!   - zbx_getNonce                          -> u64
//!
//!   Always-on Zebvix-only methods (no eth_* alias):
//!   - zbx_sendTransaction    -> tx hash (accepts JSON SignedTx)
//!   - zbx_sendRawTransaction -> tx hash (accepts hex-encoded bincode
//!                                SignedTx; preferred for mobile/light
//!                                clients to avoid JSON encoding pitfalls
//!                                with u128 / fixed-size byte arrays)
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
use axum::{extract::State as AxState, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

#[derive(Clone)]
pub struct RpcCtx {
    pub state: Arc<State>,
    pub mempool: Arc<Mempool>,
    /// When set (P2P enabled), RPC-submitted txs are immediately gossiped to peers.
    pub p2p_out: Option<tokio::sync::mpsc::UnboundedSender<P2PMsg>>,
    /// Phase B.2: shared in-memory vote pool. `None` only in legacy --no-p2p mode.
    pub votes: Option<Arc<VotePool>>,
    /// Phase C.2 — shared ZVM state DB. When `Some`, the RPC layer routes
    /// any unhandled `eth_*` / `net_*` / `web3_*` method through
    /// `crate::zvm_rpc::dispatch` so MetaMask/Foundry/ethers.js can speak
    /// the standard JSON-RPC dialect against this node.
    #[cfg(feature = "zvm")]
    pub zvm_db: Option<Arc<crate::zvm_state::CfZvmDb>>,
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

/// Phase G — render `TokenMetadata` as user-facing JSON. Empty fields
/// are emitted as empty strings (the chain stores them that way too) so
/// frontends can simply check `if (m.logo_url) ...` without dealing with
/// `null` vs `undefined` mismatches.
fn token_metadata_to_json(m: &crate::state::TokenMetadata) -> Value {
    json!({
        "token_id":          m.token_id,
        "logo_url":          m.logo_url,
        "website":           m.website,
        "description":       m.description,
        "twitter":           m.twitter,
        "telegram":          m.telegram,
        "discord":           m.discord,
        "updated_at_height": m.updated_at_height,
    })
}

/// Phase E — render a `TokenInfo` as user-facing JSON (used by the
/// dashboard / explorer / wallet). u128 values are serialized as decimal
/// strings to avoid the JSON 2^53 precision cliff. Phase G enrichment:
/// when on-chain metadata exists, it is merged in under the `metadata`
/// key; otherwise `metadata` is `null`.
fn token_info_to_json(t: &crate::state::TokenInfo, st: &Arc<crate::state::State>) -> Value {
    let metadata = match st.get_token_metadata(t.id) {
        Some(m) => token_metadata_to_json(&m),
        None    => Value::Null,
    };
    json!({
        "id": t.id,
        "creator": t.creator.to_hex(),
        "name": t.name,
        "symbol": t.symbol,
        "decimals": t.decimals,
        "total_supply": t.total_supply.to_string(),
        "total_supply_hex": format!("0x{:x}", t.total_supply),
        "created_at_height": t.created_at_height,
        // Formal token class label (e.g. "ZBX-20"). Hydrated to
        // DEFAULT_TOKEN_STANDARD on read for legacy records.
        "standard": t.standard,
        "metadata": metadata,
    })
}

/// Phase F — render a `TokenPool` as user-facing JSON. Includes pool reserves,
/// LP supply, lifetime stats, and (best-effort) the underlying token's symbol/
/// decimals for one-call rendering on the dashboard. u128 values are stringified
/// so the JSON parser doesn't lose precision.
fn token_pool_to_json(p: &crate::token_pool::TokenPool, st: &Arc<crate::state::State>) -> Value {
    let token = st.get_token(p.token_id);
    let pool_addr = crate::token_pool::pool_address(p.token_id);
    json!({
        "token_id":             p.token_id,
        // Phase H — deterministic 20-byte pool address. Frontends and wallets
        // can derive this locally from `token_id` (see `derivePoolAddress` in
        // the dashboard), but we always echo it here so off-chain code never
        // has to re-implement keccak256.
        "address":              pool_addr.to_hex(),
        "token_symbol":         token.as_ref().map(|t| t.symbol.clone())
                                     .unwrap_or_else(|| String::new()),
        "token_name":           token.as_ref().map(|t| t.name.clone())
                                     .unwrap_or_else(|| String::new()),
        "token_decimals":       token.as_ref().map(|t| t.decimals).unwrap_or(0),
        "creator":              p.creator.to_hex(),
        "init_height":          p.init_height,
        "zbx_reserve":          p.zbx_reserve.to_string(),
        "token_reserve":        p.token_reserve.to_string(),
        "lp_supply":            p.lp_supply.to_string(),
        "spot_price_q18":       p.spot_price_zbx_per_token_q18().to_string(),
        "swap_fee_bps_num":     crate::token_pool::TOKEN_POOL_FEE_BPS_NUM,
        "swap_fee_bps_den":     crate::token_pool::TOKEN_POOL_FEE_BPS_DEN,
        "min_lock_lp":          crate::token_pool::MIN_TOKEN_POOL_LIQUIDITY.to_string(),
        "cum_zbx_in_volume":    p.cum_zbx_in_volume.to_string(),
        "cum_token_in_volume":  p.cum_token_in_volume.to_string(),
        "swap_count":           p.swap_count,
    })
}

/// Phase D — render a `ProposalKind` as user-facing JSON (used by the
/// dashboard / explorer / wallet). Mirrors the on-chain enum exactly so the
/// frontend never has to introspect type discriminants directly.
fn proposal_kind_to_json(k: &crate::proposal::ProposalKind) -> Value {
    use crate::proposal::ProposalKind::*;
    match k {
        FeatureFlag { key, enabled } => json!({
            "type": "feature_flag",
            "key": key,
            "enabled": enabled,
        }),
        ParamChange { param, new_value } => json!({
            "type": "param_change",
            "param": param,
            "new_value": new_value.to_string(),
        }),
        ContractWhitelist { key, address, label } => json!({
            "type": "contract_whitelist",
            "key": key,
            "address": address.to_hex(),
            "label": label,
        }),
        TextOnly => json!({ "type": "text_only" }),
    }
}

/// Phase H.1 — Decode a `StakeOp` into a JSON object whose `u128` fields
/// (self_bond, amount, shares, etc) are stringified for precision safety.
/// Do NOT use `serde_json::to_value(StakeOp)` — that would emit them as
/// raw JSON numbers, silently truncating any value above 2^53.
fn stake_op_to_json(op: &crate::staking::StakeOp) -> Value {
    use crate::staking::StakeOp::*;
    match op {
        CreateValidator { pubkey, commission_bps, self_bond } => json!({
            "op":             "create_validator",
            "pubkey":         format!("0x{}", hex::encode(pubkey)),
            "commission_bps": commission_bps,
            "self_bond":      self_bond.to_string(),
        }),
        EditValidator { validator, new_commission_bps } => json!({
            "op":                 "edit_validator",
            "validator":          validator.to_hex(),
            "new_commission_bps": new_commission_bps,
        }),
        Stake { validator, amount } => json!({
            "op":        "stake",
            "validator": validator.to_hex(),
            "amount":    amount.to_string(),
        }),
        Unstake { validator, shares } => json!({
            "op":        "unstake",
            "validator": validator.to_hex(),
            "shares":    shares.to_string(),
        }),
        Redelegate { from, to, shares } => json!({
            "op":     "redelegate",
            "from":   from.to_hex(),
            "to":     to.to_hex(),
            "shares": shares.to_string(),
        }),
        ClaimRewards { validator } => json!({
            "op":        "claim_rewards",
            "validator": validator.to_hex(),
        }),
    }
}

/// Phase H.1 — Decode a `MultisigOp`. The inner `MultisigAction::Transfer`
/// carries a `u128 amount` that MUST be stringified.
fn multisig_op_to_json(op: &crate::multisig::MultisigOp) -> Value {
    use crate::multisig::{MultisigAction, MultisigOp::*};
    let action_to_json = |a: &MultisigAction| -> Value {
        match a {
            MultisigAction::Transfer { to, amount } => json!({
                "action": "transfer",
                "to":     to.to_hex(),
                "amount": amount.to_string(),
            }),
        }
    };
    match op {
        Create { owners, threshold, salt } => json!({
            "op":        "create",
            "owners":    owners.iter().map(|a| a.to_hex()).collect::<Vec<_>>(),
            "threshold": threshold,
            "salt":      salt,
        }),
        Propose { multisig, action, expiry_blocks } => json!({
            "op":             "propose",
            "multisig":       multisig.to_hex(),
            "action":         action_to_json(action),
            "expiry_blocks":  expiry_blocks,
        }),
        Approve { multisig, proposal_id } => json!({
            "op":          "approve",
            "multisig":    multisig.to_hex(),
            "proposal_id": proposal_id,
        }),
        Revoke { multisig, proposal_id } => json!({
            "op":          "revoke",
            "multisig":    multisig.to_hex(),
            "proposal_id": proposal_id,
        }),
        Execute { multisig, proposal_id } => json!({
            "op":          "execute",
            "multisig":    multisig.to_hex(),
            "proposal_id": proposal_id,
        }),
    }
}

/// Phase H.1 — Decode a `BridgeOp`. `BridgeIn::amount` is `u128` and MUST
/// be stringified for precision safety. `RegisterNetwork::kind` and
/// `RegisterAsset::native` are non-monetary enums (no u128 fields), safe
/// to pass through `serde_json::to_value`.
fn bridge_op_to_json(op: &crate::bridge::BridgeOp) -> Value {
    use crate::bridge::BridgeOp::*;
    match op {
        RegisterNetwork { id, name, kind } => json!({
            "op":   "register_network",
            "id":   id,
            "name": name,
            "kind": serde_json::to_value(kind).unwrap_or(Value::Null),
        }),
        SetNetworkActive { id, active } => json!({
            "op":     "set_network_active",
            "id":     id,
            "active": active,
        }),
        RegisterAsset { network_id, native, contract, decimals } => json!({
            "op":         "register_asset",
            "network_id": network_id,
            "native":     serde_json::to_value(native).unwrap_or(Value::Null),
            "contract":   contract,
            "decimals":   decimals,
        }),
        SetAssetActive { asset_id, active } => json!({
            "op":       "set_asset_active",
            "asset_id": asset_id,
            "active":   active,
        }),
        BridgeOut { asset_id, dest_address } => json!({
            "op":           "bridge_out",
            "asset_id":     asset_id,
            "dest_address": dest_address,
        }),
        BridgeIn { source_tx_hash, asset_id, recipient, amount } => json!({
            "op":             "bridge_in",
            "source_tx_hash": format!("0x{}", hex::encode(source_tx_hash)),
            "asset_id":       asset_id,
            "recipient":      recipient.to_hex(),
            "amount":         amount.to_string(),
        }),
        SetBridgePaused { paused } => json!({
            "op":     "set_bridge_paused",
            "paused": paused,
        }),
    }
}

/// Phase H.1 — Decode a `ProposalOp`. The inner `ProposalKind::ParamChange`
/// carries a `u128 new_value` that MUST be stringified — `proposal_kind_to_json`
/// already handles that, so we delegate.
fn proposal_op_to_json(op: &crate::proposal::ProposalOp) -> Value {
    use crate::proposal::ProposalOp::*;
    match op {
        Submit { title, description, kind } => json!({
            "op":          "submit",
            "title":       title,
            "description": description,
            "kind":        proposal_kind_to_json(kind),
        }),
        Vote { proposal_id, yes } => json!({
            "op":          "vote",
            "proposal_id": proposal_id,
            "yes":         yes,
        }),
    }
}

/// Phase H.1 — Decode a `TxKind` enum into a friendly JSON payload that
/// surfaces the SEMANTIC fields the dashboard / explorer needs (e.g. the
/// `zbx_amount` + `token_amount` seeds inside `TokenPoolCreate`, or the
/// recipient + amount inside `TokenTransfer`). Without this decoding,
/// `eth_getTransactionByHash` only ever returns `value: 0` for any
/// non-Transfer kind because the eth-style `value` field is mapped from
/// `tx.body.amount`, which non-Transfer variants leave unused.
///
/// `u128` fields are stringified to dodge the JSON 2^53 precision cliff.
/// For token-related kinds we resolve the underlying token's symbol +
/// decimals so the dashboard can format human-readable amounts in one
/// round-trip (no second `zbx_tokenInfo` call needed).
///
/// Wrapped inner enums (`StakeOp`, `MultisigOp`, `BridgeOp`, `ProposalOp`)
/// are decoded by their own helpers above (`stake_op_to_json`,
/// `multisig_op_to_json`, `bridge_op_to_json`, `proposal_op_to_json`) which
/// stringify every embedded `u128`. Adding a new variant to any of those
/// inner enums REQUIRES extending the corresponding helper — do NOT fall
/// back to raw `serde_json::to_value` for monetary fields.
fn tx_kind_to_json(
    kind: &crate::transaction::TxKind,
    st: &Arc<crate::state::State>,
) -> Value {
    use crate::transaction::TxKind::*;
    let token_decorate = |token_id: u64, mut base: serde_json::Map<String, Value>| -> Value {
        if let Some(t) = st.get_token(token_id) {
            base.insert("token_symbol".into(),   Value::String(t.symbol.clone()));
            base.insert("token_name".into(),     Value::String(t.name.clone()));
            base.insert("token_decimals".into(), json!(t.decimals));
        } else {
            base.insert("token_symbol".into(),   Value::Null);
            base.insert("token_name".into(),     Value::Null);
            base.insert("token_decimals".into(), Value::Null);
        }
        Value::Object(base)
    };
    match kind {
        Transfer => json!({ "type": "transfer" }),
        ValidatorAdd { pubkey, power } => json!({
            "type": "validator_add",
            "pubkey": format!("0x{}", hex::encode(pubkey)),
            "power": power,
        }),
        ValidatorRemove { address } => json!({
            "type": "validator_remove",
            "address": address.to_hex(),
        }),
        ValidatorEdit { address, new_power } => json!({
            "type": "validator_edit",
            "address": address.to_hex(),
            "new_power": new_power,
        }),
        GovernorChange { new_governor } => json!({
            "type": "governor_change",
            "new_governor": new_governor.to_hex(),
        }),
        Staking(op) => json!({
            "type": "staking",
            "op":   stake_op_to_json(op),
        }),
        RegisterPayId { pay_id, name } => json!({
            "type":  "register_pay_id",
            "pay_id": pay_id,
            "name":   name,
        }),
        Multisig(op) => json!({
            "type": "multisig",
            "op":   multisig_op_to_json(op),
        }),
        Swap { direction, min_out } => json!({
            "type":          "swap",
            "direction":     direction.label(),
            "input_symbol":  direction.input_symbol(),
            "output_symbol": direction.output_symbol(),
            "min_out":       min_out.to_string(),
        }),
        Bridge(op) => json!({
            "type": "bridge",
            "op":   bridge_op_to_json(op),
        }),
        Proposal(op) => json!({
            "type": "proposal",
            "op":   proposal_op_to_json(op),
        }),
        TokenCreate { name, symbol, decimals, initial_supply } => json!({
            "type":           "token_create",
            "name":           name,
            "symbol":         symbol,
            "decimals":       decimals,
            "initial_supply": initial_supply.to_string(),
        }),
        TokenTransfer { token_id, to, amount } => {
            let mut m = serde_json::Map::new();
            m.insert("type".into(),     Value::String("token_transfer".into()));
            m.insert("token_id".into(), json!(token_id));
            m.insert("to".into(),       Value::String(to.to_hex()));
            m.insert("amount".into(),   Value::String(amount.to_string()));
            token_decorate(*token_id, m)
        }
        TokenMint { token_id, to, amount } => {
            let mut m = serde_json::Map::new();
            m.insert("type".into(),     Value::String("token_mint".into()));
            m.insert("token_id".into(), json!(token_id));
            m.insert("to".into(),       Value::String(to.to_hex()));
            m.insert("amount".into(),   Value::String(amount.to_string()));
            token_decorate(*token_id, m)
        }
        TokenBurn { token_id, amount } => {
            let mut m = serde_json::Map::new();
            m.insert("type".into(),     Value::String("token_burn".into()));
            m.insert("token_id".into(), json!(token_id));
            m.insert("amount".into(),   Value::String(amount.to_string()));
            token_decorate(*token_id, m)
        }
        TokenPoolCreate { token_id, zbx_amount, token_amount } => {
            let mut m = serde_json::Map::new();
            m.insert("type".into(),         Value::String("token_pool_create".into()));
            m.insert("token_id".into(),     json!(token_id));
            m.insert("zbx_amount".into(),   Value::String(zbx_amount.to_string()));
            m.insert("token_amount".into(), Value::String(token_amount.to_string()));
            m.insert("pool_address".into(), Value::String(
                crate::token_pool::pool_address(*token_id).to_hex()
            ));
            token_decorate(*token_id, m)
        }
        TokenPoolAddLiquidity { token_id, zbx_amount, max_token_amount, min_lp_out } => {
            let mut m = serde_json::Map::new();
            m.insert("type".into(),             Value::String("token_pool_add_liquidity".into()));
            m.insert("token_id".into(),         json!(token_id));
            m.insert("zbx_amount".into(),       Value::String(zbx_amount.to_string()));
            m.insert("max_token_amount".into(), Value::String(max_token_amount.to_string()));
            m.insert("min_lp_out".into(),       Value::String(min_lp_out.to_string()));
            m.insert("pool_address".into(),     Value::String(
                crate::token_pool::pool_address(*token_id).to_hex()
            ));
            token_decorate(*token_id, m)
        }
        TokenPoolRemoveLiquidity { token_id, lp_burn, min_zbx_out, min_token_out } => {
            let mut m = serde_json::Map::new();
            m.insert("type".into(),          Value::String("token_pool_remove_liquidity".into()));
            m.insert("token_id".into(),      json!(token_id));
            m.insert("lp_burn".into(),       Value::String(lp_burn.to_string()));
            m.insert("min_zbx_out".into(),   Value::String(min_zbx_out.to_string()));
            m.insert("min_token_out".into(), Value::String(min_token_out.to_string()));
            m.insert("pool_address".into(),  Value::String(
                crate::token_pool::pool_address(*token_id).to_hex()
            ));
            token_decorate(*token_id, m)
        }
        TokenPoolSwap { token_id, direction, amount_in, min_out } => {
            let dir_label = match direction {
                crate::token_pool::TokenSwapDirection::ZbxToToken => "zbx_to_token",
                crate::token_pool::TokenSwapDirection::TokenToZbx => "token_to_zbx",
            };
            let mut m = serde_json::Map::new();
            m.insert("type".into(),         Value::String("token_pool_swap".into()));
            m.insert("token_id".into(),     json!(token_id));
            m.insert("direction".into(),    Value::String(dir_label.into()));
            m.insert("amount_in".into(),    Value::String(amount_in.to_string()));
            m.insert("min_out".into(),      Value::String(min_out.to_string()));
            m.insert("pool_address".into(), Value::String(
                crate::token_pool::pool_address(*token_id).to_hex()
            ));
            token_decorate(*token_id, m)
        }
        TokenSetMetadata { token_id, logo_url, website, description, twitter, telegram, discord } => {
            let mut m = serde_json::Map::new();
            m.insert("type".into(),        Value::String("token_set_metadata".into()));
            m.insert("token_id".into(),    json!(token_id));
            m.insert("logo_url".into(),    Value::String(logo_url.clone()));
            m.insert("website".into(),     Value::String(website.clone()));
            m.insert("description".into(), Value::String(description.clone()));
            m.insert("twitter".into(),     Value::String(twitter.clone()));
            m.insert("telegram".into(),    Value::String(telegram.clone()));
            m.insert("discord".into(),     Value::String(discord.clone()));
            token_decorate(*token_id, m)
        }
    }
}

async fn handle(AxState(ctx): AxState<RpcCtx>, Json(req): Json<RpcReq>) -> Json<RpcResp> {
    let _ = req.jsonrpc;
    let id = req.id.clone();
    let resp = match req.method.as_str() {
        // Always-on dual-name aliases. zbx_chainId / zbx_netVersion let
        // mobile + dashboard clients call the canonical Zebvix namespace
        // even on nodes built WITHOUT --features zvm; eth_chainId /
        // net_version remain so MetaMask / web3 / hardhat etc. work
        // unchanged. Both arms share the same handler — no behaviour
        // divergence is possible.
        "eth_chainId" | "zbx_chainId" => ok(id, json!(format!("0x{:x}", CHAIN_ID))),
        "net_version" | "zbx_netVersion" => ok(id, json!(CHAIN_ID.to_string())),
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
            // Mirrors `TxKind::tag_index()` in transaction.rs — keep both
            // tables in lockstep when a new TxKind variant is added.
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
                9 => "Bridge",
                10 => "Proposal",
                11 => "TokenCreate",
                12 => "TokenTransfer",
                13 => "TokenMint",
                14 => "TokenBurn",
                15 => "TokenPoolCreate",
                16 => "TokenPoolAddLiquidity",
                17 => "TokenPoolRemoveLiquidity",
                18 => "TokenPoolSwap",
                19 => "TokenSetMetadata",
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
            // Mirrors `TxKind::tag_index()` in transaction.rs — keep both
            // tables in lockstep when a new TxKind variant is added.
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
                9 => "Bridge",
                10 => "Proposal",
                11 => "TokenCreate",
                12 => "TokenTransfer",
                13 => "TokenMint",
                14 => "TokenBurn",
                15 => "TokenPoolCreate",
                16 => "TokenPoolAddLiquidity",
                17 => "TokenPoolRemoveLiquidity",
                18 => "TokenPoolSwap",
                19 => "TokenSetMetadata",
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
        "zbx_getTxByHash" => {
            // Phase H.1 — Resolve a 32-byte tx hash to its FULL typed payload
            // by:
            //   1. Looking up the containing block height in the recent-tx
            //      ring buffer (`State::find_tx_by_hash`).
            //   2. Re-fetching the SignedTx from block storage and decoding
            //      the `TxKind` enum into a friendly JSON object via
            //      `tx_kind_to_json`.
            //
            // This is the structured, native counterpart to the eth-style
            // `eth_getTransactionByHash` (which only ever sees `body.amount`
            // and so reports `value: 0` for any non-Transfer kind, hiding
            // the actual semantic amounts inside `TokenPoolCreate`,
            // `TokenPoolSwap`, `TokenTransfer`, etc).
            //
            // Coverage horizon: limited to the recent-tx ring window
            // (`RECENT_TX_CAP`, currently 1000 most recent committed txs).
            // Returns `null` for hashes that have aged out — the dashboard
            // should fall back to eth-style fields (or scan the block
            // directly via `zbx_getBlockByNumber`) for older history.
            let hash_str = match req.params.get(0).and_then(|v| v.as_str()) {
                Some(s) => s,
                None => return Json(err(id, -32602, "missing tx hash param (string)")),
            };
            let stripped = hash_str.strip_prefix("0x").unwrap_or(hash_str);
            let bytes = match hex::decode(stripped) {
                Ok(b) => b,
                Err(e) => return Json(err(id, -32602, format!("invalid hex: {}", e))),
            };
            if bytes.len() != 32 {
                return Json(err(id, -32602, format!(
                    "tx hash must be 32 bytes, got {}", bytes.len()
                )));
            }
            let mut h = [0u8; 32];
            h.copy_from_slice(&bytes);
            match ctx.state.find_signed_tx_by_hash(&h) {
                None => ok(id, Value::Null),
                Some((height, tx)) => {
                    let payload = tx_kind_to_json(&tx.body.kind, &ctx.state);
                    ok(id, json!({
                        "hash":       format!("0x{}", hex::encode(h)),
                        "height":     height,
                        "from":       tx.body.from.to_hex(),
                        "to":         tx.body.to.to_hex(),
                        // `body.amount` — the LEGACY ZBX-transfer amount
                        // field. Only meaningful for `Transfer` (and a few
                        // specific kinds documented inline on `TxKind`).
                        // Stringified to dodge the JSON 2^53 cliff.
                        "amount":     tx.body.amount.to_string(),
                        "fee":        tx.body.fee.to_string(),
                        "nonce":      tx.body.nonce,
                        "chain_id":   tx.body.chain_id,
                        "kind":       tx.body.kind.variant_name(),
                        "kind_index": tx.body.kind.tag_index(),
                        // The structured, kind-specific payload — this is
                        // where dashboards should look for the actual
                        // semantic amounts / addresses / parameters.
                        "payload":    payload,
                    }))
                }
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
            let minted = cumulative_supply(h);
            let premine = crate::tokenomics::FOUNDER_PREMINE_WEI;
            let burn_addr = crate::state::burn_address();
            let burned = ctx.state.account(&burn_addr).balance;
            // Pool genesis seed: when the admin runs `pool-init-genesis`,
            // GENESIS_POOL_ZBX_WEI (20M ZBX, Phase B.11.1) is minted DIRECTLY
            // into the AMM pool reserves alongside 10M zUSD loan, giving an
            // opening spot price of $0.50 / ZBX. This mint is NOT counted by
            // `cumulative_supply()` (which tracks block rewards only), so we
            // add it back here once the pool is initialized. Before pool
            // init, this is 0.
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
        "zbx_getBridgeOutBySeq" => {
            // Params: [seq: u64 (string or number)]
            let seq = req
                .params
                .get(0)
                .and_then(|v| {
                    v.as_u64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                })
                .unwrap_or(u64::MAX);
            if seq == u64::MAX {
                return axum::Json(err(id, -32602, "seq must be a u64"));
            }
            match ctx.state.bridge_get_out_event_by_seq(seq) {
                Some(e) => ok(
                    id,
                    json!({
                        "seq":           e.seq,
                        "asset_id":      e.asset_id.to_string(),
                        "native_symbol": e.native_symbol,
                        "from":          e.from.to_hex(),
                        "dest_address":  e.dest_address,
                        "amount":        e.amount.to_string(),
                        "height":        e.height,
                        "tx_hash":       format!("0x{}", hex::encode(e.tx_hash)),
                    }),
                ),
                None => err(
                    id,
                    -32004,
                    format!("bridge-out event seq {} not found (evicted or out of range)", seq),
                ),
            }
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
        "zbx_bridgePaused" => {
            // H6 admin kill-switch surface. Read-only; safe for public RPC.
            // Wallet UIs poll this to show a "bridge unavailable" banner and
            // disable the Send button when paused.
            ok(id, json!({
                "paused": ctx.state.bridge_paused(),
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
        // ────────── Phase D — Forkless on-chain governance ──────────
        // Read-only views over proposals + feature flags. Submit/Vote happen
        // via standard `zbx_sendRawTransaction` with a `TxKind::Proposal`
        // payload, identical to every other tx.

        "zbx_proposalsList" => {
            // Params: [limit?: u64]  (default 50, no hard cap — proposals are bounded by submit limits)
            let limit = req.params.get(0).and_then(|v| v.as_u64()).unwrap_or(50) as usize;
            let recent = ctx.state.list_proposals_recent(limit);
            let (h, _) = ctx.state.tip();
            let to_json = |p: &crate::proposal::Proposal| json!({
                "id": p.id,
                "proposer": p.proposer.to_hex(),
                "title": p.title,
                "description": p.description,
                "kind": proposal_kind_to_json(&p.kind),
                "status": p.status.label(),
                "created_at_height": p.created_at_height,
                "created_at_ms": p.created_at_ms,
                "voting_starts_at_height": p.voting_starts_at_height,
                "voting_ends_at_height": p.voting_ends_at_height,
                "yes_votes": p.yes_votes,
                "no_votes": p.no_votes,
                "total_votes": p.total_votes(),
                "pass_pct_bps": p.pass_pct_bps(),
                "test_runs": p.test_runs,
                "test_success": p.test_success,
                "test_failure": p.test_failure,
                "activated_at_height": p.activated_at_height,
                "blocks_until_voting": p.voting_starts_at_height.saturating_sub(h),
                "blocks_until_close": p.voting_ends_at_height.saturating_sub(h),
            });
            let arr: Vec<Value> = recent.iter().map(to_json).collect();
            ok(id, json!({
                "count": arr.len(),
                "tip_height": h,
                "min_proposer_balance_wei": crate::proposal::MIN_PROPOSER_BALANCE_WEI.to_string(),
                "test_phase_blocks": crate::proposal::TEST_PHASE_BLOCKS,
                "vote_phase_blocks": crate::proposal::VOTE_PHASE_BLOCKS,
                "total_lifecycle_blocks": crate::proposal::TOTAL_LIFECYCLE_BLOCKS,
                "min_quorum_votes": crate::proposal::MIN_QUORUM_VOTES,
                "pass_threshold_bps": crate::proposal::PASS_THRESHOLD_BPS,
                "proposals": arr,
            }))
        }

        "zbx_proposalGet" => {
            // Params: [id: u64]
            let pid = match req.params.get(0).and_then(|v| v.as_u64()) {
                Some(n) => n,
                None => return Json(err(id, -32602, "missing proposal id")),
            };
            match ctx.state.get_proposal(pid) {
                Some(p) => {
                    let (h, _) = ctx.state.tip();
                    ok(id, json!({
                        "id": p.id,
                        "proposer": p.proposer.to_hex(),
                        "title": p.title,
                        "description": p.description,
                        "kind": proposal_kind_to_json(&p.kind),
                        "status": p.status.label(),
                        "created_at_height": p.created_at_height,
                        "created_at_ms": p.created_at_ms,
                        "voting_starts_at_height": p.voting_starts_at_height,
                        "voting_ends_at_height": p.voting_ends_at_height,
                        "yes_votes": p.yes_votes,
                        "no_votes": p.no_votes,
                        "total_votes": p.total_votes(),
                        "pass_pct_bps": p.pass_pct_bps(),
                        "meets_pass_criteria": p.meets_pass_criteria(),
                        "test_runs": p.test_runs,
                        "test_success": p.test_success,
                        "test_failure": p.test_failure,
                        "activated_at_height": p.activated_at_height,
                        "tip_height": h,
                        "blocks_until_voting": p.voting_starts_at_height.saturating_sub(h),
                        "blocks_until_close": p.voting_ends_at_height.saturating_sub(h),
                    }))
                }
                None => ok(id, Value::Null),
            }
        }

        "zbx_proposerCheck" => {
            // Params: [address]
            let addr = match req.params.get(0).and_then(parse_address) {
                Some(a) => a,
                None => return Json(err(id, -32602, "invalid address")),
            };
            let bal = ctx.state.balance(&addr);
            let active = ctx.state.count_active_proposals_by(&addr);
            ok(id, json!({
                "address": addr.to_hex(),
                "balance_wei": bal.to_string(),
                "balance_zbx": format!("{:.6}", bal as f64 / 1e18),
                "min_proposer_balance_wei": crate::proposal::MIN_PROPOSER_BALANCE_WEI.to_string(),
                "min_proposer_balance_zbx": "1000",
                "has_min_balance": bal >= crate::proposal::MIN_PROPOSER_BALANCE_WEI,
                "active_proposals": active,
                "max_active_proposals": crate::proposal::MAX_ACTIVE_PROPOSALS_PER_ADDRESS,
                "can_submit": bal >= crate::proposal::MIN_PROPOSER_BALANCE_WEI
                    && active < crate::proposal::MAX_ACTIVE_PROPOSALS_PER_ADDRESS,
            }))
        }

        "zbx_proposalHasVoted" => {
            // Params: [proposal_id: u64, voter: hex]
            let pid = match req.params.get(0).and_then(|v| v.as_u64()) {
                Some(n) => n,
                None => return Json(err(id, -32602, "missing proposal id")),
            };
            let voter = match req.params.get(1).and_then(parse_address) {
                Some(a) => a,
                None => return Json(err(id, -32602, "invalid voter address")),
            };
            ok(id, json!({
                "proposal_id": pid,
                "voter": voter.to_hex(),
                "has_voted": ctx.state.has_voted(pid, &voter),
            }))
        }

        "zbx_proposalShadowExec" => {
            // Params: [proposal_id: u64]
            // Strictly read-only "what-if": describes the chain state that
            // would result if this proposal were already activated. MUST NOT
            // mutate any consensus-replicated state — different RPC traffic
            // across nodes would otherwise cause divergence.
            let pid = match req.params.get(0).and_then(|v| v.as_u64()) {
                Some(n) => n,
                None => return Json(err(id, -32602, "missing proposal id")),
            };
            let p = match ctx.state.get_proposal(pid) {
                Some(p) => p,
                None => return Json(ok(id, json!({
                    "ok": false,
                    "reason": "proposal not found",
                }))),
            };
            // Compute the projected effect.
            let (effect, success): (Value, bool) = match &p.kind {
                crate::proposal::ProposalKind::FeatureFlag { key, enabled } => (json!({
                    "type": "feature_flag",
                    "key": key,
                    "current_value": ctx.state.get_feature_flag(key)
                        .map(|v| v.to_string()).unwrap_or_else(|| "<unset>".into()),
                    "would_become": if *enabled { "1" } else { "0" },
                    "would_enable": *enabled,
                }), true),
                crate::proposal::ProposalKind::ParamChange { param, new_value } => (json!({
                    "type": "param_change",
                    "param": param,
                    "current_value": ctx.state.get_feature_flag(param)
                        .map(|v| v.to_string()).unwrap_or_else(|| "<unset>".into()),
                    "would_become": new_value.to_string(),
                }), true),
                crate::proposal::ProposalKind::ContractWhitelist { key, address, label } => (json!({
                    "type": "contract_whitelist",
                    "key": key,
                    "address": address.to_hex(),
                    "label": label,
                    "currently_whitelisted": ctx.state.get_contract_label(key).is_some(),
                }), true),
                crate::proposal::ProposalKind::TextOnly => (json!({
                    "type": "text_only",
                    "note": "signal-only proposal — no on-chain effect at activation",
                }), true),
            };
            ok(id, json!({
                "ok": success,
                "proposal_id": pid,
                "status": p.status.label(),
                "shadow_executed": true,
                "main_state_committed": false,
                "projected_effect": effect,
            }))
        }

        "zbx_featureFlagsList" => {
            let flags = ctx.state.list_feature_flags();
            let arr: Vec<Value> = flags.into_iter().map(|(k, v)| {
                let label = ctx.state.get_contract_label(&k);
                json!({
                    "key": k,
                    "value": v.to_string(),
                    "enabled": v != 0,
                    "contract_address": label.as_ref().map(|(a, _, _)| a.to_hex()),
                    "contract_label":   label.as_ref().map(|(_, l, _)| l.clone()),
                    "set_at_height":    label.as_ref().map(|(_, _, h)| *h),
                })
            }).collect();
            ok(id, json!({ "count": arr.len(), "flags": arr }))
        }

        "zbx_featureFlagGet" => {
            // Params: [key: string]
            let key = match req.params.get(0).and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => return Json(err(id, -32602, "missing flag key")),
            };
            let v = ctx.state.get_feature_flag(&key);
            ok(id, json!({
                "key": key,
                "value": v.map(|n| n.to_string()),
                "enabled": v.map(|n| n != 0).unwrap_or(false),
                "set": v.is_some(),
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
        // Phase B.3.3 — slashing evidence ledger (read-only)
        "zbx_listEvidence" => {
            let limit = req.params.get(0).and_then(|v| v.as_u64()).unwrap_or(50) as usize;
            let limit = limit.min(1000);
            let evs = ctx.state.list_evidence(limit);
            let total = ctx.state.evidence_count();
            let arr: Vec<Value> = evs.iter().map(|e| json!({
                "validator": e.validator.to_hex(),
                "height": e.height,
                "round": e.round,
                "vote_type": e.vote_type,
                "previous_block_hash": e.previous_block_hash.to_string(),
                "conflicting_block_hash": e.conflicting_block_hash.to_string(),
                "recorded_at_height": e.recorded_at_height,
                "slashed_amount_wei": e.slashed_amount_wei.to_string(),
            })).collect();
            ok(id, json!({
                "count": arr.len(),
                "total_recorded": total,
                "slashing_enabled": *crate::state::SLASHING_ENABLED,
                "evidence": arr,
            }))
        }

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

        // ─────────────────────────────────────────────────────────────
        // Phase E — User-creatable fungible tokens
        // ─────────────────────────────────────────────────────────────
        "zbx_tokenInfo" => {
            // params: [token_id (number or "0x"-hex string)]
            let id_v = req.params.get(0);
            let token_id: Option<u64> = match id_v {
                Some(Value::Number(n)) => n.as_u64(),
                Some(Value::String(s)) => {
                    let s = s.trim();
                    if let Some(hx) = s.strip_prefix("0x") {
                        u64::from_str_radix(hx, 16).ok()
                    } else {
                        s.parse::<u64>().ok()
                    }
                }
                _ => None,
            };
            match token_id.and_then(|i| ctx.state.get_token(i)) {
                Some(t) => ok(id, token_info_to_json(&t, &ctx.state)),
                None => err(id, -32004, "token not found"),
            }
        }
        "zbx_tokenInfoBySymbol" => {
            // params: [symbol]
            match req.params.get(0).and_then(|v| v.as_str()) {
                Some(sym) => match ctx.state.get_token_by_symbol(sym) {
                    Some(t) => ok(id, token_info_to_json(&t, &ctx.state)),
                    None => err(id, -32004, "token not found"),
                },
                None => err(id, -32602, "params: [symbol]"),
            }
        }
        "zbx_tokenBalanceOf" => {
            // params: [token_id, address]
            let token_id: Option<u64> = req.params.get(0).and_then(|v| match v {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => {
                    let s = s.trim();
                    if let Some(hx) = s.strip_prefix("0x") {
                        u64::from_str_radix(hx, 16).ok()
                    } else { s.parse::<u64>().ok() }
                }
                _ => None,
            });
            let addr = req.params.get(1).and_then(parse_address);
            match (token_id, addr) {
                (Some(tid), Some(a)) => {
                    let bal = ctx.state.token_balance_of(tid, &a);
                    ok(id, json!({
                        "token_id": tid,
                        "address": a.to_hex(),
                        "balance": bal.to_string(),
                        "balance_hex": format!("0x{:x}", bal),
                    }))
                }
                _ => err(id, -32602, "params: [token_id, address]"),
            }
        }
        "zbx_listTokens" => {
            // params: [offset, limit] — both optional, default offset=0 limit=50.
            let offset = req.params.get(0)
                .and_then(|v| v.as_u64()).unwrap_or(0);
            let limit = req.params.get(1)
                .and_then(|v| v.as_u64()).unwrap_or(50).min(500);
            let total = ctx.state.total_token_count();
            let tokens: Vec<Value> = ctx.state.list_tokens(offset, limit)
                .iter().map(|t| token_info_to_json(t, &ctx.state)).collect();
            ok(id, json!({
                "total": total,
                "offset": offset,
                "limit": limit,
                "tokens": tokens,
            }))
        }
        "zbx_tokenCount" => ok(id, json!({ "total": ctx.state.total_token_count() })),

        // ─────────────────────────────────────────────────────────────
        // Phase G — Token metadata (read-only RPC)
        // ─────────────────────────────────────────────────────────────
        "zbx_getTokenMetadata" => {
            // params: [token_id (number, decimal string, or 0xhex)]
            let token_id: Option<u64> = req.params.get(0).and_then(|v| match v {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => {
                    let s = s.trim();
                    if let Some(hx) = s.strip_prefix("0x") {
                        u64::from_str_radix(hx, 16).ok()
                    } else { s.parse::<u64>().ok() }
                }
                _ => None,
            });
            let Some(tid) = token_id else {
                return Json(err(id, -32602, "params: [token_id]"));
            };
            // Token must exist; otherwise return -32004 so the frontend can
            // distinguish "no such token" from "token exists but no metadata".
            if ctx.state.get_token(tid).is_none() {
                return Json(err(id, -32004, "token not found"));
            }
            match ctx.state.get_token_metadata(tid) {
                Some(m) => ok(id, token_metadata_to_json(&m)),
                // Token exists but creator hasn't set metadata yet — return
                // an empty record so frontends can render a "not yet set"
                // state without a separate null-check branch.
                None => ok(id, json!({
                    "token_id":          tid,
                    "logo_url":          "",
                    "website":           "",
                    "description":       "",
                    "twitter":           "",
                    "telegram":          "",
                    "discord":           "",
                    "updated_at_height": 0,
                    "unset":             true,
                })),
            }
        }

        // ─────────────────────────────────────────────────────────────
        // Phase F — Per-token AMM pools (read-only RPCs)
        // ─────────────────────────────────────────────────────────────
        "zbx_getTokenPool" => {
            // params: [token_id (number or "0x..." or decimal string)]
            let token_id: Option<u64> = req.params.get(0).and_then(|v| match v {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => {
                    let s = s.trim();
                    if let Some(hx) = s.strip_prefix("0x") {
                        u64::from_str_radix(hx, 16).ok()
                    } else { s.parse::<u64>().ok() }
                }
                _ => None,
            });
            match token_id.and_then(|i| ctx.state.get_token_pool(i)) {
                Some(p) => ok(id, token_pool_to_json(&p, &ctx.state)),
                None => err(id, -32004, "token pool not found"),
            }
        }
        "zbx_listTokenPools" => {
            // params: [offset, limit] — both optional, default offset=0 limit=50.
            let offset = req.params.get(0).and_then(|v| v.as_u64()).unwrap_or(0);
            let limit = req.params.get(1).and_then(|v| v.as_u64()).unwrap_or(50).min(500);
            let pools: Vec<Value> = ctx.state.list_token_pools(offset, limit)
                .iter().map(|p| token_pool_to_json(p, &ctx.state)).collect();
            ok(id, json!({
                "total":     ctx.state.token_pool_count(),
                "offset":    offset,
                "limit":     limit,
                "returned":  pools.len(),
                "pools":     pools,
            }))
        }
        "zbx_tokenPoolCount" => {
            ok(id, json!({ "total": ctx.state.token_pool_count() }))
        }
        // ─────────────────────────────────────────────────────────────
        // Phase H — Pool address derivation lookups
        // ─────────────────────────────────────────────────────────────
        "zbx_getTokenPoolByAddress" => {
            // params: [pool_address ("0x..." 20 bytes)]
            // Returns the full pool JSON when a pool is open at this address,
            // or an error when the address is not a (reserved or open) pool
            // address. The "address is reserved but no pool opened yet" case
            // returns -32004 with a distinct message so the dashboard can
            // surface a "pool not yet bootstrapped" hint without crashing.
            //
            // Uses `try_get_pool_token_id_by_address` (Result-returning
            // variant) — RPC paths must NOT panic the validator on DB errors;
            // a structured JSON-RPC error is the right response to a bad
            // user-controlled query.
            let Some(addr) = req.params.get(0).and_then(parse_address) else {
                return Json(err(id, -32602, "params: [pool_address: hex string]"));
            };
            match ctx.state.try_get_pool_token_id_by_address(&addr) {
                Ok(Some(tid)) => match ctx.state.get_token_pool(tid) {
                    Some(p) => ok(id, token_pool_to_json(&p, &ctx.state)),
                    None => err(id, -32004, &format!(
                        "pool address reserved for token id {} but no pool has been opened yet — call TokenPoolCreate first",
                        tid,
                    )),
                },
                Ok(None) => err(id, -32004, "address is not a token pool address"),
                Err(e) => err(id, -32603, &format!("internal: {}", e)),
            }
        }
        "zbx_isPoolAddress" => {
            // params: [address]
            // Returns: {
            //   address:  "0x...",
            //   is_pool:  bool,        // index hit (rejection-relevant flag)
            //   token_id: number|null, // which token owns this address
            //   pool_open: bool,       // true once a TokenPool has been opened
            // }
            //
            // Phase H: every token's deterministic pool address is reserved
            // at TokenCreate time, so `is_pool` is true even before a pool
            // has been opened (transfer guards reject sends regardless).
            // `pool_open` lets wallets render "pool reserved but not yet
            // bootstrapped" vs "live pool" differently.
            //
            // Uses the non-panicking variant — RPC must not crash the node
            // on DB-read errors triggered by user-controlled input.
            let Some(addr) = req.params.get(0).and_then(parse_address) else {
                return Json(err(id, -32602, "params: [address: hex string]"));
            };
            let tid = match ctx.state.try_get_pool_token_id_by_address(&addr) {
                Ok(opt) => opt,
                Err(e) => return Json(err(id, -32603, &format!("internal: {}", e))),
            };
            let pool_open = tid.and_then(|t| ctx.state.get_token_pool(t)).is_some();
            ok(id, json!({
                "address":   addr.to_hex(),
                "is_pool":   tid.is_some(),
                "token_id":  tid,
                "pool_open": pool_open,
            }))
        }
        "zbx_tokenSwapQuote" => {
            // params: [token_id, direction ("zbx_to_token"|"token_to_zbx"), amount_in (decimal string)]
            let token_id: Option<u64> = req.params.get(0).and_then(|v| match v {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => s.trim().parse::<u64>().ok(),
                _ => None,
            });
            let dir = req.params.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let amount_in: Option<u128> = req.params.get(2).and_then(|v| match v {
                Value::String(s) => s.trim().parse::<u128>().ok(),
                Value::Number(n) => n.as_u64().map(|x| x as u128),
                _ => None,
            });
            let (Some(tid), Some(amt)) = (token_id, amount_in) else {
                return Json(err(id, -32602, "params: [token_id, direction, amount_in]"));
            };
            let Some(pool) = ctx.state.get_token_pool(tid) else {
                return Json(err(id, -32004, "token pool not found"));
            };
            use crate::token_pool::TokenSwapDirection;
            let direction = match dir {
                "zbx_to_token" => TokenSwapDirection::ZbxToToken,
                "token_to_zbx" => TokenSwapDirection::TokenToZbx,
                _ => return Json(err(id, -32602, "direction must be 'zbx_to_token' or 'token_to_zbx'")),
            };
            let amount_out = pool.quote(direction, amt);
            // Compute the exact fee amount that would be deducted from input
            let fee = amt.saturating_mul(crate::token_pool::TOKEN_POOL_FEE_BPS_NUM)
                / crate::token_pool::TOKEN_POOL_FEE_BPS_DEN;
            ok(id, json!({
                "token_id":      tid,
                "direction":     direction.label(),
                "amount_in":     amt.to_string(),
                "amount_out":    amount_out.to_string(),
                "fee_in":        fee.to_string(),
                "fee_bps":       crate::token_pool::TOKEN_POOL_FEE_BPS_NUM,
                "fee_bps_den":   crate::token_pool::TOKEN_POOL_FEE_BPS_DEN,
                "zbx_reserve":   pool.zbx_reserve.to_string(),
                "token_reserve": pool.token_reserve.to_string(),
            }))
        }
        "zbx_getTokenLpBalance" => {
            // params: [token_id, address]
            let token_id: Option<u64> = req.params.get(0).and_then(|v| match v {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => s.trim().parse::<u64>().ok(),
                _ => None,
            });
            let addr = req.params.get(1).and_then(parse_address);
            match (token_id, addr) {
                (Some(tid), Some(a)) => {
                    let lp = ctx.state.token_pool_lp_balance_of(tid, &a);
                    let pool = ctx.state.get_token_pool(tid);
                    let (zbx_share, token_share) = match &pool {
                        Some(p) if p.lp_supply > 0 => {
                            use primitive_types::U256;
                            let z = U256::from(p.zbx_reserve) * U256::from(lp)
                                / U256::from(p.lp_supply);
                            let t = U256::from(p.token_reserve) * U256::from(lp)
                                / U256::from(p.lp_supply);
                            (
                                if z.bits() > 128 { 0 } else { z.as_u128() },
                                if t.bits() > 128 { 0 } else { t.as_u128() },
                            )
                        }
                        _ => (0, 0),
                    };
                    ok(id, json!({
                        "token_id":            tid,
                        "address":             a.to_hex(),
                        "lp_balance":          lp.to_string(),
                        "lp_supply":           pool.as_ref().map(|p| p.lp_supply.to_string())
                                                   .unwrap_or_else(|| "0".to_string()),
                        "redeemable_zbx":      zbx_share.to_string(),
                        "redeemable_token":    token_share.to_string(),
                    }))
                }
                _ => err(id, -32602, "params: [token_id, address]"),
            }
        }
        "zbx_tokenPoolStats" => {
            // params: [token_id] — lifetime cumulative stats for analytics.
            let token_id: Option<u64> = req.params.get(0).and_then(|v| match v {
                Value::Number(n) => n.as_u64(),
                Value::String(s) => s.trim().parse::<u64>().ok(),
                _ => None,
            });
            match token_id.and_then(|i| ctx.state.get_token_pool(i)) {
                Some(p) => ok(id, json!({
                    "token_id":             p.token_id,
                    "zbx_reserve":          p.zbx_reserve.to_string(),
                    "token_reserve":        p.token_reserve.to_string(),
                    "lp_supply":            p.lp_supply.to_string(),
                    "spot_price_q18":       p.spot_price_zbx_per_token_q18().to_string(),
                    "cum_zbx_in_volume":    p.cum_zbx_in_volume.to_string(),
                    "cum_token_in_volume":  p.cum_token_in_volume.to_string(),
                    "swap_count":           p.swap_count,
                    "init_height":          p.init_height,
                    "creator":              p.creator.to_hex(),
                })),
                None => err(id, -32004, "token pool not found"),
            }
        }

        m => {
            // Phase C.2 — Standard ZVM JSON-RPC fallthrough. Any `eth_*`,
            // `net_*`, or `web3_*` method that the legacy native dispatcher
            // above did not handle is routed to `zvm_rpc::dispatch` so the
            // node speaks Geth-compatible JSON-RPC for wallets and tooling.
            //
            // We also forward a curated set of ZVM-side `zbx_*` aliases
            // (`zbx_clientVersion`, `zbx_syncing`, `zbx_accounts`,
            // `zbx_gasPrice`, `zbx_blobBaseFee`, `zbx_getCode`,
            // `zbx_getStorageAt`, `zbx_call`, `zbx_getLogs`,
            // `zbx_getZvmReceipt`, `zbx_getZvmTransaction`,
            // `zbx_feeHistory`, `zbx_sendRawZvmTransaction`) — every one
            // of these resolves to the SAME handler as its `eth_*` /
            // `web3_*` partner inside `zvm_rpc::dispatch`, so dashboards
            // and CLIs that prefer the Zebvix-native namespace get
            // identical results without ever touching the EVM-spec
            // wire-protocol method names. These aliases require
            // `--features zvm`; without it, the dispatcher returns
            // `method not found` just like the eth_* originals.
            //
            // The legacy `zbx_*Evm*` names (`zbx_getEvmReceipt`,
            // `zbx_getEvmTransaction`, `zbx_sendRawEvmTransaction`) are
            // ALSO accepted as DEPRECATED aliases so any external client
            // already wired to the old names keeps working through the
            // rebrand window. Prefer the canonical `zbx_*Zvm*` names in
            // new code.
            #[cfg(feature = "zvm")]
            if m.starts_with("eth_") || m.starts_with("net_") || m.starts_with("web3_")
                || matches!(m,
                    "zbx_clientVersion" | "zbx_syncing" | "zbx_accounts"
                    | "zbx_gasPrice" | "zbx_blobBaseFee" | "zbx_getCode"
                    | "zbx_getStorageAt" | "zbx_call" | "zbx_getLogs"
                    | "zbx_getZvmReceipt" | "zbx_getZvmTransaction"
                    | "zbx_feeHistory"
                    | "zbx_sendRawZvmTransaction"
                    // Deprecated aliases — accept for backward compat.
                    | "zbx_getEvmReceipt" | "zbx_getEvmTransaction"
                    | "zbx_sendRawEvmTransaction"
                )
            {
                if let Some(resp) = try_zvm_dispatch(&ctx, &id, m, &req.params) {
                    return Json(resp);
                }
            }
            err(id, -32601, format!("method not found: {m}"))
        }
    };
    Json(resp)
}

/// Phase C.2 — bridge between the legacy native RPC dispatcher and the
/// ZVM JSON-RPC handler in `zvm_rpc::dispatch`. Returns `None` when the
/// ZVM DB is not configured (so the catch-all can return `method not found`).
#[cfg(feature = "zvm")]
fn try_zvm_dispatch(
    ctx: &RpcCtx,
    id: &Value,
    method: &str,
    params: &Value,
) -> Option<RpcResp> {
    let db = ctx.zvm_db.as_ref()?.clone();
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

    let zvm_ctx = crate::zvm_rpc::ZvmRpcCtx {
        db,
        // Phase C.2.1 — share native State so eth_getTransactionByHash and
        // eth_getTransactionReceipt can resolve hashes via find_tx_by_hash.
        state: ctx.state.clone(),
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

    Some(match crate::zvm_rpc::dispatch(&zvm_ctx, method, &params_arr) {
        Ok(v) => ok(id.clone(), v),
        Err(e) => err(id.clone(), -32000, e),
    })
}

// ── F006.5/H1 — In-process RPC concurrency cap (shipped 2026-04-28) ──
//
// Defense-in-depth backstop alongside the recommended nginx /
// Cloudflare per-IP rate limiter. Caps total concurrent in-flight
// JSON-RPC requests to `RPC_DEFAULT_MAX_INFLIGHT` (256), tunable at
// startup via the `ZEBVIX_RPC_MAX_INFLIGHT=<n>` env var. Excess
// requests are rejected with HTTP 503 + a short retry-after message
// so the consensus producer task is shielded from RPC-driven runtime
// starvation if the upstream proxy is misconfigured or absent.
//
// Why a global semaphore rather than per-IP token bucket?
// 1. Per-IP needs IP extraction from the proxied connection (X-
//    Forwarded-For parsing is fragile across nginx/Cloudflare/
//    Cloudflare-tunnel topologies) and a GC'd HashMap of buckets.
//    Both are reasonable to defer to the out-of-process limiter
//    that already does them well.
// 2. The single risk this layer must defeat is "the producer task
//    misses a tick deadline because tokio's runtime is saturated
//    with cheap RPC reads". A global concurrency cap is the
//    minimal mechanism that does that.
// 3. Zero new deps: `tokio::sync::Semaphore` + `once_cell::sync::
//    Lazy` are already pulled by the workspace.
//
// The permit is acquired with `try_acquire_owned()` (NEVER
// `acquire_owned().await`) so over-cap requests fail FAST with 503
// rather than queueing in the runtime — queueing would defeat the
// purpose by holding tokio tasks open and starving consensus.
pub(crate) const RPC_DEFAULT_MAX_INFLIGHT: usize = 256;

/// **F006.5/H1 — Resolved effective cap.** Populated by the
/// `RPC_INFLIGHT_SEMAPHORE` `Lazy` initializer to whatever cap the
/// semaphore was actually built with (env override or default). Used
/// by `rpc_concurrency_limit_middleware` so overload warn logs show
/// the EFFECTIVE cap, not the compile-time default — critical for
/// ops debugging during incidents (an operator who set
/// `ZEBVIX_RPC_MAX_INFLIGHT=1024` but is still seeing 503s needs to
/// see "max=1024" in the log, not "max=256"). Stays at 0 until
/// `Lazy::force(&RPC_INFLIGHT_SEMAPHORE)` runs at `router()` startup.
pub(crate) static RPC_EFFECTIVE_MAX_INFLIGHT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub(crate) static RPC_INFLIGHT_SEMAPHORE: once_cell::sync::Lazy<
    std::sync::Arc<tokio::sync::Semaphore>,
> = once_cell::sync::Lazy::new(|| {
    // Fail-loud env parsing: if `ZEBVIX_RPC_MAX_INFLIGHT` is SET (i.e.
    // the operator intended to override) but cannot be parsed as a
    // positive integer, emit a WARN log naming the bad value before
    // falling back to the default. Silent fallback would mislead ops
    // ("I set the env but the cap didn't change?!"). Unset env is
    // treated as "no override" and stays silent (default-only path).
    let raw = std::env::var("ZEBVIX_RPC_MAX_INFLIGHT").ok();
    let cap = match raw.as_deref() {
        None => RPC_DEFAULT_MAX_INFLIGHT,
        Some(s) => match s.trim().parse::<usize>() {
            Ok(n) if n > 0 => n,
            // n == 0 path (n > 0 guard above is the only "valid" path)
            Ok(_) => {
                tracing::warn!(
                    "rpc: ZEBVIX_RPC_MAX_INFLIGHT='{s}' parsed to zero — \
                     a zero cap would reject all requests; falling back to default {default} \
                     (set a positive integer to override)",
                    default = RPC_DEFAULT_MAX_INFLIGHT,
                );
                RPC_DEFAULT_MAX_INFLIGHT
            }
            Err(e) => {
                tracing::warn!(
                    "rpc: ZEBVIX_RPC_MAX_INFLIGHT='{s}' is not a valid positive integer ({e}) — \
                     falling back to default {default}",
                    default = RPC_DEFAULT_MAX_INFLIGHT,
                );
                RPC_DEFAULT_MAX_INFLIGHT
            }
        },
    };
    RPC_EFFECTIVE_MAX_INFLIGHT.store(cap, std::sync::atomic::Ordering::SeqCst);
    tracing::info!(
        "🛡  RPC in-process concurrency cap: max {cap} in-flight requests \
         (set ZEBVIX_RPC_MAX_INFLIGHT to tune; per-IP limiting still \
         recommended via nginx / Cloudflare in front)"
    );
    std::sync::Arc::new(tokio::sync::Semaphore::new(cap))
});

/// **F006.5/H1 — RPC concurrency-cap middleware.** Acquires one
/// permit from the global [`RPC_INFLIGHT_SEMAPHORE`] before
/// dispatching to the inner handler. On semaphore exhaustion, fails
/// fast with HTTP 503 + a short text body — does NOT queue (queueing
/// would defeat the purpose by tying up tokio tasks). The permit is
/// held via RAII `_permit` binding so it auto-releases on every exit
/// path including handler panic (which under our `panic = "abort"`
/// release profile is moot — process dies — but it's the right
/// pattern regardless).
pub(crate) async fn rpc_concurrency_limit_middleware(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    let _permit = match RPC_INFLIGHT_SEMAPHORE.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => {
            // Show the EFFECTIVE configured cap (env override applied),
            // not the compile-time default — critical for ops debugging.
            // An operator who set ZEBVIX_RPC_MAX_INFLIGHT=1024 but is
            // still seeing 503s needs to see "max=1024" here, not 256.
            let effective_cap =
                RPC_EFFECTIVE_MAX_INFLIGHT.load(std::sync::atomic::Ordering::Relaxed);
            tracing::warn!(
                "rpc: concurrency cap hit (max={effective_cap} in-flight), rejecting with HTTP 503 — \
                 set ZEBVIX_RPC_MAX_INFLIGHT higher or front the RPC with nginx/Cloudflare"
            );
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "rpc: too many concurrent requests, please retry shortly\n",
            )
                .into_response();
        }
    };
    next.run(req).await
}

pub fn router(ctx: RpcCtx) -> Router {
    // Force-evaluate the semaphore at startup (rather than first-
    // request) so the configured cap appears in the boot log and any
    // env-parsing surprise is caught before traffic arrives.
    once_cell::sync::Lazy::force(&RPC_INFLIGHT_SEMAPHORE);

    // ── Phase B.3.3 — RPC hardening ──
    //
    // CORS: default behaviour preserved (open) so existing dashboards keep
    // working. Operators lock down to a specific allowlist by setting
    //   ZEBVIX_RPC_CORS_ORIGINS=https://app.example.com,https://admin.example.com
    //
    // Body limit: 256 KiB caps payload-flood DOS. The largest legitimate
    // JSON-RPC request on this chain is a raw EVM-format ZVM tx (~128 KiB
    // ceiling), so 256 KiB is plenty of headroom.
    //
    // **Concurrency cap (F006.5/H1, shipped 2026-04-28):** in-process
    // backstop limiting in-flight RPC requests to RPC_DEFAULT_MAX_INFLIGHT
    // (256, tunable via `ZEBVIX_RPC_MAX_INFLIGHT`). When exceeded, requests
    // are rejected with HTTP 503 + a short retry-after message; the
    // consensus producer task is shielded from RPC-driven runtime
    // starvation. See the static `RPC_INFLIGHT_SEMAPHORE` and
    // `rpc_concurrency_limit_middleware` defined above this function for
    // the full rationale (zero-new-deps + fail-fast vs queue-on-overflow).
    //
    // Per-IP rate limiting is still delegated to nginx / Cloudflare in
    // front of the public RPC (out-of-process limiters survive node
    // restarts and can share state across multiple RPC nodes; in-process
    // semaphore here is a global cap, not per-IP). The chain additionally
    // enforces:
    //   • mempool fee floor (MIN_TX_FEE_WEI) → economic rate-limit on writes
    //   • mempool max_size (50 000) → hard upper bound on pending state
    //   • per-block tx cap (MAX_TXS_PER_BLOCK = 5 000) → consensus throttle
    //
    let cors = match std::env::var("ZEBVIX_RPC_CORS_ORIGINS") {
        Ok(csv) if !csv.trim().is_empty() => {
            let origins: Vec<axum::http::HeaderValue> = csv
                .split(',')
                .filter_map(|s| {
                    let t = s.trim();
                    if t.is_empty() { None } else { axum::http::HeaderValue::from_str(t).ok() }
                })
                .collect();
            tracing::info!(
                "🛡  RPC CORS locked down to {} origin(s) via ZEBVIX_RPC_CORS_ORIGINS",
                origins.len()
            );
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods(Any)
                .allow_headers(Any)
        }
        // SECURITY (C-7): default CORS is locked to localhost ONLY.
        // Operators who want public CORS must opt in by setting
        // `ZEBVIX_RPC_CORS_ORIGINS` to a CSV of allowed origins, OR set
        // `ZEBVIX_RPC_CORS_ORIGINS=*` to explicitly request open CORS for
        // public RPC nodes (e.g. behind cloudflare). Wildcard is REJECTED
        // when credentials are used by the browser, so prefer an explicit
        // allow-list whenever possible.
        Ok(s) if s.trim() == "*" => {
            tracing::warn!(
                "🛡  RPC CORS: open (Any) — explicitly enabled by ZEBVIX_RPC_CORS_ORIGINS=*"
            );
            CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)
        }
        _ => {
            let origins: Vec<axum::http::HeaderValue> = vec![
                "http://localhost",
                "http://127.0.0.1",
                "http://localhost:5173",
                "http://localhost:3000",
                "http://localhost:8080",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:8080",
            ]
            .into_iter()
            .filter_map(|s| axum::http::HeaderValue::from_str(s).ok())
            .collect();
            tracing::info!(
                "🛡  RPC CORS: localhost-only (default). Set ZEBVIX_RPC_CORS_ORIGINS=<csv> \
                 to add public origins, or ZEBVIX_RPC_CORS_ORIGINS=* to allow any."
            );
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods(Any)
                .allow_headers(Any)
        }
    };

    let body_limit = axum::extract::DefaultBodyLimit::max(256 * 1024);

    Router::new()
        .route("/", post(handle))
        // ── D4 — Prometheus scrape endpoint ──
        // Mounted on the existing RPC port instead of a separate :9090
        // listener (per HARDENING_TODO §D4 implementation note): avoids
        // a new CLI flag / port-binding race with future operators, and
        // keeps the scrape contract identical for Prometheus. Operators
        // who want isolation can put nginx in front and rewrite scrape
        // traffic to a dedicated `/metrics` path on a separate hostname.
        // Returns Prometheus text exposition format v0.0.4. No state is
        // captured by closure — handler reads from the static
        // `metrics::METRICS` singleton.
        .route("/metrics", get(metrics_handler))
        .layer(body_limit)
        .with_state(ctx)
        // ── F006.5/H1 — Concurrency-cap middleware ──
        // Layered AFTER `with_state` so it wraps the state-bound router.
        // Layer order (outermost first): cors → concurrency_limit →
        // body_limit → handler. Concurrency check fires BEFORE body
        // parsing (rejects 503 without reading payload bytes) but AFTER
        // CORS preflight (preflight OPTIONS responses do not consume
        // semaphore permits — they're cheap browser handshakes that
        // should never starve us out of capacity).
        .layer(axum::middleware::from_fn(rpc_concurrency_limit_middleware))
        .layer(cors)
}

/// Prometheus scrape handler. Always returns 200 + text/plain. The
/// underlying registry is in-memory and never errors, so this handler
/// has no failure path other than process death.
async fn metrics_handler() -> impl axum::response::IntoResponse {
    let body = crate::metrics::METRICS.render();
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}
