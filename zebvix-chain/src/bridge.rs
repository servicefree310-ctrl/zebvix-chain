//! Phase B.12 — Cross-chain bridge module.
//!
//! Implements a minimal **lock-and-mint / burn-and-release** bridge primitive
//! with an **admin-extensible registry** of networks (BSC, Ethereum, Polygon,
//! …) and per-network asset mappings (e.g. ZBX ↔ BEP-20 wZBX on BSC).
//!
//! ## Trust model (MVP)
//! The chain itself only does:
//! 1. **BridgeOut** — user locks ZBX / zUSD on Zebvix → emits a sequenced
//!    [`BridgeOutEvent`] containing the destination address on the foreign
//!    chain. An off-chain oracle (admin) reads these events and mints the
//!    wrapped token on the destination chain.
//! 2. **BridgeIn** — admin proves a foreign-chain deposit happened by
//!    submitting `BridgeIn { source_tx_hash }`. The chain credits the
//!    recipient with the equivalent native amount, marking the source hash
//!    as **claimed** so it cannot be replayed.
//!
//! This is a **single-trusted-oracle** model (admin = oracle). A future
//! upgrade can replace `BridgeIn` admin-auth with a multisig oracle or
//! light-client proof without breaking the registry.
//!
//! ## State storage (CF_META key prefixes)
//! - `b/n/<be4 network_id>` → bincode([`BridgeNetwork`])
//! - `b/a/<be8 asset_id>`   → bincode([`BridgeAsset`])
//! - `b/c/<32B src_tx>`     → 1-byte marker (claim used)
//! - `b/e/<be8 seq>`        → bincode([`BridgeOutEvent`]) (capped, oldest evicted)
//! - `b/m/seq`              → next outbound event seq (be8)
//! - `b/m/lz`               → total ZBX wei locked (be16, u128)
//! - `b/m/lu`               → total zUSD micro-units locked (be16, u128)
//! - `b/m/aid/<be4 net_id>` → next local asset id seq for that network (be4)
//!
//! ## Asset id encoding
//! `asset_id: u64` = `(network_id as u64) << 32 | local_seq as u64`. This makes
//! it trivial to derive the network from any asset_id and gives each network
//! its own independent 32-bit id space.

use crate::types::Address;
use serde::{Deserialize, Serialize};

/// Maximum number of recent outbound events kept on-chain (older ones evicted).
/// Off-chain oracles are expected to poll faster than this can roll over.
pub const MAX_OUT_EVENTS: u64 = 4096;

/// Maximum length of a destination address string (foreign chain). EVM = 42
/// (`0x` + 40), Solana = 44, Bitcoin bech32 = up to ~62. We allow up to 128
/// to be safe for future chains.
pub const MAX_DEST_ADDR_LEN: usize = 128;

/// Maximum length of a network name (e.g. "BSC", "Ethereum-Mainnet").
pub const MAX_NETWORK_NAME_LEN: usize = 32;

/// Maximum length of an external token contract identifier.
pub const MAX_CONTRACT_LEN: usize = 128;

/// Foreign network kinds. EVM covers BSC/Ethereum/Polygon/Avalanche/etc.
/// Variant order is **consensus-critical** (bincode encodes as u32 LE tag).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NetworkKind {
    /// EVM-compatible chains (BSC, Ethereum, Polygon, Arbitrum, …).
    Evm,
    /// Reserved for future non-EVM chains (Solana, Cosmos, Bitcoin).
    Other,
}

/// Native Zebvix assets eligible for bridging.
/// Variant order is **consensus-critical**.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NativeAsset {
    /// ZBX (18 decimals, in wei). Locked from `account.balance`.
    Zbx,
    /// zUSD (6 decimals, in micro-units). Locked from `account.zusd`.
    Zusd,
}

impl NativeAsset {
    pub fn symbol(&self) -> &'static str {
        match self {
            NativeAsset::Zbx => "ZBX",
            NativeAsset::Zusd => "zUSD",
        }
    }
    pub fn decimals(&self) -> u8 {
        match self {
            NativeAsset::Zbx => 18,
            NativeAsset::Zusd => 6,
        }
    }
}

/// A foreign network registered by the admin. Becomes a destination /
/// source for bridging once `active = true`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BridgeNetwork {
    /// Foreign chain id (e.g. 56 for BSC, 1 for Ethereum, 137 for Polygon).
    pub id: u32,
    /// Human-readable name (≤ [`MAX_NETWORK_NAME_LEN`] bytes).
    pub name: String,
    /// Network kind (EVM / Other).
    pub kind: NetworkKind,
    /// If false, all bridge ops referencing this network are rejected.
    pub active: bool,
    /// Block height at which this network was registered.
    pub registered_height: u64,
}

/// A per-network asset mapping — e.g. "ZBX on BSC = BEP-20 contract 0xABC…".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BridgeAsset {
    /// Globally-unique asset id: `(network_id << 32) | local_seq`.
    pub asset_id: u64,
    /// Foreign network this mapping belongs to.
    pub network_id: u32,
    /// Native Zebvix asset being wrapped on the foreign chain.
    pub native: NativeAsset,
    /// Foreign-chain contract / token identifier
    /// (BEP-20 / ERC-20 0x… address for EVM chains).
    pub contract: String,
    /// Decimals of the wrapped token on the foreign chain. The chain stores
    /// the value but does NOT scale amounts — both sides must agree (off-chain
    /// oracle is expected to mint the correct number of decimals; users
    /// always see Zebvix-native units in `body.amount`).
    pub decimals: u8,
    /// If false, BridgeOut/BridgeIn for this asset are rejected.
    pub active: bool,
    /// Block height at which this asset was registered.
    pub registered_height: u64,
}

impl BridgeAsset {
    /// Compose an asset id from `(network_id, local_seq)`.
    pub fn make_id(network_id: u32, local_seq: u32) -> u64 {
        ((network_id as u64) << 32) | (local_seq as u64)
    }
    /// Extract the network id from an asset id.
    pub fn network_id_of(asset_id: u64) -> u32 {
        (asset_id >> 32) as u32
    }
    /// Extract the local sequence from an asset id.
    pub fn local_seq_of(asset_id: u64) -> u32 {
        (asset_id & 0xFFFF_FFFF) as u32
    }
}

/// On-chain bridge operations. Carried by [`crate::transaction::TxKind::Bridge`].
/// Variant order is **consensus-critical** (bincode encodes as u32 LE tag).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BridgeOp {
    /// **Admin only.** Add a new foreign network to the registry.
    /// Rejected if `id` already exists.
    RegisterNetwork {
        id: u32,
        name: String,
        kind: NetworkKind,
    },
    /// **Admin only.** Enable / disable an existing network.
    SetNetworkActive { id: u32, active: bool },
    /// **Admin only.** Map a native Zebvix asset to a foreign-chain token.
    /// Allocates a fresh `asset_id`. Rejected if the network doesn't exist.
    RegisterAsset {
        network_id: u32,
        native: NativeAsset,
        contract: String,
        decimals: u8,
    },
    /// **Admin only.** Enable / disable a specific asset mapping.
    SetAssetActive { asset_id: u64, active: bool },
    /// **User.** Lock `body.amount` of `asset_id`'s native token on Zebvix
    /// and emit a [`BridgeOutEvent`]. Off-chain oracle picks this up and
    /// mints the wrapped token on the foreign chain to `dest_address`.
    BridgeOut { asset_id: u64, dest_address: String },
    /// **Admin only (oracle role).** Credit `recipient` with `amount` of
    /// `asset_id`'s native token, proving the foreign chain received a
    /// matching deposit identified by `source_tx_hash`. Replay-protected:
    /// each `source_tx_hash` may only be claimed once, ever.
    BridgeIn {
        asset_id: u64,
        source_tx_hash: [u8; 32],
        recipient: Address,
        amount: u128,
    },
}

/// On-chain record of a user's BridgeOut. Off-chain oracles poll
/// `zbx_recentBridgeOutEvents` to discover work.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BridgeOutEvent {
    /// Monotonically increasing sequence number (assigned at apply time).
    pub seq: u64,
    /// Asset being bridged out.
    pub asset_id: u64,
    /// Native asset symbol (cached for convenience — derivable from asset_id).
    pub native_symbol: String,
    /// Sender on Zebvix.
    pub from: Address,
    /// Destination address on the foreign chain (string form).
    pub dest_address: String,
    /// Locked amount in Zebvix-native units (wei for ZBX, micro for zUSD).
    pub amount: u128,
    /// Block height at which the lock was committed.
    pub height: u64,
    /// Unix-seconds timestamp of the block.
    pub ts: i64,
    /// Hash of the originating Zebvix transaction (for traceability).
    pub tx_hash: [u8; 32],
}

/// Aggregate stats returned by `zbx_bridgeStats`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeStats {
    pub networks_count: u64,
    pub assets_count: u64,
    pub locked_zbx: u128,
    pub locked_zusd: u128,
    pub out_events_total: u64,
    pub claims_used: u64,
}

// ─── Validation helpers (used by both apply_tx and CLI sanity checks) ───

pub fn validate_network_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("network name must not be empty".into());
    }
    if n.len() > MAX_NETWORK_NAME_LEN {
        return Err(format!(
            "network name too long ({} > {})",
            n.len(),
            MAX_NETWORK_NAME_LEN
        ));
    }
    if !n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ')
    {
        return Err("network name may only contain a-z A-Z 0-9 - _ space".into());
    }
    Ok(())
}

pub fn validate_contract(contract: &str, kind: NetworkKind) -> Result<(), String> {
    let c = contract.trim();
    if c.is_empty() {
        return Err("contract identifier must not be empty".into());
    }
    if c.len() > MAX_CONTRACT_LEN {
        return Err(format!(
            "contract too long ({} > {})",
            c.len(),
            MAX_CONTRACT_LEN
        ));
    }
    if matches!(kind, NetworkKind::Evm) {
        // EVM contract = 0x + 40 hex chars (20-byte address).
        let lower = c.to_ascii_lowercase();
        let stripped = lower.strip_prefix("0x").unwrap_or(&lower);
        if stripped.len() != 40 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "EVM contract must be 0x + 40 hex chars (got {} chars)",
                c.len()
            ));
        }
    }
    Ok(())
}

pub fn validate_dest_address(addr: &str, kind: NetworkKind) -> Result<(), String> {
    let a = addr.trim();
    if a.is_empty() {
        return Err("destination address must not be empty".into());
    }
    if a.len() > MAX_DEST_ADDR_LEN {
        return Err(format!(
            "destination address too long ({} > {})",
            a.len(),
            MAX_DEST_ADDR_LEN
        ));
    }
    if matches!(kind, NetworkKind::Evm) {
        let lower = a.to_ascii_lowercase();
        let stripped = lower.strip_prefix("0x").unwrap_or(&lower);
        if stripped.len() != 40 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "EVM destination address must be 0x + 40 hex chars (got {} chars)",
                a.len()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_id_roundtrip() {
        for (net, seq) in [(56u32, 0u32), (1, 7), (137, 999), (u32::MAX, u32::MAX)] {
            let id = BridgeAsset::make_id(net, seq);
            assert_eq!(BridgeAsset::network_id_of(id), net);
            assert_eq!(BridgeAsset::local_seq_of(id), seq);
        }
    }

    #[test]
    fn validate_evm_contract_ok() {
        validate_contract(
            "0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            NetworkKind::Evm,
        )
        .unwrap();
    }

    #[test]
    fn validate_evm_contract_bad_len() {
        assert!(validate_contract("0xBB4C", NetworkKind::Evm).is_err());
    }

    #[test]
    fn validate_evm_contract_bad_hex() {
        assert!(validate_contract(
            "0xZZZZdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            NetworkKind::Evm
        )
        .is_err());
    }

    #[test]
    fn validate_dest_addr_ok() {
        validate_dest_address(
            "0xAabbccDDeeff0011223344556677889900aabbcc",
            NetworkKind::Evm,
        )
        .unwrap();
    }

    #[test]
    fn validate_network_name_rules() {
        validate_network_name("BSC").unwrap();
        validate_network_name("Ethereum-Mainnet").unwrap();
        validate_network_name("polygon_zkevm").unwrap();
        assert!(validate_network_name("").is_err());
        assert!(validate_network_name("bad/name").is_err());
        assert!(validate_network_name(&"x".repeat(MAX_NETWORK_NAME_LEN + 1)).is_err());
    }
}
