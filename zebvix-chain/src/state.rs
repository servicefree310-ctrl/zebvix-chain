//! Persistent state: balances, nonces, blocks. Backed by RocksDB.

use crate::crypto::{block_hash, header_signing_bytes, tx_hash, verify_signature, verify_tx, verify_txs_batch};
use crate::pool::Pool;
use crate::tokenomics::{
    reward_at_height, ADMIN_ADDRESS_HEX, BOOTSTRAP_DEL_THRESHOLD, BOOTSTRAP_VAL_THRESHOLD,
    BURN_ADDRESS_HEX, BURN_CAP_WEI, GAS_FEE_DELEGATORS_BPS,
    GAS_FEE_TREASURY_BPS, GAS_FEE_VALIDATOR_BPS, GENESIS_POOL_ZBX_WEI, GENESIS_POOL_ZUSD_LOAN,
    GOVERNOR_ADDRESS_HEX, MAX_ADMIN_CHANGES, MAX_GOVERNOR_CHANGES, POOL_ADDRESS_HEX,
    TREASURY_ADDRESS_HEX, TREASURY_CUT_BPS_PHASE_A, TREASURY_CUT_BPS_PHASE_B,
};
use crate::types::{Address, Block, Hash, SignedTx, Validator};
use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use rocksdb::{ColumnFamilyDescriptor, Options, DB};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

const CF_ACCOUNTS: &str = "accounts";
const CF_BLOCKS: &str = "blocks";
const CF_META: &str = "meta";

const META_HEIGHT: &[u8] = b"height";
const META_LAST_HASH: &[u8] = b"last_hash";
const META_POOL: &[u8] = b"pool";
const META_LP_PREFIX: &[u8] = b"lp/";
const META_ADMIN: &[u8] = b"admin";              // 20-byte current admin address (override)
const META_ADMIN_CHANGES: &[u8] = b"admin_changes"; // u8 count of rotations performed
// Phase B.3.2 — governor role (validator-set authority, separated from admin).
const META_GOVERNOR: &[u8] = b"governor";              // 20-byte current governor (override)
const META_GOVERNOR_CHANGES: &[u8] = b"governor_changes"; // u8 rotation counter
// Phase B.1: validator set storage. Each validator is keyed by `validator/<20-byte-addr>`
// in CF_META and contains a bincode-serialized `Validator`.
const META_VALIDATOR_PREFIX: &[u8] = b"validator/";
// Phase B.4: staking module — single bincode blob (entire StakingModule).
const META_STAKING: &[u8] = b"staking";
// Phase B.7: Pay-ID registry. Forward index: payid → 20-byte address.
// Reverse index: address → bincode (pay_id, name).
const META_PAYID_PREFIX: &[u8] = b"payid/";
const META_PAYID_ADDR_PREFIX: &[u8] = b"payid_addr/";
// Phase B.8: multisig wallets.
//   - `ms/<addr20>`              → bincode(MultisigAccount)
//   - `mspr/<addr20><id_be8>`    → bincode(MultisigProposal)
//   - `mso/<owner20><addr20>`    → 1-byte marker (owner→multisig index)
const META_MS_PREFIX: &[u8] = b"ms/";
const META_MS_PROPOSAL_PREFIX: &[u8] = b"mspr/";
const META_MS_OWNER_PREFIX: &[u8] = b"mso/";

// Phase B.9 — Recent-Tx index. Maintained automatically by `apply_block` so
// dashboards/wallets can fetch the last N transactions in O(1) per record
// instead of scanning thousands of blocks.
//   - `rtx/<seq_be8>`            → bincode(RecentTxRecord)  (the entry)
//   - `rtx_seq`                  → u64 BE next-seq counter (monotonic)
// Ring eviction: when seq >= RECENT_TX_CAP, the entry at `seq - CAP` is
// deleted so total stored entries are bounded by CAP.
const META_RTX_PREFIX: &[u8] = b"rtx/";
const META_RTX_SEQ: &[u8] = b"rtx_seq";
// Phase C.2.1 — Secondary index `tx_hash → seq` so `eth_getTransactionByHash`
// and `eth_getTransactionReceipt` can resolve a 32-byte hash to its
// `RecentTxRecord` in one point lookup instead of a 1000-entry linear scan.
// Maintained alongside the primary `rtx/<seq>` index by `push_recent_tx` and
// cleared in lockstep on ring eviction. Falls back to linear scan in
// `find_tx_by_hash` for legacy entries written before this index existed.
const META_RTX_HASH_PREFIX: &[u8] = b"rtx/h/";

// ── Security Hardening — crash-safety marker for apply_block ──
// Set BEFORE any state mutation in apply_block, cleared AFTER block header
// is committed. On startup, if this key is present and tip equals the
// height stored here, the node refuses to start so the operator can
// investigate (we cannot guarantee partial-write recovery without a real
// WriteBatch refactor — this marker turns silent corruption into loud
// failure). Stored as 8-byte BE height followed by 32-byte block hash.
const META_BLOCK_APPLYING: &[u8] = b"block_applying";

// ── Phase E — User-creatable fungible tokens ──
// Layout (all under CF_META):
//   tok_count                    → u64 BE next-token-id (1-based)
//   tok/<id_be8>                 → bincode(TokenInfo)
//   tokb/<id_be8><addr20>        → 16-byte u128 BE balance
//   toks/<symbol_lc>             → 8-byte u64 BE token_id (uniqueness index)
//
// SECURITY: keys are isolated by prefix so they cannot collide with any
// existing meta-key. Tokens never share storage with native ZBX balances.
const META_TOKEN_COUNT: &[u8] = b"tok_count";
const META_TOKEN_PREFIX: &[u8] = b"tok/";
const META_TOKEN_BAL_PREFIX: &[u8] = b"tokb/";
const META_TOKEN_SYMBOL_PREFIX: &[u8] = b"toks/";

// ── Phase B.3.3 — slashing evidence log (non-consensus / informational) ──
// Evidence is recorded out-of-band when a node detects a double-sign vote.
// It is EXCLUDED from `compute_state_root` because evidence-detection timing
// is not deterministic across validators (a slow node may record evidence
// at a different block height than a fast one). The actual slashing of stake
// IS deterministic (applied via `staking.slash_double_sign` and persisted to
// META_STAKING which IS in the state root). Evidence is the audit log only.
const META_EVIDENCE_PREFIX: &[u8] = b"evid/";
const META_EVIDENCE_SEQ: &[u8] = b"evid_seq";
/// Maximum number of recent transactions retained on-chain (rolling window).
pub const RECENT_TX_CAP: u64 = 1000;

/// Validate a Pay-ID string. Returns the lowercased canonical form.
/// Rules: must end with `@zbx`; the handle (before `@zbx`) must be 3-25 chars,
/// `[a-z0-9_]` only.
pub fn validate_payid(raw: &str) -> Result<String> {
    let lc = raw.trim().to_lowercase();
    if !lc.ends_with("@zbx") {
        return Err(anyhow!("pay-id must end with '@zbx'"));
    }
    let handle = &lc[..lc.len() - 4];
    let n = handle.chars().count();
    if n < 3 || n > 25 {
        return Err(anyhow!("pay-id handle length must be 3-25 chars (got {})", n));
    }
    if !handle.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
        return Err(anyhow!("pay-id handle may only contain a-z, 0-9, underscore"));
    }
    Ok(lc)
}

/// Validate the display name. Required, 1-50 chars, no control chars.
pub fn validate_payid_name(raw: &str) -> Result<String> {
    let s = raw.trim().to_string();
    if s.is_empty() {
        return Err(anyhow!("name is mandatory"));
    }
    let n = s.chars().count();
    if n > 50 {
        return Err(anyhow!("name too long (max 50 chars, got {})", n));
    }
    if s.chars().any(|c| c.is_control()) {
        return Err(anyhow!("name must not contain control characters"));
    }
    Ok(s)
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Account {
    pub balance: u128,
    pub nonce: u64,
    #[serde(default)]
    pub zusd: u128,
}

/// Phase B.9 — A compact, self-describing summary of an applied transaction
/// stored in the on-chain recent-tx ring buffer. Every field is stable wire
/// format: dashboards / mobile clients can decode this without needing to
/// fetch and re-parse full blocks.
///
/// `kind_index` matches the bincode discriminator order of `TxKind`
/// (0=Transfer, 1=ValidatorAdd, 2=ValidatorRemove, 3=ValidatorEdit,
/// 4=GovernorChange, 5=Staking, 6=RegisterPayId, 7=Multisig). Keep this
/// table in sync with `TxKind::tag_index()`.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RecentTxRecord {
    /// Monotonic sequence number assigned at insertion. Newer = larger.
    pub seq: u64,
    /// Block height in which this tx was committed.
    pub height: u64,
    /// Block timestamp (ms since epoch) — same value for all txs in a block.
    pub timestamp_ms: u64,
    /// 32-byte tx hash (Keccak256 of bincode(TxBody) — see `crypto::tx_hash`).
    pub hash: [u8; 32],
    pub from: Address,
    pub to: Address,
    pub amount: u128,
    pub fee: u128,
    pub nonce: u64,
    pub kind_index: u32,
}

pub struct State {
    db: Arc<DB>,
    tip: RwLock<(u64, Hash)>,
    /// Phase B.12 — block timestamp (ms since epoch) of the block currently
    /// being applied. Set at the top of `apply_block`, read by `apply_tx`
    /// inside the Bridge arm to stamp `BridgeOutEvent.ts` deterministically.
    /// Defaults to 0 outside of `apply_block`.
    current_block_ts_ms: AtomicU64,
}

/// Parse the pool's magic address (constant — no private key).
pub fn pool_address() -> Address {
    Address::from_hex(POOL_ADDRESS_HEX).expect("POOL_ADDRESS_HEX is valid")
}

/// Parse the **default genesis** admin/founder address (compile-time constant).
/// NOTE: this is only the bootstrap value. The live, possibly-rotated admin
/// address is read from State via `State::current_admin()`.
pub fn admin_address() -> Address {
    Address::from_hex(ADMIN_ADDRESS_HEX).expect("ADMIN_ADDRESS_HEX is valid")
}

/// Parse the **default genesis** governor address (compile-time constant).
/// Live (possibly-rotated) governor is read via `State::current_governor()`.
pub fn governor_address() -> Address {
    Address::from_hex(GOVERNOR_ADDRESS_HEX).expect("GOVERNOR_ADDRESS_HEX is valid")
}

/// Phase B.5 — burn sink address.
pub fn burn_address() -> Address {
    Address::from_hex(BURN_ADDRESS_HEX).expect("BURN_ADDRESS_HEX is valid")
}

/// Phase B.5 — founder treasury address.
pub fn treasury_address() -> Address {
    Address::from_hex(TREASURY_ADDRESS_HEX).expect("TREASURY_ADDRESS_HEX is valid")
}

/// Phase B.6 — magic holding address that accumulates per-block mint reward
/// between distribution events. No private key exists.
pub fn rewards_pool_address() -> Address {
    Address::from_hex(crate::tokenomics::REWARDS_POOL_ADDRESS_HEX)
        .expect("REWARDS_POOL_ADDRESS_HEX is valid")
}

impl State {
    pub fn open(path: &Path) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        let cfs = vec![
            ColumnFamilyDescriptor::new(CF_ACCOUNTS, Options::default()),
            ColumnFamilyDescriptor::new(CF_BLOCKS, Options::default()),
            ColumnFamilyDescriptor::new(CF_META, Options::default()),
        ];
        let db = DB::open_cf_descriptors(&opts, path, cfs)?;
        let height = db
            .get_cf(db.cf_handle(CF_META).unwrap(), META_HEIGHT)?
            .map(|b| { let mut a = [0u8; 8]; a.copy_from_slice(&b); u64::from_be_bytes(a) })
            .unwrap_or(0);
        let last = db
            .get_cf(db.cf_handle(CF_META).unwrap(), META_LAST_HASH)?
            .map(|b| { let mut a = [0u8; 32]; a.copy_from_slice(&b); Hash(a) })
            .unwrap_or(Hash::ZERO);
        Ok(Self {
            db: Arc::new(db),
            tip: RwLock::new((height, last)),
            current_block_ts_ms: AtomicU64::new(0),
        })
    }

    pub fn tip(&self) -> (u64, Hash) { *self.tip.read() }

    /// Phase C.2 — expose the raw RocksDB handle so the EVM layer
    /// (`zvm_state::CfZvmDb`) can be constructed against the same database.
    /// Used by `rpc.rs` to wire `eth_*` JSON-RPC methods through to the
    /// EVM dispatcher without duplicating storage state.
    #[cfg(feature = "zvm")]
    pub fn raw_db(&self) -> Arc<DB> {
        self.db.clone()
    }

    pub fn account(&self, a: &Address) -> Account {
        let cf = self.db.cf_handle(CF_ACCOUNTS).unwrap();
        match self.db.get_cf(cf, a.0).ok().flatten() {
            Some(b) => bincode::deserialize(&b).unwrap_or_default(),
            None => Account::default(),
        }
    }

    pub fn balance(&self, a: &Address) -> u128 { self.account(a).balance }
    pub fn nonce(&self, a: &Address) -> u64 { self.account(a).nonce }

    // ───────── Admin rotation (max MAX_ADMIN_CHANGES) ─────────

    /// Returns the **live** admin address. If the admin has been rotated, returns
    /// the override stored in DB; otherwise returns the genesis default.
    pub fn current_admin(&self) -> Address {
        let cf = self.db.cf_handle(CF_META).unwrap();
        match self.db.get_cf(cf, META_ADMIN).ok().flatten() {
            Some(b) if b.len() == 20 => {
                let mut a = [0u8; 20];
                a.copy_from_slice(&b);
                Address(a)
            }
            _ => admin_address(),
        }
    }

    /// Number of admin rotations performed so far (0..=MAX_ADMIN_CHANGES).
    pub fn admin_change_count(&self) -> u8 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, META_ADMIN_CHANGES).ok().flatten()
            .and_then(|b| b.first().copied())
            .unwrap_or(0)
    }

    /// Remaining admin rotations available.
    pub fn admin_changes_remaining(&self) -> u8 {
        MAX_ADMIN_CHANGES.saturating_sub(self.admin_change_count())
    }

    /// Rotate the admin address. Must be called with `signer` == current admin.
    /// Increments `admin_change_count`. Fails after MAX_ADMIN_CHANGES rotations.
    pub fn change_admin(&self, signer: &Address, new_admin: &Address) -> Result<u8> {
        let current = self.current_admin();
        if signer != &current {
            return Err(anyhow!("only current admin {} can rotate (got signer {})",
                current, signer));
        }
        if new_admin == &current {
            return Err(anyhow!("new admin is same as current — no-op"));
        }
        let count = self.admin_change_count();
        if count >= MAX_ADMIN_CHANGES {
            return Err(anyhow!("admin change limit reached: {} of {} rotations used (locked)",
                count, MAX_ADMIN_CHANGES));
        }
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, META_ADMIN, &new_admin.0)?;
        let new_count = count + 1;
        self.db.put_cf(cf, META_ADMIN_CHANGES, [new_count])?;
        Ok(new_count)
    }

    // ───────── Governor rotation (validator-set authority) ─────────

    /// Returns the **live** governor address (rotated override or genesis default).
    pub fn current_governor(&self) -> Address {
        let cf = self.db.cf_handle(CF_META).unwrap();
        match self.db.get_cf(cf, META_GOVERNOR).ok().flatten() {
            Some(b) if b.len() == 20 => {
                let mut a = [0u8; 20];
                a.copy_from_slice(&b);
                Address(a)
            }
            _ => governor_address(),
        }
    }

    pub fn governor_change_count(&self) -> u8 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, META_GOVERNOR_CHANGES).ok().flatten()
            .and_then(|b| b.first().copied())
            .unwrap_or(0)
    }

    pub fn governor_changes_remaining(&self) -> u8 {
        MAX_GOVERNOR_CHANGES.saturating_sub(self.governor_change_count())
    }

    /// Rotate the governor. Must be signed by the current governor.
    /// Capped at `MAX_GOVERNOR_CHANGES`.
    pub fn change_governor(&self, signer: &Address, new_governor: &Address) -> Result<u8> {
        let current = self.current_governor();
        if signer != &current {
            return Err(anyhow!(
                "only current governor {} can rotate (got signer {})", current, signer
            ));
        }
        if new_governor == &current {
            return Err(anyhow!("new governor is same as current — no-op"));
        }
        let count = self.governor_change_count();
        if count >= MAX_GOVERNOR_CHANGES {
            return Err(anyhow!(
                "governor change limit reached: {} of {} rotations used (locked)",
                count, MAX_GOVERNOR_CHANGES
            ));
        }
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, META_GOVERNOR, &new_governor.0)?;
        let new_count = count + 1;
        self.db.put_cf(cf, META_GOVERNOR_CHANGES, [new_count])?;
        Ok(new_count)
    }

    // ───────── Staking module persistence (Phase B.4) ─────────

    /// Load the staking module blob (or default if uninitialized).
    pub fn staking(&self) -> crate::staking::StakingModule {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, META_STAKING).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
            .unwrap_or_default()
    }

    /// Persist the staking module blob.
    pub fn put_staking(&self, s: &crate::staking::StakingModule) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, META_STAKING, bincode::serialize(s)?)?;
        Ok(())
    }

    fn put_account(&self, a: &Address, acc: &Account) -> Result<()> {
        let cf = self.db.cf_handle(CF_ACCOUNTS).unwrap();
        self.db.put_cf(cf, a.0, bincode::serialize(acc)?)?;
        Ok(())
    }

    // ───────── Phase B.12 — bridge state helpers (CF_META prefixes) ─────────

    fn br_net_key(id: u32) -> Vec<u8> {
        let mut k = b"b/n/".to_vec();
        k.extend_from_slice(&id.to_be_bytes());
        k
    }
    fn br_asset_key(id: u64) -> Vec<u8> {
        let mut k = b"b/a/".to_vec();
        k.extend_from_slice(&id.to_be_bytes());
        k
    }
    fn br_claim_key(h: &[u8; 32]) -> Vec<u8> {
        let mut k = b"b/c/".to_vec();
        k.extend_from_slice(h);
        k
    }
    fn br_event_key(seq: u64) -> Vec<u8> {
        let mut k = b"b/e/".to_vec();
        k.extend_from_slice(&seq.to_be_bytes());
        k
    }
    fn br_aid_key(network_id: u32) -> Vec<u8> {
        let mut k = b"b/m/aid/".to_vec();
        k.extend_from_slice(&network_id.to_be_bytes());
        k
    }
    const BR_META_SEQ: &'static [u8]      = b"b/m/seq";
    const BR_META_LOCKED_ZBX: &'static [u8]  = b"b/m/lz";
    const BR_META_LOCKED_ZUSD: &'static [u8] = b"b/m/lu";
    const BR_META_CLAIMS_USED: &'static [u8] = b"b/m/cu";

    pub fn bridge_get_network(&self, id: u32) -> Option<crate::bridge::BridgeNetwork> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::br_net_key(id)).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
    }
    pub fn bridge_put_network(&self, n: &crate::bridge::BridgeNetwork) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::br_net_key(n.id), bincode::serialize(n)?)?;
        Ok(())
    }
    pub fn bridge_list_networks(&self) -> Vec<crate::bridge::BridgeNetwork> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut out = Vec::new();
        let prefix: &[u8] = b"b/n/";
        let it = self.db.prefix_iterator_cf(cf, prefix);
        for item in it {
            if let Ok((k, v)) = item {
                if !k.starts_with(prefix) { break; }
                if let Ok(n) = bincode::deserialize::<crate::bridge::BridgeNetwork>(&v) {
                    out.push(n);
                }
            }
        }
        out.sort_by_key(|n| n.id);
        out
    }

    pub fn bridge_get_asset(&self, asset_id: u64) -> Option<crate::bridge::BridgeAsset> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::br_asset_key(asset_id)).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
    }
    pub fn bridge_put_asset(&self, a: &crate::bridge::BridgeAsset) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::br_asset_key(a.asset_id), bincode::serialize(a)?)?;
        Ok(())
    }
    pub fn bridge_list_assets(&self) -> Vec<crate::bridge::BridgeAsset> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut out = Vec::new();
        let prefix: &[u8] = b"b/a/";
        let it = self.db.prefix_iterator_cf(cf, prefix);
        for item in it {
            if let Ok((k, v)) = item {
                if !k.starts_with(prefix) { break; }
                if let Ok(a) = bincode::deserialize::<crate::bridge::BridgeAsset>(&v) {
                    out.push(a);
                }
            }
        }
        out.sort_by_key(|a| a.asset_id);
        out
    }

    pub fn bridge_next_local_asset_seq(&self, network_id: u32) -> Result<u32> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let key = Self::br_aid_key(network_id);
        let cur = self.db.get_cf(cf, &key).ok().flatten()
            .and_then(|b| <[u8;4]>::try_from(b.as_slice()).ok().map(u32::from_be_bytes))
            .unwrap_or(0);
        let next = cur.checked_add(1).ok_or_else(|| anyhow!("asset seq overflow"))?;
        self.db.put_cf(cf, &key, next.to_be_bytes())?;
        Ok(cur)
    }

    pub fn bridge_is_claim_used(&self, h: &[u8; 32]) -> bool {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::br_claim_key(h)).ok().flatten().is_some()
    }
    pub fn bridge_mark_claim(&self, h: &[u8; 32]) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::br_claim_key(h), [1u8])?;
        let cur = self.db.get_cf(cf, Self::BR_META_CLAIMS_USED).ok().flatten()
            .and_then(|b| <[u8;8]>::try_from(b.as_slice()).ok().map(u64::from_be_bytes))
            .unwrap_or(0);
        self.db.put_cf(cf, Self::BR_META_CLAIMS_USED, (cur + 1).to_be_bytes())?;
        Ok(())
    }
    pub fn bridge_claims_used(&self) -> u64 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::BR_META_CLAIMS_USED).ok().flatten()
            .and_then(|b| <[u8;8]>::try_from(b.as_slice()).ok().map(u64::from_be_bytes))
            .unwrap_or(0)
    }

    pub fn bridge_locked_zbx(&self) -> u128 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::BR_META_LOCKED_ZBX).ok().flatten()
            .and_then(|b| <[u8;16]>::try_from(b.as_slice()).ok().map(u128::from_be_bytes))
            .unwrap_or(0)
    }
    pub fn bridge_locked_zusd(&self) -> u128 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::BR_META_LOCKED_ZUSD).ok().flatten()
            .and_then(|b| <[u8;16]>::try_from(b.as_slice()).ok().map(u128::from_be_bytes))
            .unwrap_or(0)
    }
    fn bridge_set_locked(&self, native: crate::bridge::NativeAsset, val: u128) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let key: &[u8] = match native {
            crate::bridge::NativeAsset::Zbx  => Self::BR_META_LOCKED_ZBX,
            crate::bridge::NativeAsset::Zusd => Self::BR_META_LOCKED_ZUSD,
        };
        self.db.put_cf(cf, key, val.to_be_bytes())?;
        Ok(())
    }

    fn bridge_next_event_seq(&self) -> Result<u64> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let cur = self.db.get_cf(cf, Self::BR_META_SEQ).ok().flatten()
            .and_then(|b| <[u8;8]>::try_from(b.as_slice()).ok().map(u64::from_be_bytes))
            .unwrap_or(0);
        self.db.put_cf(cf, Self::BR_META_SEQ, (cur + 1).to_be_bytes())?;
        Ok(cur)
    }
    pub fn bridge_total_out_events(&self) -> u64 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::BR_META_SEQ).ok().flatten()
            .and_then(|b| <[u8;8]>::try_from(b.as_slice()).ok().map(u64::from_be_bytes))
            .unwrap_or(0)
    }
    fn bridge_record_out_event(&self, ev: &crate::bridge::BridgeOutEvent) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::br_event_key(ev.seq), bincode::serialize(ev)?)?;
        // Cap on-chain history — evict oldest beyond MAX_OUT_EVENTS.
        let max = crate::bridge::MAX_OUT_EVENTS;
        if ev.seq >= max {
            let _ = self.db.delete_cf(cf, Self::br_event_key(ev.seq - max));
        }
        Ok(())
    }
    /// Most-recent N outbound bridge events, newest first.
    pub fn bridge_recent_out_events(&self, limit: usize) -> Vec<crate::bridge::BridgeOutEvent> {
        let total = self.bridge_total_out_events();
        if total == 0 { return Vec::new(); }
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut out = Vec::with_capacity(limit);
        let mut seq = total - 1;
        loop {
            if let Some(b) = self.db.get_cf(cf, Self::br_event_key(seq)).ok().flatten() {
                if let Ok(ev) = bincode::deserialize::<crate::bridge::BridgeOutEvent>(&b) {
                    out.push(ev);
                }
            }
            if out.len() >= limit || seq == 0 { break; }
            seq -= 1;
        }
        out
    }

    pub fn genesis_credit(&self, alloc: &[(Address, u128)]) -> Result<()> {
        for (addr, amount) in alloc {
            let mut acc = self.account(addr);
            acc.balance = acc.balance.saturating_add(*amount);
            self.put_account(addr, &acc)?;
        }
        Ok(())
    }

    /// Apply a single transaction. Dispatches by `tx.body.kind`:
    ///   - `Transfer`        → standard transfer, with POOL intercept (admin
    ///                         single-sided add OR auto-swap ZBX→zUSD)
    ///   - `ValidatorAdd`    → admin-only; updates on-chain validator registry
    ///   - `ValidatorRemove` → admin-only; deletes a validator (last-validator
    ///                         safety enforced)
    pub fn apply_tx(&self, tx: &SignedTx) -> Result<()> {
        // ── Dynamic USD-pegged fee bounds (consensus-enforced) ──
        // Compute (min_wei, max_wei) from the current AMM pool spot price so
        // every tx pays between $0.001 and $0.01 worth of ZBX. When the pool
        // is uninitialized (pre-genesis), falls back to fixed bootstrap window.
        // This is fully deterministic — every node reads the same on-chain pool
        // state at the same height/order.
        let pool = self.pool();
        let (min_fee_wei, max_fee_wei) = crate::pool::fee_bounds_wei(
            &pool,
            crate::tokenomics::MIN_FEE_USD_MICRO,
            crate::tokenomics::MAX_FEE_USD_MICRO,
            crate::tokenomics::BOOTSTRAP_MIN_FEE_WEI,
            crate::tokenomics::BOOTSTRAP_MAX_FEE_WEI,
        );
        if tx.body.fee < min_fee_wei {
            return Err(anyhow!(
                "fee too low: {} wei < dynamic min {} wei (≈ $0.001 at current ZBX price)",
                tx.body.fee, min_fee_wei
            ));
        }
        if tx.body.fee > max_fee_wei {
            return Err(anyhow!(
                "fee too high: {} wei > dynamic max {} wei (≈ $0.01 at current ZBX price) — \
                pass --fee auto to use the recommended value",
                tx.body.fee, max_fee_wei
            ));
        }
        let mut from = self.account(&tx.body.from);
        if from.nonce != tx.body.nonce {
            return Err(anyhow!("bad nonce: have {}, got {}", from.nonce, tx.body.nonce));
        }
        // Pre-dispatch debit. For most tx kinds `body.amount` is denominated
        // in ZBX wei and lives in `from.balance`, so we debit `amount + fee`
        // up-front and let the per-kind arm credit any output. Phase B.10
        // exception: a `Swap { ZusdToZbx }` carries `amount` in zUSD (NOT in
        // `balance`), so for that single case we must NOT pre-debit `amount`
        // from `balance` — only the ZBX `fee`. The Swap arm itself debits the
        // zUSD principal from `from.zusd` and handles its own refunds.
        let pre_debit = match &tx.body.kind {
            crate::types::TxKind::Swap {
                direction: crate::transaction::SwapDirection::ZusdToZbx, ..
            } => tx.body.fee,
            _ => tx.body.amount.checked_add(tx.body.fee)
                .ok_or_else(|| anyhow!("amount+fee overflow"))?,
        };
        if from.balance < pre_debit {
            return Err(anyhow!("insufficient balance"));
        }
        from.balance -= pre_debit;
        from.nonce += 1;

        let pool_addr = pool_address();
        let admin = self.current_admin();
        let governor = self.current_governor();

        // ── Phase B.3.2: validator governance txs (governor-only) ─────
        // Validator add / edit / remove and governor rotation are routed
        // exclusively through the **governor** key, which is a separate role
        // from the economic admin. This way, a compromise of the admin key
        // (which controls pool/swap fees) cannot rewrite the consensus
        // committee — and vice-versa.
        //
        // These txs only consume `fee`; `amount` is refunded so the governor
        // doesn't need to lock funds for governance ops. The block-reward
        // path still credits the proposer with collected fees.
        //
        // `refund` is a tiny helper closure that returns the `amount` to the
        // sender, persists `from`, and bubbles an error back to the caller.
        let refund = |from: &mut Account, msg: String| -> Result<()> {
            from.balance = from.balance.saturating_add(tx.body.amount);
            self.put_account(&tx.body.from, from)?;
            Err(anyhow!(msg))
        };

        match &tx.body.kind {
            crate::types::TxKind::ValidatorAdd { pubkey, power } => {
                if tx.body.from != governor {
                    return refund(&mut from, format!(
                        "validator-add: only current governor {} may submit", governor
                    ));
                }
                if *power == 0 {
                    return refund(&mut from, "validator-add: voting power must be > 0".into());
                }
                let v = crate::types::Validator::new(*pubkey, *power);
                if self.get_validator(&v.address).is_some() {
                    return refund(&mut from, format!(
                        "validator-add: {} already in set (use ValidatorEdit)", v.address
                    ));
                }
                self.put_validator(&v)?;
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                tracing::info!("⚙️  validator-add applied: {} power={}", v.address, v.voting_power);
                return Ok(());
            }
            crate::types::TxKind::ValidatorEdit { address, new_power } => {
                if tx.body.from != governor {
                    return refund(&mut from, format!(
                        "validator-edit: only current governor {} may submit", governor
                    ));
                }
                if *new_power == 0 {
                    return refund(&mut from,
                        "validator-edit: new_power must be > 0 (use ValidatorRemove to delete)".into());
                }
                let mut v = match self.get_validator(address) {
                    Some(v) => v,
                    None => return refund(&mut from, format!(
                        "validator-edit: {} not in set", address
                    )),
                };
                let old_power = v.voting_power;
                v.voting_power = *new_power;
                self.put_validator(&v)?;
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                tracing::info!(
                    "⚙️  validator-edit applied: {} power {} → {}",
                    address, old_power, new_power
                );
                return Ok(());
            }
            crate::types::TxKind::ValidatorRemove { address } => {
                if tx.body.from != governor {
                    return refund(&mut from, format!(
                        "validator-remove: only current governor {} may submit", governor
                    ));
                }
                let vs = self.validators();
                if vs.len() <= 1 && vs.iter().any(|v| v.address == *address) {
                    return refund(&mut from,
                        "validator-remove: refusing to remove last validator (chain would halt)".into());
                }
                let removed = self.remove_validator(address)?;
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                if removed {
                    tracing::info!("⚙️  validator-remove applied: {}", address);
                } else {
                    tracing::warn!("validator-remove: address {} not in set (no-op)", address);
                }
                return Ok(());
            }
            crate::types::TxKind::GovernorChange { new_governor } => {
                // Self-rotation: only the *current* governor may submit.
                // change_governor() re-checks signer == current and enforces
                // MAX_GOVERNOR_CHANGES. We refund `amount` either way.
                match self.change_governor(&tx.body.from, new_governor) {
                    Ok(count) => {
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!(
                            "⚙️  governor rotated: {} → {} (rotation #{}/{})",
                            governor, new_governor, count, MAX_GOVERNOR_CHANGES
                        );
                        return Ok(());
                    }
                    Err(e) => return refund(&mut from, format!("governor-change: {}", e)),
                }
            }
            crate::types::TxKind::Staking(op) => {
                // Phase B.4: dispatch staking ops to the StakingModule.
                // Balance flow:
                //   • CreateValidator/Stake : debit `self_bond`/`amount` from signer
                //                             (in addition to the fee already charged)
                //   • EditValidator/Unstake/Redelegate : no extra debit (Unstake
                //     payouts arrive at end_epoch via the unbonding queue)
                //   • ClaimRewards : credit operator with returned commission wei
                // `tx.body.amount` (the EVM-style transfer field) is always refunded
                // for staking governance txs.
                use crate::staking::StakeOp;
                let mut sm = self.staking();
                let signer = tx.body.from;

                // Helper: returns Ok(payout_wei_to_credit) on success.
                let result: Result<u128> = match op {
                    StakeOp::CreateValidator { pubkey, commission_bps, self_bond } => {
                        // Fixed-token minimum self-bond. The earlier dynamic
                        // USD-pegged design was removed (see comment on
                        // `MIN_SELF_BOND_WEI` in staking.rs) because reading
                        // economic security from the chain's own AMM is
                        // reflexive and flash-loan-manipulable.
                        let min_bond = crate::staking::MIN_SELF_BOND_WEI;
                        if from.balance < *self_bond {
                            Err(anyhow!(
                                "create-validator: insufficient balance for self-bond {} wei",
                                self_bond
                            ))
                        } else {
                            from.balance -= *self_bond;
                            match sm.create_validator(signer, *pubkey, *commission_bps, *self_bond, min_bond) {
                                Ok(()) => Ok(0u128),
                                Err(e) => {
                                    from.balance = from.balance.saturating_add(*self_bond);
                                    Err(anyhow!("create-validator: {} (min self-bond: {} wei)", e, min_bond))
                                }
                            }
                        }
                    }
                    StakeOp::EditValidator { validator, new_commission_bps } => {
                        sm.edit_validator(signer, *validator, *new_commission_bps)
                            .map(|_| 0u128)
                            .map_err(|e| anyhow!("edit-validator: {}", e))
                    }
                    StakeOp::Stake { validator, amount } => {
                        if from.balance < *amount {
                            Err(anyhow!("stake: insufficient balance for {} wei", amount))
                        } else {
                            from.balance -= *amount;
                            match sm.stake(signer, *validator, *amount) {
                                Ok(_) => Ok(0u128),
                                Err(e) => {
                                    from.balance = from.balance.saturating_add(*amount);
                                    Err(anyhow!("stake: {}", e))
                                }
                            }
                        }
                    }
                    StakeOp::Unstake { validator, shares } => {
                        sm.unstake(signer, *validator, *shares)
                            .map(|_| 0u128)
                            .map_err(|e| anyhow!("unstake: {}", e))
                    }
                    StakeOp::Redelegate { from: src, to, shares } => {
                        sm.redelegate(signer, *src, *to, *shares)
                            .map(|_| 0u128)
                            .map_err(|e| anyhow!("redelegate: {}", e))
                    }
                    StakeOp::ClaimRewards { validator } => {
                        // Combines: (a) operator commission_pool (legacy, validator-only)
                        // and (b) Phase B.5 locked-rewards drip + bulk for the signer
                        // (every staker can claim drip — operator OR delegator).
                        let current_h = self.tip().0;
                        let unlocked = sm.settle_unlock(signer, current_h);
                        // Validator-operator additionally drains commission_pool.
                        let commission = match sm.claim_rewards(signer, *validator) {
                            Ok(v) => v,
                            Err(_) => 0, // not the operator → drip-only is fine
                        };
                        Ok(unlocked.saturating_add(commission))
                    }
                };

                match result {
                    Ok(payout) => {
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        from.balance = from.balance.saturating_add(payout);
                        self.put_staking(&sm)?;
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!("⚙️  staking op applied: {:?}", op);
                        return Ok(());
                    }
                    Err(e) => return refund(&mut from, e.to_string()),
                }
            }
            crate::types::TxKind::RegisterPayId { pay_id, name } => {
                // Validate format
                let canon = match validate_payid(pay_id) {
                    Ok(c) => c,
                    Err(e) => return refund(&mut from, format!("register-pay-id: {}", e)),
                };
                let nm = match validate_payid_name(name) {
                    Ok(n) => n,
                    Err(e) => return refund(&mut from, format!("register-pay-id: {}", e)),
                };
                // 1 address = 1 pay-id (immutable).
                if self.get_payid_by_address(&tx.body.from).is_some() {
                    return refund(&mut from,
                        format!("register-pay-id: address {} already has a Pay-ID (immutable)", tx.body.from));
                }
                // Pay-ID must be globally unique.
                if self.get_address_by_payid(&canon).is_some() {
                    return refund(&mut from, format!("register-pay-id: '{}' already taken", canon));
                }
                self.put_pay_id(&tx.body.from, &canon, &nm)?;
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                tracing::info!("🪪 pay-id registered: {} = {} (\"{}\")", canon, tx.body.from, nm);
                return Ok(());
            }
            crate::types::TxKind::Multisig(op) => {
                // Phase B.8 — multisig dispatch. All ops refund `body.amount`;
                // only the fee is consumed. The multisig account itself holds
                // its own balance in CF_ACCOUNTS and is debited only on Execute.
                use crate::multisig::{
                    derive_multisig_address, normalize_owners, validate_threshold,
                    MultisigAccount, MultisigAction, MultisigOp, MultisigProposal,
                    PROPOSAL_MAX_EXPIRY_BLOCKS,
                };

                let current_height = self.tip().0;

                let result: Result<()> = match op {
                    MultisigOp::Create { owners, threshold, salt } => {
                        let owners = match normalize_owners(owners) {
                            Ok(o) => o,
                            Err(e) => return refund(&mut from, format!("multisig-create: {}", e)),
                        };
                        if let Err(e) = validate_threshold(*threshold, owners.len()) {
                            return refund(&mut from, format!("multisig-create: {}", e));
                        }
                        let addr = derive_multisig_address(&owners, *threshold, *salt, &tx.body.from);
                        if self.get_multisig(&addr).is_some() {
                            return refund(&mut from, format!(
                                "multisig-create: address {} already exists (change salt)", addr
                            ));
                        }
                        let acct = MultisigAccount {
                            address: addr,
                            owners,
                            threshold: *threshold,
                            created_height: current_height,
                            proposal_seq: 0,
                        };
                        self.put_multisig(&acct)?;
                        // Initialize the multisig account row in CF_ACCOUNTS so
                        // anyone can fund it via Transfer immediately.
                        let zero = self.account(&addr);
                        self.put_account(&addr, &zero)?;
                        tracing::info!(
                            "🔐 multisig created: {} ({}-of-{}, owners={:?})",
                            acct.address, acct.threshold, acct.owners.len(), acct.owners
                        );
                        Ok(())
                    }
                    MultisigOp::Propose { multisig, action, expiry_blocks } => {
                        let mut ms = match self.get_multisig(multisig) {
                            Some(m) => m,
                            None => return refund(&mut from, format!(
                                "multisig-propose: account {} not found", multisig)),
                        };
                        if !ms.is_owner(&tx.body.from) {
                            return refund(&mut from, format!(
                                "multisig-propose: {} is not an owner of {}", tx.body.from, multisig));
                        }
                        if *expiry_blocks == 0 || *expiry_blocks > PROPOSAL_MAX_EXPIRY_BLOCKS {
                            return refund(&mut from, format!(
                                "multisig-propose: expiry_blocks must be 1..={}", PROPOSAL_MAX_EXPIRY_BLOCKS));
                        }
                        // Sanity-check the action up front (cheap rejects).
                        match action {
                            MultisigAction::Transfer { amount, .. } => {
                                if *amount == 0 {
                                    return refund(&mut from,
                                        "multisig-propose: transfer amount must be > 0".into());
                                }
                            }
                        }
                        let id = ms.proposal_seq;
                        let mut p = MultisigProposal {
                            multisig: *multisig,
                            id,
                            action: action.clone(),
                            proposer: tx.body.from,
                            approvals: Vec::new(),
                            created_height: current_height,
                            expiry_height: current_height.saturating_add(*expiry_blocks),
                            executed: false,
                        };
                        // Auto-approve by proposer.
                        p.add_approval(tx.body.from);
                        ms.proposal_seq = ms.proposal_seq.saturating_add(1);
                        self.put_multisig(&ms)?;
                        self.put_ms_proposal(&p)?;
                        tracing::info!(
                            "📝 multisig proposal #{} created on {} by {} ({})",
                            id, multisig, tx.body.from, p.action.human()
                        );
                        Ok(())
                    }
                    MultisigOp::Approve { multisig, proposal_id } => {
                        let ms = match self.get_multisig(multisig) {
                            Some(m) => m,
                            None => return refund(&mut from, format!(
                                "multisig-approve: account {} not found", multisig)),
                        };
                        if !ms.is_owner(&tx.body.from) {
                            return refund(&mut from, format!(
                                "multisig-approve: {} is not an owner", tx.body.from));
                        }
                        let mut p = match self.get_ms_proposal(multisig, *proposal_id) {
                            Some(p) => p,
                            None => return refund(&mut from, format!(
                                "multisig-approve: proposal #{} not found", proposal_id)),
                        };
                        if p.executed {
                            return refund(&mut from,
                                format!("multisig-approve: proposal #{} already executed", proposal_id));
                        }
                        if current_height > p.expiry_height {
                            return refund(&mut from,
                                format!("multisig-approve: proposal #{} expired at h={}", proposal_id, p.expiry_height));
                        }
                        if !p.add_approval(tx.body.from) {
                            return refund(&mut from,
                                format!("multisig-approve: {} already approved #{}", tx.body.from, proposal_id));
                        }
                        self.put_ms_proposal(&p)?;
                        tracing::info!(
                            "✅ multisig approval added: #{} on {} by {} ({}/{})",
                            proposal_id, multisig, tx.body.from, p.approvals.len(), ms.threshold
                        );
                        Ok(())
                    }
                    MultisigOp::Revoke { multisig, proposal_id } => {
                        let ms = match self.get_multisig(multisig) {
                            Some(m) => m,
                            None => return refund(&mut from, format!(
                                "multisig-revoke: account {} not found", multisig)),
                        };
                        if !ms.is_owner(&tx.body.from) {
                            return refund(&mut from, format!(
                                "multisig-revoke: {} is not an owner", tx.body.from));
                        }
                        let mut p = match self.get_ms_proposal(multisig, *proposal_id) {
                            Some(p) => p,
                            None => return refund(&mut from, format!(
                                "multisig-revoke: proposal #{} not found", proposal_id)),
                        };
                        if p.executed {
                            return refund(&mut from,
                                format!("multisig-revoke: proposal #{} already executed", proposal_id));
                        }
                        if !p.remove_approval(&tx.body.from) {
                            return refund(&mut from,
                                format!("multisig-revoke: {} had no approval on #{}", tx.body.from, proposal_id));
                        }
                        self.put_ms_proposal(&p)?;
                        tracing::info!(
                            "↩️  multisig approval revoked: #{} on {} by {} ({}/{})",
                            proposal_id, multisig, tx.body.from, p.approvals.len(), ms.threshold
                        );
                        Ok(())
                    }
                    MultisigOp::Execute { multisig, proposal_id } => {
                        let ms = match self.get_multisig(multisig) {
                            Some(m) => m,
                            None => return refund(&mut from, format!(
                                "multisig-execute: account {} not found", multisig)),
                        };
                        if !ms.is_owner(&tx.body.from) {
                            return refund(&mut from, format!(
                                "multisig-execute: {} is not an owner", tx.body.from));
                        }
                        let mut p = match self.get_ms_proposal(multisig, *proposal_id) {
                            Some(p) => p,
                            None => return refund(&mut from, format!(
                                "multisig-execute: proposal #{} not found", proposal_id)),
                        };
                        if p.executed {
                            return refund(&mut from,
                                format!("multisig-execute: proposal #{} already executed", proposal_id));
                        }
                        if current_height > p.expiry_height {
                            return refund(&mut from,
                                format!("multisig-execute: proposal #{} expired at h={}", proposal_id, p.expiry_height));
                        }
                        if (p.approvals.len() as u8) < ms.threshold {
                            return refund(&mut from, format!(
                                "multisig-execute: only {}/{} approvals collected",
                                p.approvals.len(), ms.threshold));
                        }
                        // Apply the action atomically. Refund on any failure
                        // so the executor only loses gas, not principal.
                        match &p.action {
                            MultisigAction::Transfer { to, amount } => {
                                let mut ms_acc = self.account(multisig);
                                if ms_acc.balance < *amount {
                                    return refund(&mut from, format!(
                                        "multisig-execute: multisig balance {} < transfer amount {}",
                                        ms_acc.balance, amount));
                                }
                                ms_acc.balance -= *amount;
                                ms_acc.nonce = ms_acc.nonce.saturating_add(1);
                                self.put_account(multisig, &ms_acc)?;
                                let mut to_acc = self.account(to);
                                to_acc.balance = to_acc.balance.saturating_add(*amount);
                                self.put_account(to, &to_acc)?;
                            }
                        }
                        p.executed = true;
                        self.put_ms_proposal(&p)?;
                        tracing::info!(
                            "🚀 multisig executed: #{} on {} by {} ({})",
                            proposal_id, multisig, tx.body.from, p.action.human()
                        );
                        Ok(())
                    }
                };

                match result {
                    Ok(()) => {
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        return Ok(());
                    }
                    Err(e) => return refund(&mut from, e.to_string()),
                }
            }
            crate::types::TxKind::Swap { direction, min_out } => {
                // ── Phase B.10 — explicit AMM swap with slippage protection ──
                //
                // Pre-dispatch debit (above) is kind-aware:
                //   • ZbxToZusd → already debited `amount + fee` from balance.
                //   • ZusdToZbx → debited only `fee` from balance; the swap arm
                //     itself debits the zUSD principal from `from.zusd`.
                // On any failure we return the principal to its source token
                // (the global `refund` closure refunds to .balance which is
                // wrong for ZusdToZbx, so we use a local direction-aware one).
                use crate::transaction::SwapDirection;

                let dir = *direction;
                let swap_refund = |from: &mut Account, msg: String| -> Result<()> {
                    match dir {
                        SwapDirection::ZbxToZusd => {
                            // We DID pre-debit `amount` from balance — restore it.
                            from.balance = from.balance.saturating_add(tx.body.amount);
                        }
                        SwapDirection::ZusdToZbx => {
                            // We did NOT pre-debit `amount` from balance for this
                            // direction (only `fee`), so nothing to restore here.
                            // Fee is consumed (standard "revert with gas").
                        }
                    }
                    self.put_account(&tx.body.from, from)?;
                    Err(anyhow!(msg))
                };

                if tx.body.amount == 0 {
                    return swap_refund(&mut from, "swap: amount must be > 0".into());
                }
                if tx.body.to != tx.body.from {
                    return swap_refund(&mut from,
                        "swap: body.to must equal body.from (output credits sender)".into());
                }
                let mut pool = self.pool();
                if !pool.is_initialized() {
                    return swap_refund(&mut from,
                        "swap: pool not yet initialized — cannot swap yet".into());
                }
                let height = self.tip().0;

                match direction {
                    SwapDirection::ZbxToZusd => {
                        // Pre-debit already removed `amount` from balance — that
                        // is exactly the ZBX we want to swap. No re-balancing.
                        match pool.swap_zbx_for_zusd(tx.body.amount, height) {
                            Ok(zusd_out) if zusd_out >= *min_out => {
                                let (admin_zbx, admin_zusd) = pool.settle_fees();
                                self.put_pool(&pool)?;
                                from.zusd = from.zusd.saturating_add(zusd_out);
                                self.put_account(&tx.body.from, &from)?;
                                if admin_zbx > 0 || admin_zusd > 0 {
                                    let mut a = self.account(&admin);
                                    a.balance = a.balance.saturating_add(admin_zbx);
                                    a.zusd = a.zusd.saturating_add(admin_zusd);
                                    self.put_account(&admin, &a)?;
                                }
                                tracing::info!(
                                    "🔁 swap zbx→zusd: {} wei → {} zUSD by {} (min_out {})",
                                    tx.body.amount, zusd_out, tx.body.from, min_out
                                );
                                return Ok(());
                            }
                            Ok(zusd_out) => {
                                // Slippage failure — refund ZBX principal, keep fee.
                                from.balance = from.balance.saturating_add(tx.body.amount);
                                self.put_account(&tx.body.from, &from)?;
                                return Err(anyhow!(
                                    "swap slippage: would receive {} zUSD < min_out {} (refunded {} ZBX wei, fee kept)",
                                    zusd_out, min_out, tx.body.amount
                                ));
                            }
                            Err(e) => {
                                from.balance = from.balance.saturating_add(tx.body.amount);
                                self.put_account(&tx.body.from, &from)?;
                                return Err(anyhow!(
                                    "swap zbx→zusd failed (refunded {} ZBX wei, fee kept): {}",
                                    tx.body.amount, e
                                ));
                            }
                        }
                    }
                    SwapDirection::ZusdToZbx => {
                        // The pre-dispatch debit only took `fee` from balance for
                        // this direction (see kind-aware pre_debit above), so we
                        // do NOT need to refund balance here — we only need to
                        // debit the zUSD principal.
                        if from.zusd < tx.body.amount {
                            // Capture immutable read into a local before the
                            // `&mut from` borrow inside swap_refund() — borrow
                            // checker would otherwise reject reading from.zusd
                            // while mutably borrowing `from`.
                            let have = from.zusd;
                            let need = tx.body.amount;
                            return swap_refund(&mut from, format!(
                                "swap: insufficient zUSD: have {}, need {}",
                                have, need));
                        }
                        from.zusd -= tx.body.amount;
                        match pool.swap_zusd_for_zbx(tx.body.amount, height) {
                            Ok(zbx_out) if zbx_out >= *min_out => {
                                let (admin_zbx, admin_zusd) = pool.settle_fees();
                                self.put_pool(&pool)?;
                                from.balance = from.balance.saturating_add(zbx_out);
                                self.put_account(&tx.body.from, &from)?;
                                if admin_zbx > 0 || admin_zusd > 0 {
                                    let mut a = self.account(&admin);
                                    a.balance = a.balance.saturating_add(admin_zbx);
                                    a.zusd = a.zusd.saturating_add(admin_zusd);
                                    self.put_account(&admin, &a)?;
                                }
                                tracing::info!(
                                    "🔁 swap zusd→zbx: {} zUSD → {} ZBX wei by {} (min_out {})",
                                    tx.body.amount, zbx_out, tx.body.from, min_out
                                );
                                return Ok(());
                            }
                            Ok(zbx_out) => {
                                from.zusd = from.zusd.saturating_add(tx.body.amount);
                                self.put_account(&tx.body.from, &from)?;
                                return Err(anyhow!(
                                    "swap slippage: would receive {} ZBX wei < min_out {} (refunded {} zUSD, fee kept)",
                                    zbx_out, min_out, tx.body.amount
                                ));
                            }
                            Err(e) => {
                                from.zusd = from.zusd.saturating_add(tx.body.amount);
                                self.put_account(&tx.body.from, &from)?;
                                return Err(anyhow!(
                                    "swap zusd→zbx failed (refunded {} zUSD, fee kept): {}",
                                    tx.body.amount, e
                                ));
                            }
                        }
                    }
                }
            }
            crate::types::TxKind::Bridge(op) => {
                // ── Phase B.12 — cross-chain bridge dispatch ──
                use crate::bridge::{
                    BridgeAsset, BridgeNetwork, BridgeOp, BridgeOutEvent, NativeAsset,
                    validate_contract, validate_dest_address, validate_network_name,
                };

                let bridge_lock_addr = Address::from_hex(crate::tokenomics::BRIDGE_LOCK_ADDRESS_HEX)
                    .map_err(|e| anyhow!("invalid BRIDGE_LOCK_ADDRESS_HEX: {}", e))?;
                let current_height = self.tip().0;

                match op {
                    BridgeOp::RegisterNetwork { id, name, kind } => {
                        if tx.body.from != admin {
                            return refund(&mut from, format!(
                                "bridge-register-network: only admin {} may submit", admin
                            ));
                        }
                        if let Err(e) = validate_network_name(name) {
                            return refund(&mut from, format!("bridge-register-network: {}", e));
                        }
                        if self.bridge_get_network(*id).is_some() {
                            return refund(&mut from, format!(
                                "bridge-register-network: network id {} already registered", id
                            ));
                        }
                        let net = BridgeNetwork {
                            id: *id,
                            name: name.trim().to_string(),
                            kind: *kind,
                            active: true,
                            registered_height: current_height,
                        };
                        self.bridge_put_network(&net)?;
                        // Refund principal — only fee consumed.
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!(
                            "🌉 bridge-network registered: id={} name=\"{}\" kind={:?}",
                            net.id, net.name, net.kind
                        );
                        return Ok(());
                    }
                    BridgeOp::SetNetworkActive { id, active } => {
                        if tx.body.from != admin {
                            return refund(&mut from, format!(
                                "bridge-set-network-active: only admin {} may submit", admin));
                        }
                        let mut net = match self.bridge_get_network(*id) {
                            Some(n) => n,
                            None => return refund(&mut from, format!(
                                "bridge-set-network-active: network {} not found", id)),
                        };
                        net.active = *active;
                        self.bridge_put_network(&net)?;
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!("🌉 bridge-network {} active={}", id, active);
                        return Ok(());
                    }
                    BridgeOp::RegisterAsset { network_id, native, contract, decimals } => {
                        if tx.body.from != admin {
                            return refund(&mut from, format!(
                                "bridge-register-asset: only admin {} may submit", admin));
                        }
                        let net = match self.bridge_get_network(*network_id) {
                            Some(n) => n,
                            None => return refund(&mut from, format!(
                                "bridge-register-asset: network {} not found", network_id)),
                        };
                        if let Err(e) = validate_contract(contract, net.kind) {
                            return refund(&mut from, format!("bridge-register-asset: {}", e));
                        }
                        let local_seq = match self.bridge_next_local_asset_seq(*network_id) {
                            Ok(s) => s,
                            Err(e) => return refund(&mut from,
                                format!("bridge-register-asset: {}", e)),
                        };
                        let asset_id = BridgeAsset::make_id(*network_id, local_seq);
                        let asset = BridgeAsset {
                            asset_id,
                            network_id: *network_id,
                            native: *native,
                            contract: contract.trim().to_string(),
                            decimals: *decimals,
                            active: true,
                            registered_height: current_height,
                        };
                        self.bridge_put_asset(&asset)?;
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!(
                            "🌉 bridge-asset registered: id={} network={} native={} contract={}",
                            asset.asset_id, asset.network_id, asset.native.symbol(), asset.contract
                        );
                        return Ok(());
                    }
                    BridgeOp::SetAssetActive { asset_id, active } => {
                        if tx.body.from != admin {
                            return refund(&mut from, format!(
                                "bridge-set-asset-active: only admin {} may submit", admin));
                        }
                        let mut a = match self.bridge_get_asset(*asset_id) {
                            Some(a) => a,
                            None => return refund(&mut from, format!(
                                "bridge-set-asset-active: asset {} not found", asset_id)),
                        };
                        a.active = *active;
                        self.bridge_put_asset(&a)?;
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!("🌉 bridge-asset {} active={}", asset_id, active);
                        return Ok(());
                    }
                    BridgeOp::BridgeOut { asset_id, dest_address } => {
                        // User op — locks `tx.body.amount` of the asset's native token.
                        let asset = match self.bridge_get_asset(*asset_id) {
                            Some(a) if a.active => a,
                            Some(_) => return refund(&mut from, format!(
                                "bridge-out: asset {} is disabled", asset_id)),
                            None => return refund(&mut from, format!(
                                "bridge-out: asset {} not found", asset_id)),
                        };
                        let net = match self.bridge_get_network(asset.network_id) {
                            Some(n) if n.active => n,
                            Some(_) => return refund(&mut from, format!(
                                "bridge-out: network {} is disabled", asset.network_id)),
                            None => return refund(&mut from, format!(
                                "bridge-out: network {} not found", asset.network_id)),
                        };
                        if let Err(e) = validate_dest_address(dest_address, net.kind) {
                            return refund(&mut from, format!("bridge-out: {}", e));
                        }
                        if tx.body.amount == 0 {
                            return refund(&mut from, "bridge-out: amount must be > 0".into());
                        }
                        // Native-asset-specific lock. Pre-debit took (amount+fee) from
                        // from.balance — for ZBX that IS the lock; for zUSD we must
                        // refund the wei amount and instead debit from from.zusd.
                        match asset.native {
                            NativeAsset::Zbx => {
                                let mut lock_acc = self.account(&bridge_lock_addr);
                                lock_acc.balance = lock_acc.balance.saturating_add(tx.body.amount);
                                self.put_account(&bridge_lock_addr, &lock_acc)?;
                                let new_locked = self.bridge_locked_zbx()
                                    .saturating_add(tx.body.amount);
                                self.bridge_set_locked(NativeAsset::Zbx, new_locked)?;
                            }
                            NativeAsset::Zusd => {
                                from.balance = from.balance.saturating_add(tx.body.amount);
                                if from.zusd < tx.body.amount {
                                    self.put_account(&tx.body.from, &from)?;
                                    return Err(anyhow!(
                                        "bridge-out: insufficient zUSD ({} < {})",
                                        from.zusd, tx.body.amount
                                    ));
                                }
                                from.zusd -= tx.body.amount;
                                let mut lock_acc = self.account(&bridge_lock_addr);
                                lock_acc.zusd = lock_acc.zusd.saturating_add(tx.body.amount);
                                self.put_account(&bridge_lock_addr, &lock_acc)?;
                                let new_locked = self.bridge_locked_zusd()
                                    .saturating_add(tx.body.amount);
                                self.bridge_set_locked(NativeAsset::Zusd, new_locked)?;
                            }
                        }
                        self.put_account(&tx.body.from, &from)?;

                        let seq = self.bridge_next_event_seq()?;
                        let ev = BridgeOutEvent {
                            seq,
                            asset_id: asset.asset_id,
                            native_symbol: asset.native.symbol().to_string(),
                            from: tx.body.from,
                            dest_address: dest_address.trim().to_string(),
                            amount: tx.body.amount,
                            height: current_height,
                            ts: self.current_block_ts_ms.load(Ordering::SeqCst) as i64,
                            tx_hash: tx.hash().0,
                        };
                        self.bridge_record_out_event(&ev)?;
                        tracing::info!(
                            "🌉 bridge-out: seq={} asset={} {} {} from {} → network {} dest {}",
                            ev.seq, ev.asset_id, ev.amount, ev.native_symbol,
                            ev.from, asset.network_id, ev.dest_address
                        );
                        return Ok(());
                    }
                    BridgeOp::BridgeIn { asset_id, source_tx_hash, recipient, amount } => {
                        if tx.body.from != admin {
                            return refund(&mut from, format!(
                                "bridge-in: only admin {} may submit", admin));
                        }
                        let asset = match self.bridge_get_asset(*asset_id) {
                            Some(a) if a.active => a,
                            Some(_) => return refund(&mut from, format!(
                                "bridge-in: asset {} is disabled", asset_id)),
                            None => return refund(&mut from, format!(
                                "bridge-in: asset {} not found", asset_id)),
                        };
                        if *amount == 0 {
                            return refund(&mut from, "bridge-in: amount must be > 0".into());
                        }
                        if self.bridge_is_claim_used(source_tx_hash) {
                            return refund(&mut from, format!(
                                "bridge-in: source tx 0x{} already claimed (replay protection)",
                                hex::encode(source_tx_hash)
                            ));
                        }
                        match asset.native {
                            NativeAsset::Zbx => {
                                let locked = self.bridge_locked_zbx();
                                if locked < *amount {
                                    return refund(&mut from, format!(
                                        "bridge-in: locked ZBX ({}) < release amount ({})",
                                        locked, amount
                                    ));
                                }
                                let mut lock_acc = self.account(&bridge_lock_addr);
                                lock_acc.balance = lock_acc.balance.saturating_sub(*amount);
                                self.put_account(&bridge_lock_addr, &lock_acc)?;
                                let mut rec = self.account(recipient);
                                rec.balance = rec.balance.saturating_add(*amount);
                                self.put_account(recipient, &rec)?;
                                self.bridge_set_locked(NativeAsset::Zbx, locked - *amount)?;
                            }
                            NativeAsset::Zusd => {
                                let locked = self.bridge_locked_zusd();
                                if locked < *amount {
                                    return refund(&mut from, format!(
                                        "bridge-in: locked zUSD ({}) < release amount ({})",
                                        locked, amount
                                    ));
                                }
                                let mut lock_acc = self.account(&bridge_lock_addr);
                                lock_acc.zusd = lock_acc.zusd.saturating_sub(*amount);
                                self.put_account(&bridge_lock_addr, &lock_acc)?;
                                let mut rec = self.account(recipient);
                                rec.zusd = rec.zusd.saturating_add(*amount);
                                self.put_account(recipient, &rec)?;
                                self.bridge_set_locked(NativeAsset::Zusd, locked - *amount)?;
                            }
                        }
                        self.bridge_mark_claim(source_tx_hash)?;
                        // Admin doesn't supply funds — refund body.amount.
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!(
                            "🌉 bridge-in: asset={} {} {} → {} (src 0x{}…)",
                            asset.asset_id, amount, asset.native.symbol(), recipient,
                            &hex::encode(source_tx_hash)[..16]
                        );
                        return Ok(());
                    }
                }
            }
            crate::types::TxKind::Proposal(op) => {
                // ── Phase D — on-chain forkless governance ──
                use crate::proposal::{
                    Proposal, ProposalOp, ProposalStatus,
                    MAX_ACTIVE_PROPOSALS_PER_ADDRESS, MIN_PROPOSER_BALANCE_WEI,
                    TEST_PHASE_BLOCKS, TOTAL_LIFECYCLE_BLOCKS,
                    validate_description, validate_kind, validate_title,
                };
                let current_height = self.tip().0;
                let current_ts_ms = self.current_block_ts_ms.load(Ordering::SeqCst);

                match op {
                    ProposalOp::Submit { title, description, kind } => {
                        // Reconstruct the pre-debit balance: original = current + amount + fee.
                        // We need the wallet to have held ≥ 1 000 ZBX BEFORE paying gas.
                        let original_balance = from.balance
                            .saturating_add(tx.body.amount)
                            .saturating_add(tx.body.fee);
                        if original_balance < MIN_PROPOSER_BALANCE_WEI {
                            return refund(&mut from, format!(
                                "proposal-submit: proposer needs ≥ {} wei (1000 ZBX), has {}",
                                MIN_PROPOSER_BALANCE_WEI, original_balance
                            ));
                        }
                        let active_count = self.count_active_proposals_by(&tx.body.from);
                        if active_count >= MAX_ACTIVE_PROPOSALS_PER_ADDRESS {
                            return refund(&mut from, format!(
                                "proposal-submit: {} already has {} active proposals (max {})",
                                tx.body.from, active_count, MAX_ACTIVE_PROPOSALS_PER_ADDRESS
                            ));
                        }
                        let title_v = match validate_title(title) {
                            Ok(t) => t,
                            Err(e) => return refund(&mut from, format!("proposal-submit: {}", e)),
                        };
                        let desc_v = match validate_description(description) {
                            Ok(d) => d,
                            Err(e) => return refund(&mut from, format!("proposal-submit: {}", e)),
                        };
                        let mut kind_v = kind.clone();
                        if let Err(e) = validate_kind(&mut kind_v) {
                            return refund(&mut from, format!("proposal-submit: {}", e));
                        }
                        let id = match self.next_proposal_id() {
                            Ok(i) => i,
                            Err(e) => return refund(&mut from,
                                format!("proposal-submit: id alloc failed: {}", e)),
                        };
                        let proposal = Proposal {
                            id,
                            proposer: tx.body.from,
                            title: title_v,
                            description: desc_v,
                            kind: kind_v,
                            status: ProposalStatus::Testing,
                            created_at_height: current_height,
                            created_at_ms: current_ts_ms,
                            voting_starts_at_height: current_height + TEST_PHASE_BLOCKS,
                            voting_ends_at_height: current_height + TOTAL_LIFECYCLE_BLOCKS,
                            yes_votes: 0,
                            no_votes: 0,
                            test_runs: 0,
                            test_success: 0,
                            test_failure: 0,
                            activated_at_height: None,
                        };
                        self.put_proposal(&proposal)?;
                        self.put_active_marker(&tx.body.from, id)?;
                        // Refund principal — only fee consumed.
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!(
                            "🗳️  proposal-submit id={} kind={} from {} title=\"{}\" \
                             test→14d voting→14..90d",
                            id, proposal.kind.variant_label(), tx.body.from, proposal.title,
                        );
                        return Ok(());
                    }
                    ProposalOp::Vote { proposal_id, yes } => {
                        let mut proposal = match self.get_proposal(*proposal_id) {
                            Some(p) => p,
                            None => return refund(&mut from, format!(
                                "proposal-vote: id {} not found", proposal_id
                            )),
                        };
                        if proposal.status != ProposalStatus::Voting {
                            return refund(&mut from, format!(
                                "proposal-vote: id {} is in '{}' phase, voting not open",
                                proposal_id, proposal.status.label()
                            ));
                        }
                        if self.has_voted(*proposal_id, &tx.body.from) {
                            return refund(&mut from, format!(
                                "proposal-vote: {} has already voted on id {}",
                                tx.body.from, proposal_id
                            ));
                        }
                        self.put_vote(*proposal_id, &tx.body.from, *yes)?;
                        if *yes {
                            proposal.yes_votes = proposal.yes_votes.saturating_add(1);
                        } else {
                            proposal.no_votes  = proposal.no_votes.saturating_add(1);
                        }
                        self.put_proposal(&proposal)?;
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        tracing::info!(
                            "🗳️  proposal-vote id={} {} from {} (tally yes={} no={})",
                            proposal_id, if *yes { "YES" } else { "NO" }, tx.body.from,
                            proposal.yes_votes, proposal.no_votes,
                        );
                        return Ok(());
                    }
                }
            }
            // ─────────────────────────────────────────────────────────
            // Phase E — User-creatable fungible tokens
            //
            // Censorship-resistance: NO admin/governor gating on any of
            // these arms. Anyone with sufficient balance + valid nonce
            // can call them; only `TokenMint` is gated to the recorded
            // creator (because mint trivially dilutes other holders).
            // No address blacklist, no freeze. Once a user receives a
            // token balance, only they (or an explicit on-chain spend
            // by them) can move it.
            // ─────────────────────────────────────────────────────────
            crate::types::TxKind::TokenCreate { name, symbol, decimals, initial_supply } => {
                // Validation — return refund() on every error path so that
                // the sender pays only the standard fee on rejection.
                if name.is_empty() || name.len() > crate::tokenomics::TOKEN_NAME_MAX_LEN {
                    return refund(&mut from, format!(
                        "token-create: name length must be 1..={} chars (got {})",
                        crate::tokenomics::TOKEN_NAME_MAX_LEN, name.len()
                    ));
                }
                let sym_len = symbol.len();
                if sym_len < crate::tokenomics::TOKEN_SYMBOL_MIN_LEN
                    || sym_len > crate::tokenomics::TOKEN_SYMBOL_MAX_LEN
                {
                    return refund(&mut from, format!(
                        "token-create: symbol length must be {}..={} chars (got {})",
                        crate::tokenomics::TOKEN_SYMBOL_MIN_LEN,
                        crate::tokenomics::TOKEN_SYMBOL_MAX_LEN,
                        sym_len
                    ));
                }
                if !symbol.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
                    return refund(&mut from,
                        "token-create: symbol must be uppercase ASCII letters or digits only".into());
                }
                if *decimals > crate::tokenomics::TOKEN_MAX_DECIMALS {
                    return refund(&mut from, format!(
                        "token-create: decimals must be 0..={} (got {})",
                        crate::tokenomics::TOKEN_MAX_DECIMALS, decimals
                    ));
                }
                if *initial_supply == 0 {
                    return refund(&mut from,
                        "token-create: initial_supply must be > 0".into());
                }
                let symbol_lc = symbol.to_ascii_lowercase();
                if self.get_token_by_symbol(&symbol_lc).is_some() {
                    return refund(&mut from, format!(
                        "token-create: symbol '{}' already taken", symbol
                    ));
                }
                // Anti-spam burn — only applied if TOKEN_CREATION_BURN_WEI > 0.
                // Currently set to 0 (gas-only), so this block is a no-op.
                let burn_wei = crate::tokenomics::TOKEN_CREATION_BURN_WEI;
                if burn_wei > 0 {
                    if from.balance < burn_wei {
                        return refund(&mut from, format!(
                            "token-create: insufficient balance for {} ZBX creation burn \
                             (need {} wei more, after fee)",
                            burn_wei / 1_000_000_000_000_000_000u128, burn_wei
                        ));
                    }
                    from.balance -= burn_wei;
                    let mut burn_acc = self.account(&burn_address());
                    burn_acc.balance = burn_acc.balance.saturating_add(burn_wei);
                    self.put_account(&burn_address(), &burn_acc)?;
                }

                // Allocate id and persist token.
                let id = self.token_count().saturating_add(1);
                let info = TokenInfo {
                    id,
                    creator: tx.body.from,
                    name: name.clone(),
                    symbol: symbol.clone(),
                    decimals: *decimals,
                    total_supply: *initial_supply,
                    created_at_height: self.tip().0.saturating_add(1),
                };
                self.put_token(&info)?;
                self.put_token_symbol(&symbol_lc, id)?;
                self.put_token_count(id)?;
                // Credit creator with the entire initial supply.
                self.put_token_balance(id, &tx.body.from, *initial_supply)?;
                // Refund body.amount (it was debited at top of apply_tx).
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                tracing::info!(
                    "🪙 token-create id={} symbol={} decimals={} supply={} creator={}",
                    id, symbol, decimals, initial_supply, tx.body.from,
                );
                return Ok(());
            }
            crate::types::TxKind::TokenTransfer { token_id, to, amount } => {
                if *amount == 0 {
                    return refund(&mut from, "token-transfer: amount must be > 0".into());
                }
                if self.get_token(*token_id).is_none() {
                    return refund(&mut from, format!(
                        "token-transfer: token id {} does not exist", token_id
                    ));
                }
                let from_bal = self.token_balance_of(*token_id, &tx.body.from);
                if from_bal < *amount {
                    return refund(&mut from, format!(
                        "token-transfer: insufficient token balance: have {}, need {}",
                        from_bal, amount
                    ));
                }
                let to_bal = self.token_balance_of(*token_id, to);
                let new_to = to_bal.checked_add(*amount).ok_or_else(|| {
                    anyhow!("token-transfer: recipient balance overflow")
                })?;
                self.put_token_balance(*token_id, &tx.body.from, from_bal - amount)?;
                self.put_token_balance(*token_id, to, new_to)?;
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                tracing::info!(
                    "🪙 token-transfer id={} {} → {} amount={}",
                    token_id, tx.body.from, to, amount,
                );
                return Ok(());
            }
            crate::types::TxKind::TokenMint { token_id, to, amount } => {
                if *amount == 0 {
                    return refund(&mut from, "token-mint: amount must be > 0".into());
                }
                let mut info = match self.get_token(*token_id) {
                    Some(t) => t,
                    None => return refund(&mut from, format!(
                        "token-mint: token id {} does not exist", token_id
                    )),
                };
                if tx.body.from != info.creator {
                    return refund(&mut from, format!(
                        "token-mint: only creator {} may mint id {}",
                        info.creator, token_id
                    ));
                }
                let new_supply = info.total_supply.checked_add(*amount).ok_or_else(|| {
                    anyhow!("token-mint: total_supply overflow")
                })?;
                let to_bal = self.token_balance_of(*token_id, to);
                let new_to = to_bal.checked_add(*amount).ok_or_else(|| {
                    anyhow!("token-mint: recipient balance overflow")
                })?;
                info.total_supply = new_supply;
                self.put_token(&info)?;
                self.put_token_balance(*token_id, to, new_to)?;
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                tracing::info!(
                    "🪙 token-mint id={} → {} amount={} new_supply={}",
                    token_id, to, amount, new_supply,
                );
                return Ok(());
            }
            crate::types::TxKind::TokenBurn { token_id, amount } => {
                if *amount == 0 {
                    return refund(&mut from, "token-burn: amount must be > 0".into());
                }
                let mut info = match self.get_token(*token_id) {
                    Some(t) => t,
                    None => return refund(&mut from, format!(
                        "token-burn: token id {} does not exist", token_id
                    )),
                };
                let from_bal = self.token_balance_of(*token_id, &tx.body.from);
                if from_bal < *amount {
                    return refund(&mut from, format!(
                        "token-burn: insufficient token balance: have {}, need {}",
                        from_bal, amount
                    ));
                }
                info.total_supply = info.total_supply.saturating_sub(*amount);
                self.put_token(&info)?;
                self.put_token_balance(*token_id, &tx.body.from, from_bal - amount)?;
                from.balance = from.balance.saturating_add(tx.body.amount);
                self.put_account(&tx.body.from, &from)?;
                tracing::info!(
                    "🪙 token-burn id={} from {} amount={} new_supply={}",
                    token_id, tx.body.from, amount, info.total_supply,
                );
                return Ok(());
            }
            crate::types::TxKind::Transfer => { /* fall through to legacy logic */ }
        }

        if tx.body.to == pool_addr && tx.body.amount > 0 {
            // ─── Pool intercept ───
            // IMPORTANT: do NOT commit `from` yet. We try the pool op first; if it fails,
            // we refund the `amount` (keep fee deducted) so users never lose principal on
            // failed swaps — only gas. Standard EVM-style "revert with gas spent" UX.
            let mut pool = self.pool();
            if !pool.is_initialized() {
                return Err(anyhow!("pool not yet initialized — cannot accept ZBX yet"));
            }
            let height = self.tip().0;
            if tx.body.from == admin {
                // Admin single-sided liquidity: just grow ZBX reserve.
                match pool.admin_add_zbx(tx.body.amount, height) {
                    Ok(()) => {
                        self.put_pool(&pool)?;
                        self.put_account(&tx.body.from, &from)?;
                    }
                    Err(e) => {
                        // Refund amount, keep fee.
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        return Err(anyhow!("admin add zbx (refunded amount, fee kept): {}", e));
                    }
                }
            } else {
                // Auto-swap ZBX → zUSD, credit back to sender.
                match pool.swap_zbx_for_zusd(tx.body.amount, height) {
                    Ok(zusd_out) => {
                        // Settle fees → may yield admin payout.
                        let (admin_zbx, admin_zusd) = pool.settle_fees();
                        self.put_pool(&pool)?;
                        // Credit zUSD to sender, commit ZBX debit (fee+amount).
                        from.zusd = from.zusd.saturating_add(zusd_out);
                        self.put_account(&tx.body.from, &from)?;
                        // Credit any admin payout.
                        if admin_zbx > 0 || admin_zusd > 0 {
                            let mut a = if admin == tx.body.from { from.clone() }
                                        else { self.account(&admin) };
                            // Re-read in case sender == admin (avoid stale).
                            if admin == tx.body.from { a = self.account(&admin); }
                            a.balance = a.balance.saturating_add(admin_zbx);
                            a.zusd = a.zusd.saturating_add(admin_zusd);
                            self.put_account(&admin, &a)?;
                        }
                    }
                    Err(e) => {
                        // Swap failed → refund principal, keep fee. Pool reserves untouched
                        // (swap_zbx_for_zusd only mutates pool on Ok).
                        from.balance = from.balance.saturating_add(tx.body.amount);
                        self.put_account(&tx.body.from, &from)?;
                        return Err(anyhow!("auto-swap failed (refunded {} wei, fee kept): {}",
                            tx.body.amount, e));
                    }
                }
            }
        } else {
            // Normal transfer.
            let mut to = self.account(&tx.body.to);
            to.balance = to.balance.saturating_add(tx.body.amount);
            self.put_account(&tx.body.from, &from)?;
            self.put_account(&tx.body.to, &to)?;
        }
        Ok(())
    }

    // ───────── Phase B.9 — Recent-Tx index (rolling ring buffer) ─────────

    fn rtx_key(seq: u64) -> Vec<u8> {
        let mut k = META_RTX_PREFIX.to_vec();
        k.extend_from_slice(&seq.to_be_bytes());
        k
    }

    /// Secondary-index key: `b"rtx/h/" || tx_hash` → `seq.to_be_bytes()`.
    /// Used by `eth_getTransactionByHash` / `eth_getTransactionReceipt` to
    /// resolve a 32-byte hash to its sequence number in one point lookup.
    fn rtx_hash_key(hash: &[u8; 32]) -> Vec<u8> {
        let mut k = META_RTX_HASH_PREFIX.to_vec();
        k.extend_from_slice(hash);
        k
    }

    /// Read the next-seq counter from CF_META (0 if uninitialized).
    fn rtx_next_seq(&self) -> u64 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, META_RTX_SEQ).ok().flatten()
            .map(|b| {
                let mut a = [0u8; 8];
                if b.len() == 8 { a.copy_from_slice(&b); }
                u64::from_be_bytes(a)
            })
            .unwrap_or(0)
    }

    /// Push a single applied-tx summary into the ring buffer. Caller passes
    /// a partially-filled record (`seq` is ignored and overwritten with the
    /// freshly-assigned sequence number). Evicts the oldest entry once the
    /// ring exceeds `RECENT_TX_CAP` so storage is bounded.
    ///
    /// Errors are non-fatal at the caller site (logging only) — losing a
    /// recent-tx index entry must NEVER fail block apply. See `apply_block`.
    fn push_recent_tx(&self, mut rec: RecentTxRecord) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let next = self.rtx_next_seq();
        rec.seq = next;
        let rec_hash = rec.hash; // capture before move
        self.db.put_cf(cf, Self::rtx_key(next), bincode::serialize(&rec)?)?;
        // Phase C.2.1 — write secondary hash index so eth_getTransactionByHash
        // and eth_getTransactionReceipt resolve in one point lookup.
        self.db.put_cf(cf, Self::rtx_hash_key(&rec_hash), next.to_be_bytes())?;
        // Evict the entry that just fell out of the rolling window. Both the
        // primary `rtx/<seq>` entry AND the secondary `rtx/h/<hash>` mapping
        // for that record must be deleted in lockstep so the hash index
        // never points to a non-existent seq.
        if next >= RECENT_TX_CAP {
            let evict = next - RECENT_TX_CAP;
            // Read evicted record first so we can also clean its hash index.
            if let Ok(Some(bytes)) = self.db.get_cf(cf, Self::rtx_key(evict)) {
                if let Ok(old) = bincode::deserialize::<RecentTxRecord>(&bytes) {
                    let _ = self.db.delete_cf(cf, Self::rtx_hash_key(&old.hash));
                }
            }
            let _ = self.db.delete_cf(cf, Self::rtx_key(evict));
        }
        self.db.put_cf(cf, META_RTX_SEQ, (next + 1).to_be_bytes())?;
        Ok(())
    }

    /// Phase C.2.1 — Resolve a 32-byte tx hash to its `RecentTxRecord` via the
    /// secondary hash index. Falls back to a linear scan over the ring buffer
    /// for legacy entries written before the secondary index existed.
    /// Returns `None` if the tx is not in the rolling window of the last
    /// `RECENT_TX_CAP` (1000) committed transactions.
    pub fn find_tx_by_hash(&self, hash: &[u8; 32]) -> Option<RecentTxRecord> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        // Fast path — secondary index lookup.
        if let Ok(Some(seq_bytes)) = self.db.get_cf(cf, Self::rtx_hash_key(hash)) {
            if seq_bytes.len() == 8 {
                let mut a = [0u8; 8];
                a.copy_from_slice(&seq_bytes);
                let seq = u64::from_be_bytes(a);
                if let Ok(Some(bytes)) = self.db.get_cf(cf, Self::rtx_key(seq)) {
                    if let Ok(rec) = bincode::deserialize::<RecentTxRecord>(&bytes) {
                        // Guard against a stale index pointing at an evicted seq.
                        if rec.hash == *hash {
                            return Some(rec);
                        }
                    }
                }
            }
        }
        // Slow path — linear scan over the ring (handles pre-index legacy txs).
        for r in self.recent_txs(RECENT_TX_CAP as usize) {
            if r.hash == *hash {
                return Some(r);
            }
        }
        None
    }

    /// Phase C.2.1 — height → block hash, used by ZVM RPC handlers when they
    /// need to populate `blockHash` in `eth_getTransactionByHash` /
    /// `eth_getTransactionReceipt` JSON responses. Returns `None` if the
    /// height is above tip or below pruning horizon.
    pub fn block_hash_at(&self, height: u64) -> Option<Hash> {
        self.block_at(height).map(|b| block_hash(&b.header))
    }

    /// Total number of transactions ever indexed in the ring buffer (monotonic).
    /// May be larger than the actual stored count once eviction kicks in.
    pub fn recent_tx_total(&self) -> u64 {
        self.rtx_next_seq()
    }

    /// Fetch the most recent `limit` transactions, newest first. Cap is
    /// `RECENT_TX_CAP` (1000). Returns `[]` if the ring is empty.
    ///
    /// O(limit) RocksDB point lookups — no block-scan required. Designed for
    /// dashboards/wallets that previously had to scan thousands of blocks.
    pub fn recent_txs(&self, limit: usize) -> Vec<RecentTxRecord> {
        let next = self.rtx_next_seq();
        if next == 0 || limit == 0 { return Vec::new(); }
        let cap = (RECENT_TX_CAP as usize).min(limit);
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut out = Vec::with_capacity(cap);
        let oldest_kept = next.saturating_sub(RECENT_TX_CAP);
        let stop = next.saturating_sub(cap as u64).max(oldest_kept);
        let mut seq = next - 1;
        loop {
            if let Some(bytes) = self.db.get_cf(cf, Self::rtx_key(seq)).ok().flatten() {
                if let Ok(r) = bincode::deserialize::<RecentTxRecord>(&bytes) {
                    out.push(r);
                }
            }
            if seq == stop { break; }
            if seq == 0 { break; }
            seq -= 1;
        }
        out
    }

    pub fn apply_block(&self, block: &Block) -> Result<()> {
        // ── SECURITY: in-process fail-loud guard ──
        // If a previous apply_block aborted with an error, the
        // META_BLOCK_APPLYING marker is intentionally LEFT SET so the
        // next process startup refuses to boot until the operator runs
        // the recovery procedure. Without this guard, the next in-process
        // apply_block call would simply overwrite the marker at
        // set_block_applying_marker() below, defeating the guarantee.
        // Refuse here too: any caller (consensus producer, p2p delivery)
        // that keeps running after a fatal apply_block error will
        // continue to receive errors instead of silently committing
        // potentially-inconsistent follow-up blocks.
        if let Some((stuck_h, stuck_hash)) = self.read_block_applying_marker() {
            let (tip_h, tip_hash) = self.tip();
            if !(tip_h >= stuck_h && tip_hash == stuck_hash) {
                return Err(anyhow!(
                    "🛑 ABORT: apply_block refusing to run — stuck apply-marker for #{stuck_h} ({stuck_hash}). \
                     Tip is #{tip_h} ({tip_hash}). A previous apply_block aborted mid-flight. \
                     Operator action required: stop the node and follow the startup recovery \
                     procedure (restore from snapshot or manually clear META_BLOCK_APPLYING in RocksDB)."
                ));
            }
            // Marker matches the committed tip — stale leftover, safe to clear and proceed.
            tracing::warn!(
                "apply_block: clearing stale apply-marker for #{stuck_h} (already at tip)"
            );
            self.clear_block_applying_marker()?;
        }

        let (h, last) = self.tip();
        if block.header.height != h + 1 {
            return Err(anyhow!("non-contiguous height: tip {h} got {}", block.header.height));
        }
        if block.header.parent_hash != last {
            return Err(anyhow!("parent hash mismatch"));
        }

        // ── SECURITY: proposer signature + validator-set membership check ──
        // Without this, ANY peer can forge blocks claiming arbitrary proposer
        // identity and have them applied as long as tx signatures are valid.
        // We verify (a) proposer is currently in the validator set and (b)
        // the block.signature is a valid ECDSA-secp256k1 signature over the
        // header bytes by that validator's pubkey. This single check makes
        // forged blocks impossible regardless of how many validators exist
        // (works correctly with N=1 too).
        let proposer_validator = self.get_validator(&block.header.proposer)
            .ok_or_else(|| anyhow!(
                "block #{}: proposer {} is NOT in validator set — block forgery attempt rejected",
                block.header.height, block.header.proposer
            ))?;
        if !verify_signature(
            &proposer_validator.pubkey,
            &header_signing_bytes(&block.header),
            &block.signature,
        ) {
            return Err(anyhow!(
                "block #{}: proposer signature INVALID — block forgery attempt rejected",
                block.header.height
            ));
        }

        // Phase B.12 — expose block timestamp to apply_tx (Bridge arm reads it).
        self.current_block_ts_ms.store(block.header.timestamp_ms, Ordering::SeqCst);
        if block.txs.len() >= 4 {
            if !verify_txs_batch(&block.txs) {
                return Err(anyhow!("bad tx signature in block (batch verify failed)"));
            }
        } else {
            for tx in &block.txs {
                if !verify_tx(tx) {
                    return Err(anyhow!("bad tx signature: {}", tx_hash(tx)));
                }
            }
        }

        // ── SECURITY: pre-validation pass (sig already done above) ──
        // Walk every tx with a SIMULATED nonce + balance map (no disk
        // mutation) and confirm each tx will not be rejected at apply_tx
        // for nonce / fee-bound / insufficient-balance reasons. If ANY tx
        // would fail, reject the WHOLE block here — never mutate state
        // partially. This is our defense against C-2 style mid-block
        // crashes leaving partial state.
        //
        // Kind-specific authorization checks (governor for ValidatorAdd,
        // creator for TokenMint, etc.) are NOT replicated here. If
        // apply_tx fails on those at runtime, the block is aborted with
        // the crash-safety marker LEFT SET so startup refuses to boot
        // until the operator investigates (see runtime loop below). On
        // a healthy chain the proposer's own mempool simulates these
        // checks before block-build, so this path should never fire on
        // honest validators — its presence in a delivered block flags
        // proposer misbehaviour or a chain bug.
        {
            let pool = self.pool();
            let (min_fee_wei, max_fee_wei) = crate::pool::fee_bounds_wei(
                &pool,
                crate::tokenomics::MIN_FEE_USD_MICRO,
                crate::tokenomics::MAX_FEE_USD_MICRO,
                crate::tokenomics::BOOTSTRAP_MIN_FEE_WEI,
                crate::tokenomics::BOOTSTRAP_MAX_FEE_WEI,
            );
            // Per-sender simulated state: (next_nonce, balance_remaining).
            let mut sim: std::collections::HashMap<Address, (u64, u128)> =
                std::collections::HashMap::new();
            for (idx, tx) in block.txs.iter().enumerate() {
                if tx.body.fee < min_fee_wei || tx.body.fee > max_fee_wei {
                    return Err(anyhow!(
                        "block #{}: tx[{idx}] fee {} out of dynamic bounds [{}, {}]",
                        block.header.height, tx.body.fee, min_fee_wei, max_fee_wei
                    ));
                }
                let entry = sim.entry(tx.body.from).or_insert_with(|| {
                    let acc = self.account(&tx.body.from);
                    (acc.nonce, acc.balance)
                });
                if entry.0 != tx.body.nonce {
                    return Err(anyhow!(
                        "block #{}: tx[{idx}] from {} bad nonce: simulated {}, got {}",
                        block.header.height, tx.body.from, entry.0, tx.body.nonce
                    ));
                }
                // For Swap ZusdToZbx, only fee comes from balance (amount is in
                // zUSD, separate ledger). Mirror apply_tx's pre_debit logic.
                let pre_debit = match &tx.body.kind {
                    crate::types::TxKind::Swap {
                        direction: crate::transaction::SwapDirection::ZusdToZbx, ..
                    } => tx.body.fee,
                    _ => tx.body.amount.checked_add(tx.body.fee).ok_or_else(|| anyhow!(
                        "block #{}: tx[{idx}] amount+fee overflow", block.header.height
                    ))?,
                };
                if entry.1 < pre_debit {
                    return Err(anyhow!(
                        "block #{}: tx[{idx}] from {} insufficient balance: have {}, need {}",
                        block.header.height, tx.body.from, entry.1, pre_debit
                    ));
                }
                entry.0 += 1;
                entry.1 -= pre_debit;
            }
        }

        // ── Phase B.3.3 — state-root verification (Tendermint AppHash style) ──
        // Convention: header.state_root commits to the state AFTER applying
        // block H-1 (i.e., the parent's post-state == our current state right
        // now, BEFORE applying this block's txs). We verify this BEFORE
        // applying any txs so a bad root short-circuits without mutating
        // anything. Activation is gated by `STATE_ROOT_ACTIVATION_HEIGHT`
        // (env-driven, default = u64::MAX = disabled) so existing chains keep
        // accepting ZERO-root blocks until operators coordinate an upgrade.
        if block.header.height >= *STATE_ROOT_ACTIVATION_HEIGHT {
            let computed = self.compute_state_root();
            if block.header.state_root != computed {
                return Err(anyhow!(
                    "state_root mismatch at h={}: header={} computed={}",
                    block.header.height,
                    block.header.state_root,
                    computed,
                ));
            }
        }

        // ── SECURITY: write crash-safety marker BEFORE any state mutation ──
        // If the process dies between this and the marker-clear at the end,
        // the next startup will detect a stuck marker and refuse to launch.
        // This converts silent corruption into a loud failure that can be
        // investigated by the operator.
        self.set_block_applying_marker(block.header.height, &block_hash(&block.header))?;

        let mut total_fees: u128 = 0;
        for tx in &block.txs {
            // SECURITY (audit follow-up): per-tx errors are FATAL to the
            // whole block. Pre-validation above already filters nonce /
            // balance / fee-bound rejections. If apply_tx still errors,
            // it indicates either a kind-specific authorization failure
            // (which the proposer's own mempool should have caught — its
            // presence here suggests proposer misbehaviour or bug) or a
            // genuine storage / internal error. Either way we MUST NOT
            // silently swallow it: not all apply_tx arms have a clean
            // refund pattern (some do partial writes before failing with
            // `?`), so continuing risks committing half-applied state.
            //
            // We deliberately do NOT clear META_BLOCK_APPLYING here. The
            // marker stays set so the next startup refuses to boot until
            // the operator investigates and runs the recovery procedure
            // documented in replit.md.
            let tx_h = tx_hash(tx);
            self.apply_tx(tx).map_err(|e| anyhow!(
                "block #{}: tx {} apply failed (marker LEFT SET — operator action required): {e}",
                block.header.height, tx_h
            ))?;
            total_fees = total_fees.saturating_add(tx.body.fee);
            // Phase B.9 — index this tx into the recent-tx ring buffer.
            // SECURITY: index failure now FAILS the block (was previously
            // logged silently which let state and index diverge — H-8).
            // Same marker-leak rule as above: do NOT clear the marker on
            // failure so startup will catch the partial application.
            let kind_index = tx.body.kind.tag_index();
            let rec = RecentTxRecord {
                seq: 0, // overwritten by push_recent_tx
                height: block.header.height,
                timestamp_ms: block.header.timestamp_ms,
                hash: tx_h.0,
                from: tx.body.from,
                to: tx.body.to,
                amount: tx.body.amount,
                fee: tx.body.fee,
                nonce: tx.body.nonce,
                kind_index,
            };
            self.push_recent_tx(rec).map_err(|e| anyhow!(
                "block #{}: recent-tx index push failed (marker LEFT SET — operator action required): {e}",
                block.header.height
            ))?;
        }
        // ── Phase B.6: per-block mint accumulates in REWARDS_POOL ──
        // The 3 ZBX (or current halving value) flows into a holding address
        // instead of going straight to the proposer. Every
        // REWARDS_DISTRIBUTION_INTERVAL blocks the pool is drained and split
        // (5% commission liquid + 95% locked stake-prop) by the staking module.
        let reward = reward_at_height(block.header.height);
        if reward > 0 {
            let pool_addr = rewards_pool_address();
            let mut pool = self.account(&pool_addr);
            pool.balance = pool.balance.saturating_add(reward);
            self.put_account(&pool_addr, &pool)?;
        }

        // ── Phase B.5: redistribute aggregated gas fees (50/20/20/10) ─────────
        if total_fees > 0 {
            self.redistribute_gas_fees(&block.header.proposer, total_fees)?;
        }

        // ── Phase B.6: distribute REWARDS_POOL every 100 blocks ──
        if block.header.height > 0
            && block.header.height % crate::tokenomics::REWARDS_DISTRIBUTION_INTERVAL == 0
        {
            let pool_addr = rewards_pool_address();
            let mut pool = self.account(&pool_addr);
            let pool_amount = pool.balance;
            if pool_amount > 0 {
                pool.balance = 0;
                self.put_account(&pool_addr, &pool)?;
                let founder = treasury_address();
                let mut sm = self.staking();
                let (commissions, liquid_credits, locked_total) = sm.distribute_pool_rewards(
                    block.header.height,
                    pool_amount,
                    crate::tokenomics::REWARDS_COMMISSION_BPS,
                    founder,
                );
                self.put_staking(&sm)?;
                let mut total_commission: u128 = 0;
                for (operator, amt) in &commissions {
                    let mut op = self.account(operator);
                    op.balance = op.balance.saturating_add(*amt);
                    self.put_account(operator, &op)?;
                    total_commission = total_commission.saturating_add(*amt);
                }
                let mut founder_liquid: u128 = 0;
                for (addr, amt) in &liquid_credits {
                    let mut a = self.account(addr);
                    a.balance = a.balance.saturating_add(*amt);
                    self.put_account(addr, &a)?;
                    founder_liquid = founder_liquid.saturating_add(*amt);
                }
                tracing::info!(
                    "💰 dist-pool @h={} drained {} wei → commission {} wei ({} ops) | founder-liquid {} wei | locked {} wei",
                    block.header.height, pool_amount, total_commission, commissions.len(), founder_liquid, locked_total,
                );
            }
        }

        // ── Phase B.5: epoch boundary — locked-rewards distribution + matured unbondings ──
        if block.header.height > 0
            && block.header.height % crate::staking::EPOCH_BLOCKS == 0
        {
            // Detect Phase A vs Phase B (strict AND of validator + delegator thresholds).
            let mut sm = self.staking();
            let n_validators = sm.validators.values().filter(|v| !v.jailed).count();
            let n_delegators: std::collections::BTreeSet<Address> =
                sm.delegations.iter().map(|((d, _), _)| *d).collect();
            let in_phase_b =
                n_validators >= BOOTSTRAP_VAL_THRESHOLD && n_delegators.len() >= BOOTSTRAP_DEL_THRESHOLD;
            let cut_bps = if in_phase_b {
                TREASURY_CUT_BPS_PHASE_B
            } else {
                TREASURY_CUT_BPS_PHASE_A
            };
            // Phase B.6: epoch reward is 0 — all mint flows via REWARDS_POOL
            // (distributed every 100 blocks). Epoch boundary is still used to
            // mature the unbonding queue.
            let _ = cut_bps; // silence unused (kept for future Phase B re-enable)
            let result = sm.end_epoch_locked(block.header.height, 0, 0);
            // Credit liquid: matured unbondings.
            let mut total_unbond_paid: u128 = 0;
            let unbond_count = result.unbonding_payout.len();
            for (addr, amt) in &result.unbonding_payout {
                let mut acc = self.account(addr);
                acc.balance = acc.balance.saturating_add(*amt);
                self.put_account(addr, &acc)?;
                total_unbond_paid = total_unbond_paid.saturating_add(*amt);
            }
            // Credit liquid: founder treasury.
            if result.treasury_payout > 0 {
                let t_addr = treasury_address();
                let mut t = self.account(&t_addr);
                t.balance = t.balance.saturating_add(result.treasury_payout);
                self.put_account(&t_addr, &t)?;
            }
            self.put_staking(&sm)?;
            tracing::info!(
                "✅ epoch {} ended @h={} | phase={} | treasury+={} wei | locked+={} wei | matured {} unbond ({} wei)",
                sm.current_epoch,
                block.header.height,
                if in_phase_b { "B" } else { "A" },
                result.treasury_payout,
                result.locked_deposited,
                unbond_count,
                total_unbond_paid,
            );
        }

        // ── Phase D — tick governance proposals ──
        // Advances Testing → Voting (at +14 d), Voting → Approved/Rejected (at
        // +90 d), and Approved → Activated (apply state effect). Runs once per
        // block; failure here is logged but non-fatal so a stuck proposal can
        // never halt block production.
        if let Err(e) = self.tick_proposals(block.header.height) {
            tracing::warn!("proposal tick failed (non-fatal): {e}");
        }

        let cf_b = self.db.cf_handle(CF_BLOCKS).unwrap();
        let cf_m = self.db.cf_handle(CF_META).unwrap();
        let key = block.header.height.to_be_bytes();
        self.db.put_cf(cf_b, key, bincode::serialize(block)?)?;
        let bh = block_hash(&block.header);
        self.db.put_cf(cf_m, META_HEIGHT, key)?;
        self.db.put_cf(cf_m, META_LAST_HASH, bh.0)?;
        *self.tip.write() = (block.header.height, bh);
        // SECURITY: clear crash-safety marker — block fully committed.
        self.clear_block_applying_marker()?;
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────
    // Crash-safety marker — apply_block intent log
    // ────────────────────────────────────────────────────────────────────

    /// Persist a marker indicating that apply_block is mid-flight for the
    /// given (height, hash). Cleared on successful commit. If a process
    /// dies between these two writes, startup detects the stuck marker.
    pub fn set_block_applying_marker(&self, height: u64, hash: &Hash) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut buf = Vec::with_capacity(40);
        buf.extend_from_slice(&height.to_be_bytes());
        buf.extend_from_slice(&hash.0);
        self.db.put_cf(cf, META_BLOCK_APPLYING, buf)?;
        Ok(())
    }

    /// Clear the apply-in-flight marker (called on successful block commit).
    pub fn clear_block_applying_marker(&self) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.delete_cf(cf, META_BLOCK_APPLYING)?;
        Ok(())
    }

    /// Read the marker, if present. Returns (height, hash) of the in-flight
    /// block. Used at startup to detect a crashed mid-block apply.
    pub fn read_block_applying_marker(&self) -> Option<(u64, Hash)> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let raw = self.db.get_cf(cf, META_BLOCK_APPLYING).ok().flatten()?;
        if raw.len() != 40 {
            return None;
        }
        let mut h_bytes = [0u8; 8];
        h_bytes.copy_from_slice(&raw[..8]);
        let mut hash_bytes = [0u8; 32];
        hash_bytes.copy_from_slice(&raw[8..]);
        Some((u64::from_be_bytes(h_bytes), Hash(hash_bytes)))
    }

    // ────────────────────────────────────────────────────────────────────
    // Phase E — User-creatable fungible tokens (storage helpers)
    // ────────────────────────────────────────────────────────────────────

    fn token_count(&self) -> u64 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        match self.db.get_cf(cf, META_TOKEN_COUNT).ok().flatten() {
            Some(v) if v.len() == 8 => {
                let mut b = [0u8; 8];
                b.copy_from_slice(&v);
                u64::from_be_bytes(b)
            }
            _ => 0,
        }
    }

    fn put_token_count(&self, n: u64) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, META_TOKEN_COUNT, n.to_be_bytes())?;
        Ok(())
    }

    fn token_key(id: u64) -> Vec<u8> {
        let mut k = META_TOKEN_PREFIX.to_vec();
        k.extend_from_slice(&id.to_be_bytes());
        k
    }

    fn token_balance_key(id: u64, addr: &Address) -> Vec<u8> {
        let mut k = META_TOKEN_BAL_PREFIX.to_vec();
        k.extend_from_slice(&id.to_be_bytes());
        k.extend_from_slice(&addr.0);
        k
    }

    fn token_symbol_key(symbol_lc: &str) -> Vec<u8> {
        let mut k = META_TOKEN_SYMBOL_PREFIX.to_vec();
        k.extend_from_slice(symbol_lc.as_bytes());
        k
    }

    /// Look up a token by its id.
    pub fn get_token(&self, id: u64) -> Option<TokenInfo> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let raw = self.db.get_cf(cf, Self::token_key(id)).ok().flatten()?;
        bincode::deserialize::<TokenInfo>(&raw).ok()
    }

    /// Look up a token by symbol (case-insensitive).
    pub fn get_token_by_symbol(&self, symbol: &str) -> Option<TokenInfo> {
        let lc = symbol.to_ascii_lowercase();
        let cf = self.db.cf_handle(CF_META).unwrap();
        let raw = self.db.get_cf(cf, Self::token_symbol_key(&lc)).ok().flatten()?;
        if raw.len() != 8 {
            return None;
        }
        let mut b = [0u8; 8];
        b.copy_from_slice(&raw);
        let id = u64::from_be_bytes(b);
        self.get_token(id)
    }

    fn put_token(&self, info: &TokenInfo) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::token_key(info.id), bincode::serialize(info)?)?;
        Ok(())
    }

    /// Read a holder's balance of a given token (0 if no entry).
    pub fn token_balance_of(&self, id: u64, addr: &Address) -> u128 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        match self.db.get_cf(cf, Self::token_balance_key(id, addr)).ok().flatten() {
            Some(v) if v.len() == 16 => {
                let mut b = [0u8; 16];
                b.copy_from_slice(&v);
                u128::from_be_bytes(b)
            }
            _ => 0,
        }
    }

    fn put_token_balance(&self, id: u64, addr: &Address, bal: u128) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let k = Self::token_balance_key(id, addr);
        if bal == 0 {
            // Save space — delete zero-balance entries.
            self.db.delete_cf(cf, k)?;
        } else {
            self.db.put_cf(cf, k, bal.to_be_bytes())?;
        }
        Ok(())
    }

    fn put_token_symbol(&self, symbol_lc: &str, id: u64) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::token_symbol_key(symbol_lc), id.to_be_bytes())?;
        Ok(())
    }

    /// Paginated list of all tokens (oldest-first by id).
    pub fn list_tokens(&self, offset: u64, limit: u64) -> Vec<TokenInfo> {
        let total = self.token_count();
        if offset >= total {
            return Vec::new();
        }
        let end = offset.saturating_add(limit).min(total);
        let mut out = Vec::with_capacity((end - offset) as usize);
        // ids are 1-based
        for id in (offset + 1)..=end {
            if let Some(t) = self.get_token(id) {
                out.push(t);
            }
        }
        out
    }

    /// Total number of tokens ever created.
    pub fn total_token_count(&self) -> u64 { self.token_count() }
}

// ────────────────────────────────────────────────────────────────────
// Phase E — TokenInfo persisted record
// ────────────────────────────────────────────────────────────────────
//
// Stored under META_TOKEN_PREFIX. **Field order is consensus-critical**
// (bincode is positional). Existing fields must NEVER be reordered;
// new fields may be appended for non-breaking upgrades.

/// Persisted record describing a user-created fungible token.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TokenInfo {
    /// Unique 1-based id assigned at creation.
    pub id: u64,
    /// Original creator address (only address authorized to `Mint`).
    pub creator: Address,
    /// Display name (1-50 chars, UTF-8).
    pub name: String,
    /// Trading symbol (2-10 chars, [A-Z0-9], case-preserved on display
    /// but uniqueness checked case-insensitively).
    pub symbol: String,
    /// Decimal places (0-18, mirrors ERC-20).
    pub decimals: u8,
    /// Current total supply across all holders.
    pub total_supply: u128,
    /// Block height at which the token was created (for audit + UI).
    pub created_at_height: u64,
}

impl State {

    // ───────────────────── Phase D — Governance proposals & feature flags ─────────────────────
    //
    // All keys live in CF_META under stable prefixes:
    //   prop/<id_be8>             → bincode(Proposal)
    //   prop_vote/<id_be8><a20>   → 1 byte (1 = yes, 0 = no)
    //   prop_active/<a20><id_be8> → 1 byte marker (proposer's open proposals)
    //   prop_count                → u64 BE next id (1-based)
    //   ff/<key>                  → 16-byte u128 BE (feature flag value)
    //   ff_label/<key>            → bincode((Address, String, u64 height))

    fn prop_key(id: u64) -> Vec<u8> {
        let mut k = b"prop/".to_vec();
        k.extend_from_slice(&id.to_be_bytes());
        k
    }
    fn prop_vote_key(id: u64, voter: &Address) -> Vec<u8> {
        let mut k = b"prop_vote/".to_vec();
        k.extend_from_slice(&id.to_be_bytes());
        k.extend_from_slice(&voter.0);
        k
    }
    fn prop_active_key(proposer: &Address, id: u64) -> Vec<u8> {
        let mut k = b"prop_active/".to_vec();
        k.extend_from_slice(&proposer.0);
        k.extend_from_slice(&id.to_be_bytes());
        k
    }
    fn ff_key(key: &str) -> Vec<u8> {
        let mut k = b"ff/".to_vec();
        k.extend_from_slice(key.as_bytes());
        k
    }
    fn ff_label_key(key: &str) -> Vec<u8> {
        let mut k = b"ff_label/".to_vec();
        k.extend_from_slice(key.as_bytes());
        k
    }

    /// Allocate the next sequential proposal id (1-based, monotonic). Persists
    /// the new counter atomically before returning so two parallel callers
    /// can't collide.
    pub fn next_proposal_id(&self) -> Result<u64> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let cur = self.db.get_cf(cf, b"prop_count").ok().flatten()
            .map(|b| {
                let mut a = [0u8; 8];
                if b.len() == 8 { a.copy_from_slice(&b); }
                u64::from_be_bytes(a)
            }).unwrap_or(0);
        let next = cur + 1;
        self.db.put_cf(cf, b"prop_count", next.to_be_bytes())?;
        Ok(next)
    }

    pub fn put_proposal(&self, p: &crate::proposal::Proposal) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::prop_key(p.id), bincode::serialize(p)?)?;
        Ok(())
    }

    pub fn get_proposal(&self, id: u64) -> Option<crate::proposal::Proposal> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::prop_key(id)).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
    }

    /// All proposals, sorted ascending by id.
    pub fn list_proposals(&self) -> Vec<crate::proposal::Proposal> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut out: Vec<crate::proposal::Proposal> = Vec::new();
        let prefix: &[u8] = b"prop/";
        let it = self.db.prefix_iterator_cf(cf, prefix);
        for item in it {
            let Ok((k, v)) = item else { continue };
            // Defensive: prefix iter may overshoot OR overlap prop_vote/ /
            // prop_active/ (same `prop` prefix prefix). We only want `prop/`
            // exact prefix + 8-byte id suffix.
            if !k.starts_with(prefix) { break; }
            if k.len() != prefix.len() + 8 { continue; }
            if let Ok(p) = bincode::deserialize::<crate::proposal::Proposal>(&v) {
                out.push(p);
            }
        }
        out.sort_by_key(|p| p.id);
        out
    }

    /// Newest-first slice of proposals (cheap: scan + sort + truncate).
    pub fn list_proposals_recent(&self, limit: usize) -> Vec<crate::proposal::Proposal> {
        let mut all = self.list_proposals();
        all.sort_by(|a, b| b.id.cmp(&a.id));
        all.truncate(limit);
        all
    }

    pub fn has_voted(&self, id: u64, voter: &Address) -> bool {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::prop_vote_key(id, voter)).ok().flatten().is_some()
    }

    pub fn put_vote(&self, id: u64, voter: &Address, yes: bool) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::prop_vote_key(id, voter), [if yes { 1u8 } else { 0u8 }])?;
        Ok(())
    }

    /// Counts how many open (Testing or Voting) proposals were submitted by
    /// `proposer`. Marker entries for terminated proposals are tolerated
    /// (skipped via status check) and pruned by `tick_proposals`.
    pub fn count_active_proposals_by(&self, proposer: &Address) -> u64 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut prefix = b"prop_active/".to_vec();
        prefix.extend_from_slice(&proposer.0);
        let it = self.db.prefix_iterator_cf(cf, &prefix);
        let mut count = 0u64;
        for item in it {
            let Ok((k, _)) = item else { continue };
            if !k.starts_with(&prefix) { break; }
            if k.len() != prefix.len() + 8 { continue; }
            let mut id_bytes = [0u8; 8];
            id_bytes.copy_from_slice(&k[prefix.len()..]);
            let id = u64::from_be_bytes(id_bytes);
            if let Some(p) = self.get_proposal(id) {
                if p.status.is_active() {
                    count += 1;
                }
            }
        }
        count
    }

    pub fn put_active_marker(&self, proposer: &Address, id: u64) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::prop_active_key(proposer, id), [1u8])?;
        Ok(())
    }

    fn delete_active_marker(&self, proposer: &Address, id: u64) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.delete_cf(cf, Self::prop_active_key(proposer, id))?;
        Ok(())
    }

    pub fn get_feature_flag(&self, key: &str) -> Option<u128> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::ff_key(key)).ok().flatten().and_then(|b| {
            if b.len() == 16 {
                let mut a = [0u8; 16];
                a.copy_from_slice(&b);
                Some(u128::from_be_bytes(a))
            } else {
                None
            }
        })
    }

    pub fn set_feature_flag(&self, key: &str, value: u128) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::ff_key(key), value.to_be_bytes())?;
        Ok(())
    }

    /// True iff the named flag is set to a non-zero value. Convenience wrapper
    /// for runtime code that only cares about the boolean view.
    pub fn feature_flag_enabled(&self, key: &str) -> bool {
        self.get_feature_flag(key).map(|v| v != 0).unwrap_or(false)
    }

    /// All feature flags, sorted by key.
    pub fn list_feature_flags(&self) -> Vec<(String, u128)> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let prefix: &[u8] = b"ff/";
        let mut out = Vec::new();
        let it = self.db.prefix_iterator_cf(cf, prefix);
        for item in it {
            let Ok((k, v)) = item else { continue };
            if !k.starts_with(prefix) { break; }
            // Defensive: skip ff_label/ entries (overlap on `ff` prefix).
            let key_bytes = &k[prefix.len()..];
            if key_bytes.starts_with(b"label/") { continue; }
            if let Ok(ks) = std::str::from_utf8(key_bytes) {
                if v.len() == 16 {
                    let mut a = [0u8; 16];
                    a.copy_from_slice(&v);
                    out.push((ks.to_string(), u128::from_be_bytes(a)));
                }
            }
        }
        out.sort();
        out
    }

    /// Persist the contract metadata for a `ContractWhitelist`-kind activation.
    pub fn put_contract_label(&self, key: &str, addr: &Address, label: &str, height: u64)
        -> Result<()>
    {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let payload = bincode::serialize(&(*addr, label.to_string(), height))?;
        self.db.put_cf(cf, Self::ff_label_key(key), payload)?;
        Ok(())
    }

    pub fn get_contract_label(&self, key: &str) -> Option<(Address, String, u64)> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::ff_label_key(key)).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
    }

    /// Tick all active proposals at `height`. Advances Testing→Voting at
    /// `voting_starts_at_height`, Voting→Approved/Rejected at
    /// `voting_ends_at_height`, then Approved→Activated (applying the
    /// state effect immediately). Errors per-proposal are logged but do
    /// NOT halt the loop — a single bad proposal can never freeze the
    /// chain.
    pub fn tick_proposals(&self, height: u64) -> Result<()> {
        use crate::proposal::{ProposalKind, ProposalStatus, MIN_QUORUM_VOTES};

        let proposals = self.list_proposals();
        for mut p in proposals {
            // Skip terminated proposals; only Approved is re-checked because we
            // collapse Approved → Activated in the same tick.
            if p.status.is_terminal() { continue; }

            let mut changed = false;

            if p.status == ProposalStatus::Testing && height >= p.voting_starts_at_height {
                p.status = ProposalStatus::Voting;
                changed = true;
                tracing::info!("🗳️  proposal id={} test→vote phase @h={}", p.id, height);
            }

            if p.status == ProposalStatus::Voting && height >= p.voting_ends_at_height {
                if p.meets_pass_criteria() {
                    p.status = ProposalStatus::Approved;
                    tracing::info!(
                        "🗳️  proposal id={} APPROVED @h={} yes={} no={} pct={:.2}%",
                        p.id, height, p.yes_votes, p.no_votes,
                        p.pass_pct_bps() as f64 / 100.0
                    );
                } else {
                    p.status = ProposalStatus::Rejected;
                    if let Err(e) = self.delete_active_marker(&p.proposer, p.id) {
                        tracing::warn!("active-marker delete failed (non-fatal): {e}");
                    }
                    tracing::info!(
                        "🗳️  proposal id={} REJECTED @h={} yes={} no={} pct={:.2}% (quorum={})",
                        p.id, height, p.yes_votes, p.no_votes,
                        p.pass_pct_bps() as f64 / 100.0, MIN_QUORUM_VOTES
                    );
                }
                changed = true;
            }

            if p.status == ProposalStatus::Approved {
                // Apply the on-chain effect.
                let apply_result: Result<()> = match &p.kind {
                    ProposalKind::FeatureFlag { key, enabled } => {
                        self.set_feature_flag(key, if *enabled { 1 } else { 0 })
                    }
                    ProposalKind::ParamChange { param, new_value } => {
                        self.set_feature_flag(param, *new_value)
                    }
                    ProposalKind::ContractWhitelist { key, address, label } => {
                        self.set_feature_flag(key, 1)
                            .and_then(|_| self.put_contract_label(key, address, label, height))
                    }
                    ProposalKind::TextOnly => Ok(()),
                };
                if let Err(e) = apply_result {
                    tracing::warn!(
                        "proposal id={} activation failed (will retry next tick): {e}", p.id
                    );
                    // Persist the Approved status so the next tick re-enters
                    // this branch directly (instead of re-tallying from Voting),
                    // then move on. We swallow a persist error here only to
                    // log — the next tick will retry both persistence and
                    // activation.
                    if changed {
                        if let Err(pe) = self.put_proposal(&p) {
                            tracing::warn!(
                                "proposal id={} approved-state persist failed (non-fatal, will retry): {pe}", p.id
                            );
                        }
                    }
                    continue; // leave status as Approved, retry next block
                }
                p.status = ProposalStatus::Activated;
                p.activated_at_height = Some(height);
                if let Err(e) = self.delete_active_marker(&p.proposer, p.id) {
                    tracing::warn!("active-marker delete failed (non-fatal): {e}");
                }
                tracing::info!(
                    "🗳️  proposal id={} ACTIVATED @h={} kind={}",
                    p.id, height, p.kind.variant_label()
                );
                changed = true;
            }

            if changed {
                self.put_proposal(&p)?;
            }
        }
        Ok(())
    }

    // ───────── Phase B.1: Validator set on-chain ─────────
    //
    // The validator set is persisted in CF_META under the `validator/<addr>` prefix.
    // Phase B.1 only provides storage + query + admin-gated mutation. The block
    // producer still operates in single-validator PoA mode. Phase B.2 introduces
    // vote messages; Phase B.3 wires Tendermint-style 2/3+ quorum into commit.

    fn validator_key(addr: &Address) -> Vec<u8> {
        let mut k = META_VALIDATOR_PREFIX.to_vec();
        k.extend_from_slice(&addr.0);
        k
    }

    /// Insert or overwrite a validator. `voting_power` must be > 0.
    pub fn put_validator(&self, v: &Validator) -> Result<()> {
        if v.voting_power == 0 {
            return Err(anyhow!("voting_power must be > 0 (use remove_validator to delete)"));
        }
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::validator_key(&v.address), bincode::serialize(v)?)?;
        Ok(())
    }

    /// Remove a validator from the set. Returns true if it existed.
    pub fn remove_validator(&self, addr: &Address) -> Result<bool> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let key = Self::validator_key(addr);
        let existed = self.db.get_cf(cf, &key)?.is_some();
        self.db.delete_cf(cf, &key)?;
        Ok(existed)
    }

    /// Look up a single validator by address.
    pub fn get_validator(&self, addr: &Address) -> Option<Validator> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, Self::validator_key(addr)).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
    }

    /// Return the full active validator set, sorted by address (deterministic).
    pub fn validators(&self) -> Vec<Validator> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut out = Vec::new();
        let iter = self.db.prefix_iterator_cf(cf, META_VALIDATOR_PREFIX);
        for item in iter {
            let Ok((k, v)) = item else { continue };
            // Defensive: prefix_iterator may overshoot the prefix; check bounds.
            if !k.starts_with(META_VALIDATOR_PREFIX) { break; }
            if let Ok(val) = bincode::deserialize::<Validator>(&v) {
                out.push(val);
            }
        }
        out.sort_by_key(|v| v.address.0);
        out
    }

    // ───────────────────── Phase B.7 — Pay-ID registry ─────────────────────

    fn payid_key(canon: &str) -> Vec<u8> {
        let mut k = META_PAYID_PREFIX.to_vec();
        k.extend_from_slice(canon.as_bytes());
        k
    }

    fn payid_addr_key(addr: &Address) -> Vec<u8> {
        let mut k = META_PAYID_ADDR_PREFIX.to_vec();
        k.extend_from_slice(&addr.0);
        k
    }

    /// Atomically write both the forward (payid → addr) and reverse
    /// (addr → (payid, name)) indices. Caller must check uniqueness first.
    pub fn put_pay_id(&self, addr: &Address, canon: &str, name: &str) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::payid_key(canon), addr.0)?;
        let payload = bincode::serialize(&(canon.to_string(), name.to_string()))?;
        self.db.put_cf(cf, Self::payid_addr_key(addr), payload)?;
        Ok(())
    }

    /// Resolve `alice@zbx` → 20-byte address. None if not registered.
    pub fn get_address_by_payid(&self, canon: &str) -> Option<Address> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let raw = self.db.get_cf(cf, Self::payid_key(canon)).ok().flatten()?;
        if raw.len() != 20 { return None; }
        let mut a = [0u8; 20];
        a.copy_from_slice(&raw);
        Some(Address(a))
    }

    /// Reverse lookup: address → (pay_id, display_name). None if not registered.
    pub fn get_payid_by_address(&self, addr: &Address) -> Option<(String, String)> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let raw = self.db.get_cf(cf, Self::payid_addr_key(addr)).ok().flatten()?;
        bincode::deserialize::<(String, String)>(&raw).ok()
    }

    /// Total registered Pay-IDs (for stats/dashboards).
    pub fn pay_id_count(&self) -> usize {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut n = 0usize;
        for item in self.db.prefix_iterator_cf(cf, META_PAYID_PREFIX) {
            let Ok((k, _)) = item else { continue };
            if !k.starts_with(META_PAYID_PREFIX) { break; }
            n += 1;
        }
        n
    }

    // ───────────────────── Phase B.8 — Multisig wallets ─────────────────────

    fn ms_key(addr: &Address) -> Vec<u8> {
        let mut k = META_MS_PREFIX.to_vec();
        k.extend_from_slice(&addr.0);
        k
    }
    fn ms_proposal_key(multisig: &Address, id: u64) -> Vec<u8> {
        let mut k = META_MS_PROPOSAL_PREFIX.to_vec();
        k.extend_from_slice(&multisig.0);
        k.extend_from_slice(&id.to_be_bytes());
        k
    }
    fn ms_owner_key(owner: &Address, multisig: &Address) -> Vec<u8> {
        let mut k = META_MS_OWNER_PREFIX.to_vec();
        k.extend_from_slice(&owner.0);
        k.extend_from_slice(&multisig.0);
        k
    }

    pub fn put_multisig(&self, ms: &crate::multisig::MultisigAccount) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::ms_key(&ms.address), bincode::serialize(ms)?)?;
        for o in &ms.owners {
            self.db.put_cf(cf, Self::ms_owner_key(o, &ms.address), [1u8])?;
        }
        Ok(())
    }

    pub fn get_multisig(&self, addr: &Address) -> Option<crate::multisig::MultisigAccount> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let raw = self.db.get_cf(cf, Self::ms_key(addr)).ok().flatten()?;
        bincode::deserialize(&raw).ok()
    }

    pub fn put_ms_proposal(&self, p: &crate::multisig::MultisigProposal) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, Self::ms_proposal_key(&p.multisig, p.id), bincode::serialize(p)?)?;
        Ok(())
    }

    pub fn get_ms_proposal(&self, multisig: &Address, id: u64) -> Option<crate::multisig::MultisigProposal> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let raw = self.db.get_cf(cf, Self::ms_proposal_key(multisig, id)).ok().flatten()?;
        bincode::deserialize(&raw).ok()
    }

    /// List all proposals for a multisig (chronological by id).
    pub fn list_ms_proposals(&self, multisig: &Address) -> Vec<crate::multisig::MultisigProposal> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut prefix = META_MS_PROPOSAL_PREFIX.to_vec();
        prefix.extend_from_slice(&multisig.0);
        let mut out = Vec::new();
        for item in self.db.prefix_iterator_cf(cf, &prefix) {
            let Ok((k, v)) = item else { continue };
            if !k.starts_with(&prefix) { break; }
            if let Ok(p) = bincode::deserialize::<crate::multisig::MultisigProposal>(&v) {
                out.push(p);
            }
        }
        out.sort_by_key(|p| p.id);
        out
    }

    /// List multisig addresses an owner is a member of.
    pub fn list_ms_by_owner(&self, owner: &Address) -> Vec<Address> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut prefix = META_MS_OWNER_PREFIX.to_vec();
        prefix.extend_from_slice(&owner.0);
        let mut out = Vec::new();
        for item in self.db.prefix_iterator_cf(cf, &prefix) {
            let Ok((k, _)) = item else { continue };
            if !k.starts_with(&prefix) { break; }
            if k.len() == prefix.len() + 20 {
                let mut a = [0u8; 20];
                a.copy_from_slice(&k[prefix.len()..]);
                out.push(Address(a));
            }
        }
        out
    }

    pub fn multisig_count(&self) -> usize {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut n = 0usize;
        for item in self.db.prefix_iterator_cf(cf, META_MS_PREFIX) {
            let Ok((k, _)) = item else { continue };
            if !k.starts_with(META_MS_PREFIX) { break; }
            if k.len() == META_MS_PREFIX.len() + 20 { n += 1; }
        }
        n
    }

    /// Sum of all validator voting power. Used for 2/3+ quorum math.
    pub fn total_voting_power(&self) -> u64 {
        self.validators().iter().map(|v| v.voting_power).sum()
    }

    /// Quorum threshold: smallest N such that N > 2/3 * total. Returns 0 if no validators.
    pub fn quorum_threshold(&self) -> u64 {
        let total = self.total_voting_power();
        if total == 0 { 0 } else { (total * 2) / 3 + 1 }
    }

    /// Phase B.5 — split aggregated block gas fees:
    ///   50% → block proposer (validator) liquid
    ///   20% → proposer's delegators (stake-proportional) liquid
    ///   20% → admin treasury liquid
    ///   10% → burn address  (or AMM liquidity once `BURN_CAP_WEI` reached)
    /// If the proposer is NOT a registered staking validator (e.g. early
    /// bootstrap), the validator + delegator slices both fall back to the
    /// proposer address — no fee is lost.
    fn redistribute_gas_fees(&self, proposer: &Address, total_fees: u128) -> Result<()> {
        if total_fees == 0 {
            return Ok(());
        }
        let den: u128 = 10_000;
        let validator_cut = total_fees.saturating_mul(GAS_FEE_VALIDATOR_BPS as u128) / den;
        let delegators_cut = total_fees.saturating_mul(GAS_FEE_DELEGATORS_BPS as u128) / den;
        let treasury_cut = total_fees.saturating_mul(GAS_FEE_TREASURY_BPS as u128) / den;
        // burn cut = remainder so rounding dust never leaks.
        let burn_cut = total_fees
            .saturating_sub(validator_cut)
            .saturating_sub(delegators_cut)
            .saturating_sub(treasury_cut);

        // 1. Proposer cut (always paid liquid to proposer).
        if validator_cut > 0 {
            let mut p = self.account(proposer);
            p.balance = p.balance.saturating_add(validator_cut);
            self.put_account(proposer, &p)?;
        }

        // 2. Delegators cut — proportional to share weight on the proposer
        // validator. If proposer not registered or no delegators, fall back
        // to the proposer address (don't burn unintentionally).
        let mut delegators_handled = false;
        if delegators_cut > 0 {
            let sm = self.staking();
            if let Some(v) = sm.validators.get(proposer) {
                let total_shares = v.total_shares;
                if total_shares > 0 {
                    let dels: Vec<(Address, u128)> = sm
                        .delegations
                        .iter()
                        .filter(|((_, va), _)| va == proposer)
                        .map(|((d, _), s)| (*d, *s))
                        .collect();
                    drop(sm);
                    let mut paid: u128 = 0;
                    for (i, (daddr, shares)) in dels.iter().enumerate() {
                        let cut = if i + 1 == dels.len() {
                            // Final delegator absorbs rounding dust.
                            delegators_cut.saturating_sub(paid)
                        } else {
                            delegators_cut.saturating_mul(*shares) / total_shares
                        };
                        if cut == 0 {
                            continue;
                        }
                        let mut acc = self.account(daddr);
                        acc.balance = acc.balance.saturating_add(cut);
                        self.put_account(daddr, &acc)?;
                        paid = paid.saturating_add(cut);
                    }
                    delegators_handled = true;
                }
            }
            if !delegators_handled {
                let mut p = self.account(proposer);
                p.balance = p.balance.saturating_add(delegators_cut);
                self.put_account(proposer, &p)?;
            }
        }

        // 3. Admin treasury cut.
        if treasury_cut > 0 {
            let t_addr = treasury_address();
            let mut t = self.account(&t_addr);
            t.balance = t.balance.saturating_add(treasury_cut);
            self.put_account(&t_addr, &t)?;
        }

        // 4. Burn cut → either burn address (until cap) or AMM liquidity.
        if burn_cut > 0 {
            let burn_addr = burn_address();
            let burned_so_far = self.account(&burn_addr).balance;
            if burned_so_far < BURN_CAP_WEI {
                let mut b = self.account(&burn_addr);
                b.balance = b.balance.saturating_add(burn_cut);
                self.put_account(&burn_addr, &b)?;
            } else {
                // Cap reached → reroute slice into AMM pool (single-sided ZBX add).
                let mut p = self.pool();
                p.zbx_reserve = p.zbx_reserve.saturating_add(burn_cut);
                self.put_pool(&p)?;
            }
        }
        Ok(())
    }

    pub fn block_at(&self, height: u64) -> Option<Block> {
        let cf = self.db.cf_handle(CF_BLOCKS).unwrap();
        self.db.get_cf(cf, height.to_be_bytes()).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
    }

    // ───────── Pool / zUSD operations ─────────

    pub fn pool(&self) -> Pool {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, META_POOL).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
            .unwrap_or_default()
    }

    fn put_pool(&self, p: &Pool) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, META_POOL, bincode::serialize(p)?)?;
        Ok(())
    }

    pub fn lp_balance(&self, a: &Address) -> u128 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut k = META_LP_PREFIX.to_vec();
        k.extend_from_slice(&a.0);
        self.db.get_cf(cf, &k).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
            .unwrap_or(0u128)
    }

    fn put_lp(&self, a: &Address, bal: u128) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut k = META_LP_PREFIX.to_vec();
        k.extend_from_slice(&a.0);
        self.db.put_cf(cf, &k, bincode::serialize(&bal)?)?;
        Ok(())
    }

    pub fn faucet_mint_zusd(&self, to: &Address, amount: u128) -> Result<()> {
        let mut acc = self.account(to);
        acc.zusd = acc.zusd.saturating_add(amount);
        self.put_account(to, &acc)?;
        Ok(())
    }

    /// **Genesis pool init** — mints `GENESIS_POOL_ZBX_WEI` (20M ZBX) +
    /// `GENESIS_POOL_ZUSD_LOAN` (10M zUSD) directly into pool reserves.
    /// Opening spot = 10M / 20M = **$0.50 per ZBX** (Phase B.11.1).
    /// No admin debit. LP tokens are locked permanently to POOL_ADDRESS
    /// (nobody can withdraw). Sets `loan_outstanding = 10M zUSD` to be
    /// repaid via swap fees; once repaid, future fees split 50/50 between
    /// admin payout and pool reinvestment.
    pub fn pool_init_genesis(&self) -> Result<u128> {
        let mut p = self.pool();
        if p.is_initialized() {
            return Err(anyhow!("pool already initialized"));
        }
        let height = self.tip().0;
        let lp = p.init_genesis(GENESIS_POOL_ZBX_WEI, GENESIS_POOL_ZUSD_LOAN, height)
            .map_err(|e| anyhow!(e))?;
        self.put_pool(&p)?;
        // Lock all LP tokens to POOL_ADDRESS — provably permanent liquidity.
        let pool_addr = pool_address();
        self.put_lp(&pool_addr, lp)?;
        Ok(lp)
    }

    /// Admin: add proportional liquidity (still credits LP to admin if desired).
    /// Kept for admin top-ups; users cannot call this.
    pub fn pool_add_liquidity(&self, from: &Address, zbx_max: u128, zusd_max: u128) -> Result<(u128, u128, u128)> {
        let mut p = self.pool();
        let mut acc = self.account(from);
        if acc.balance < zbx_max { return Err(anyhow!("insufficient ZBX")); }
        if acc.zusd < zusd_max { return Err(anyhow!("insufficient zUSD")); }
        let height = self.tip().0;
        let (zbx_in, zusd_in, lp) = p.add_liquidity(zbx_max, zusd_max, height).map_err(|e| anyhow!(e))?;
        acc.balance -= zbx_in;
        acc.zusd -= zusd_in;
        self.put_account(from, &acc)?;
        self.put_lp(from, self.lp_balance(from).saturating_add(lp))?;
        self.put_pool(&p)?;
        Ok((zbx_in, zusd_in, lp))
    }

    /// Direct swap helper (admin/testing). Normal users should just send to POOL_ADDRESS.
    pub fn pool_swap_zbx_to_zusd(&self, from: &Address, zbx_in: u128, min_out: u128) -> Result<u128> {
        let mut p = self.pool();
        let mut acc = self.account(from);
        if acc.balance < zbx_in { return Err(anyhow!("insufficient ZBX")); }
        let height = self.tip().0;
        let out = p.swap_zbx_for_zusd(zbx_in, height).map_err(|e| anyhow!(e))?;
        if out < min_out { return Err(anyhow!("slippage: got {} < min {}", out, min_out)); }
        let (admin_zbx, admin_zusd) = p.settle_fees();
        acc.balance -= zbx_in;
        acc.zusd = acc.zusd.saturating_add(out);
        self.put_account(from, &acc)?;
        self.put_pool(&p)?;
        if admin_zbx > 0 || admin_zusd > 0 {
            let admin = self.current_admin();
            let mut a = self.account(&admin);
            a.balance = a.balance.saturating_add(admin_zbx);
            a.zusd = a.zusd.saturating_add(admin_zusd);
            self.put_account(&admin, &a)?;
        }
        Ok(out)
    }

    pub fn pool_swap_zusd_to_zbx(&self, from: &Address, zusd_in: u128, min_out: u128) -> Result<u128> {
        let mut p = self.pool();
        let mut acc = self.account(from);
        if acc.zusd < zusd_in { return Err(anyhow!("insufficient zUSD")); }
        let height = self.tip().0;
        let out = p.swap_zusd_for_zbx(zusd_in, height).map_err(|e| anyhow!(e))?;
        if out < min_out { return Err(anyhow!("slippage: got {} < min {}", out, min_out)); }
        let (admin_zbx, admin_zusd) = p.settle_fees();
        acc.zusd -= zusd_in;
        acc.balance = acc.balance.saturating_add(out);
        self.put_account(from, &acc)?;
        self.put_pool(&p)?;
        if admin_zbx > 0 || admin_zusd > 0 {
            let admin = self.current_admin();
            let mut a = self.account(&admin);
            a.balance = a.balance.saturating_add(admin_zbx);
            a.zusd = a.zusd.saturating_add(admin_zusd);
            self.put_account(&admin, &a)?;
        }
        Ok(out)
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Phase B.3.3 — State commitment, slashing wiring, snapshot tooling
// ═════════════════════════════════════════════════════════════════════════
//
// All additions below are gated behind env-driven activation so this file
// can be deployed to a running chain without forcing an immediate hard fork:
//
//   ZEBVIX_STATE_ROOT_ACTIVATION_HEIGHT=<height>
//       Block height at which `header.state_root` MUST equal the locally
//       recomputed root. Below this height, ZERO is accepted (legacy).
//       Default: u64::MAX (effectively disabled — operators must opt in).
//
//   ZEBVIX_SLASHING_ENABLED=1
//       Activates `slash_double_sign` calls from the vote-handling path in
//       main.rs when DoubleSign evidence is detected. Default: disabled.
//
// Operators flip these on once their validator set is migrated and tested.

use once_cell::sync::Lazy;

/// Block height at which state-root verification is enforced. Headers below
/// this height may carry `Hash::ZERO` (legacy v0.1 blocks); headers at or
/// above this height MUST carry the deterministic Merkle root computed by
/// `compute_state_root()`. Set via env `ZEBVIX_STATE_ROOT_ACTIVATION_HEIGHT`.
pub static STATE_ROOT_ACTIVATION_HEIGHT: Lazy<u64> = Lazy::new(|| {
    std::env::var("ZEBVIX_STATE_ROOT_ACTIVATION_HEIGHT")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(u64::MAX)
});

/// Master switch for the Phase B.3.3 slashing pipeline.
///
/// **SECURITY HARDENING (C/H audit):** default flipped to **TRUE** so any
/// detected `DoubleSign` automatically burns the offender's stake. On a
/// single-validator devnet there is no risk (the lone producer cannot
/// double-sign against itself). Operators who need to disable slashing
/// (e.g. during a planned validator-set migration) can set
/// `ZEBVIX_SLASHING_DISABLED=1` for an emergency override.
///
/// Legacy override `ZEBVIX_SLASHING_ENABLED=0` is also still honored so
/// upgrades from earlier binaries don't surprise operators.
pub static SLASHING_ENABLED: Lazy<bool> = Lazy::new(|| {
    // Highest-priority override: explicit disable flag (post-hardening).
    if let Ok(v) = std::env::var("ZEBVIX_SLASHING_DISABLED") {
        let v = v.trim();
        if v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes") {
            tracing::warn!(
                "⚠  slashing DISABLED via ZEBVIX_SLASHING_DISABLED — \
                 double-sign evidence will be logged but no stake will be burned"
            );
            return false;
        }
    }
    // Legacy enable/disable: ZEBVIX_SLASHING_ENABLED=0 also disables.
    if let Ok(v) = std::env::var("ZEBVIX_SLASHING_ENABLED") {
        let v = v.trim();
        let on = v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes");
        return on;
    }
    // Default: ON (security-by-default).
    true
});

/// On-chain audit record of a detected double-sign event. Persisted under
/// `META_EVIDENCE_PREFIX` in CF_META and EXCLUDED from `compute_state_root`
/// because evidence-detection timing is not deterministic across nodes
/// (see comment block at the META_EVIDENCE_PREFIX declaration).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DoubleSignEvidence {
    pub validator: Address,
    pub height: u64,
    pub round: u32,
    pub vote_type: String,
    pub previous_block_hash: Hash,
    pub conflicting_block_hash: Hash,
    pub recorded_at_height: u64,
    pub slashed_amount_wei: u128,
}

impl State {
    // ────────────────────────────────────────────────────────────────────
    // State commitment — deterministic Merkle root over consensus state
    // ────────────────────────────────────────────────────────────────────
    //
    // Algorithm:
    //   1. Iterate every (key, value) in CF_ACCOUNTS — domain-tag prefix `A`.
    //   2. Iterate every (key, value) in CF_META — domain-tag prefix `M` —
    //      EXCLUDING block-derived keys (META_HEIGHT, META_LAST_HASH —
    //      already self-referenced by the block-hash chain) and
    //      non-consensus indexes (META_RTX_*, META_EVIDENCE_*).
    //   3. Each leaf = keccak256(domain_tag || key || value).
    //   4. Sort leaves lexicographically (defensive — RocksDB iteration is
    //      already sorted, but explicit sort guards against future CF
    //      changes).
    //   5. Reduce pairwise via keccak256(left || right). Odd leaves at any
    //      level are duplicated (Bitcoin-style padding).
    //
    // The empty-state root is `Hash::ZERO`. Operators verifying historical
    // blocks below `STATE_ROOT_ACTIVATION_HEIGHT` will see ZERO roots that
    // do NOT match this computation — that is intentional (legacy gap).
    //
    pub fn compute_state_root(&self) -> Hash {
        use crate::crypto::keccak256;
        let mut leaves: Vec<Hash> = Vec::new();

        let cf_acc = self.db.cf_handle(CF_ACCOUNTS).unwrap();
        for item in self.db.iterator_cf(cf_acc, rocksdb::IteratorMode::Start) {
            let (k, v) = match item { Ok(kv) => kv, Err(_) => continue };
            let mut buf = Vec::with_capacity(k.len() + v.len() + 1);
            buf.push(b'A');
            buf.extend_from_slice(&k);
            buf.extend_from_slice(&v);
            leaves.push(keccak256(&buf));
        }

        let cf_meta = self.db.cf_handle(CF_META).unwrap();
        for item in self.db.iterator_cf(cf_meta, rocksdb::IteratorMode::Start) {
            let (k, v) = match item { Ok(kv) => kv, Err(_) => continue };
            // ── Exclusions (non-consensus or block-derived) ──
            if k.as_ref() == META_HEIGHT { continue; }
            if k.as_ref() == META_LAST_HASH { continue; }
            if k.as_ref() == META_RTX_SEQ { continue; }
            if k.as_ref() == META_EVIDENCE_SEQ { continue; }
            if k.starts_with(META_RTX_PREFIX) { continue; }
            if k.starts_with(META_EVIDENCE_PREFIX) { continue; }
            let mut buf = Vec::with_capacity(k.len() + v.len() + 1);
            buf.push(b'M');
            buf.extend_from_slice(&k);
            buf.extend_from_slice(&v);
            leaves.push(keccak256(&buf));
        }

        leaves.sort_by(|a, b| a.0.cmp(&b.0));

        if leaves.is_empty() {
            return Hash::ZERO;
        }

        while leaves.len() > 1 {
            if leaves.len() % 2 != 0 {
                let last = *leaves.last().unwrap();
                leaves.push(last);
            }
            let mut next = Vec::with_capacity(leaves.len() / 2);
            for chunk in leaves.chunks(2) {
                let mut buf = [0u8; 64];
                buf[..32].copy_from_slice(&chunk[0].0);
                buf[32..].copy_from_slice(&chunk[1].0);
                next.push(keccak256(&buf));
            }
            leaves = next;
        }
        leaves[0]
    }

    // ────────────────────────────────────────────────────────────────────
    // Slashing wrapper — staking module already implements the math
    // ────────────────────────────────────────────────────────────────────
    //
    // Loads the current StakingModule blob, calls `slash_double_sign`
    // (which deducts SLASH_DOUBLE_SIGN_BPS from the validator's stake and
    // jails them for JAIL_EPOCHS_DOUBLE_SIGN epochs), then persists the
    // updated blob. Returns the burned wei amount on success.
    //
    pub fn slash_double_sign(&self, validator: Address) -> Result<u128> {
        let mut sm = self.staking();
        let burned = sm
            .slash_double_sign(validator)
            .map_err(|e| anyhow!("slash_double_sign: {:?}", e))?;
        self.put_staking(&sm)?;
        Ok(burned)
    }

    // ────────────────────────────────────────────────────────────────────
    // Atomic combined slashing + evidence persistence
    // ────────────────────────────────────────────────────────────────────
    //
    // Why this exists separately from `slash_double_sign` + `record_evidence`:
    //
    // The double-sign hot path MUST commit (a) the staking burn and (b) the
    // audit-log evidence row in a single atomic DB transaction. Doing two
    // independent `db.put_cf` calls leaves a window where a process kill,
    // power loss, or filesystem error between the two writes produces a
    // split-brain state — validator slashed but no evidence row, or
    // evidence row but no slash.
    //
    // This helper bundles ALL three writes (staking blob, evidence row,
    // evidence seq counter) into one `rocksdb::WriteBatch` which RocksDB
    // commits atomically (single WAL fsync, all-or-nothing).
    //
    // The `slashed_amount_wei` field in `ev_template` is overwritten with
    // the actual burned amount returned by the staking module — callers
    // can pass 0 as a placeholder.
    //
    pub fn slash_and_record_evidence(
        &self,
        validator: Address,
        mut ev_template: DoubleSignEvidence,
    ) -> Result<u128> {
        let cf = self.db.cf_handle(CF_META).unwrap();

        // Step 1: mutate staking blob in memory (no DB write yet).
        let mut sm = self.staking();
        let burned = sm
            .slash_double_sign(validator)
            .map_err(|e| anyhow!("slash_double_sign: {:?}", e))?;
        ev_template.slashed_amount_wei = burned;

        // Step 2: read current evidence sequence counter.
        let seq = self.db.get_cf(cf, META_EVIDENCE_SEQ)?
            .map(|b| {
                let mut a = [0u8; 8];
                if b.len() == 8 { a.copy_from_slice(&b); }
                u64::from_be_bytes(a)
            })
            .unwrap_or(0);
        let next = seq + 1;
        let mut k_ev = META_EVIDENCE_PREFIX.to_vec();
        k_ev.extend_from_slice(&next.to_be_bytes());

        // Step 3: single atomic WriteBatch across all three keys.
        let mut batch = rocksdb::WriteBatch::default();
        batch.put_cf(cf, META_STAKING, bincode::serialize(&sm)?);
        batch.put_cf(cf, k_ev, bincode::serialize(&ev_template)?);
        batch.put_cf(cf, META_EVIDENCE_SEQ, next.to_be_bytes());
        self.db.write(batch)?;

        Ok(burned)
    }

    // ────────────────────────────────────────────────────────────────────
    // Evidence ledger — append-only audit log of detected double-signs
    // ────────────────────────────────────────────────────────────────────

    pub fn record_evidence(&self, ev: &DoubleSignEvidence) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let seq = self.db.get_cf(cf, META_EVIDENCE_SEQ)?
            .map(|b| {
                let mut a = [0u8; 8];
                if b.len() == 8 { a.copy_from_slice(&b); }
                u64::from_be_bytes(a)
            })
            .unwrap_or(0);
        let next = seq + 1;
        let mut k = META_EVIDENCE_PREFIX.to_vec();
        k.extend_from_slice(&next.to_be_bytes());
        // Atomic batch: row + seq committed together so a crash between the
        // two keys cannot leave seq pointing at a non-existent row (or a
        // row written without seq advance).
        let mut batch = rocksdb::WriteBatch::default();
        batch.put_cf(cf, k, bincode::serialize(ev)?);
        batch.put_cf(cf, META_EVIDENCE_SEQ, next.to_be_bytes());
        self.db.write(batch)?;
        Ok(())
    }

    pub fn list_evidence(&self, limit: usize) -> Vec<DoubleSignEvidence> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let it = self.db.prefix_iterator_cf(cf, META_EVIDENCE_PREFIX);
        let mut out = Vec::new();
        for item in it {
            if out.len() >= limit { break; }
            let Ok((k, v)) = item else { continue };
            if !k.starts_with(META_EVIDENCE_PREFIX) { break; }
            if let Ok(e) = bincode::deserialize::<DoubleSignEvidence>(&v) {
                out.push(e);
            }
        }
        out
    }

    pub fn evidence_count(&self) -> u64 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, META_EVIDENCE_SEQ).ok().flatten()
            .map(|b| {
                let mut a = [0u8; 8];
                if b.len() == 8 { a.copy_from_slice(&b); }
                u64::from_be_bytes(a)
            })
            .unwrap_or(0)
    }

    // ────────────────────────────────────────────────────────────────────
    // RocksDB checkpoint — hot consistent snapshot for backup
    // ────────────────────────────────────────────────────────────────────
    //
    // Uses RocksDB's built-in `Checkpoint` API which produces a consistent
    // hard-linked copy of all SSTs + a copy of the WAL at a single LSN.
    // The output directory MUST NOT exist (RocksDB requirement). Operators
    // typically combine this with a timestamped path:
    //
    //   zebvix-node snapshot --home /root/.zebvix --out /backups/snap-$(date +%s)
    //
    pub fn create_checkpoint(&self, out_path: &std::path::Path) -> Result<()> {
        let cp = rocksdb::checkpoint::Checkpoint::new(&self.db)
            .map_err(|e| anyhow!("checkpoint init failed: {}", e))?;
        cp.create_checkpoint(out_path)
            .map_err(|e| anyhow!("checkpoint create failed: {}", e))?;
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod state_root_tests {
    use super::*;
    use tempfile::TempDir;

    fn fresh_state() -> (TempDir, State) {
        let td = TempDir::new().unwrap();
        let st = State::open(td.path()).unwrap();
        (td, st)
    }

    #[test]
    fn empty_state_root_is_zero() {
        let (_td, st) = fresh_state();
        assert_eq!(st.compute_state_root(), Hash::ZERO);
    }

    #[test]
    fn root_changes_when_account_balance_changes() {
        let (_td, st) = fresh_state();
        let addr = Address([1u8; 20]);
        let r0 = st.compute_state_root();
        let mut a = st.account(&addr);
        a.balance = 1_000_000;
        st.put_account(&addr, &a).unwrap();
        let r1 = st.compute_state_root();
        assert_ne!(r0, r1, "root must change after account mutation");

        let mut a2 = st.account(&addr);
        a2.balance = 2_000_000;
        st.put_account(&addr, &a2).unwrap();
        let r2 = st.compute_state_root();
        assert_ne!(r1, r2, "root must change again on second mutation");
    }

    #[test]
    fn root_is_deterministic_across_recomputes() {
        let (_td, st) = fresh_state();
        let addr_a = Address([0xaau8; 20]);
        let addr_b = Address([0xbbu8; 20]);
        let mut acc_a = st.account(&addr_a);
        acc_a.balance = 7_777;
        st.put_account(&addr_a, &acc_a).unwrap();
        let mut acc_b = st.account(&addr_b);
        acc_b.balance = 5_555;
        st.put_account(&addr_b, &acc_b).unwrap();
        assert_eq!(st.compute_state_root(), st.compute_state_root());
    }

    #[test]
    fn evidence_log_roundtrip() {
        let (_td, st) = fresh_state();
        assert_eq!(st.evidence_count(), 0);
        let ev = DoubleSignEvidence {
            validator: Address([9u8; 20]),
            height: 100,
            round: 0,
            vote_type: "prevote".to_string(),
            previous_block_hash: Hash([1u8; 32]),
            conflicting_block_hash: Hash([2u8; 32]),
            recorded_at_height: 100,
            slashed_amount_wei: 0,
        };
        st.record_evidence(&ev).unwrap();
        assert_eq!(st.evidence_count(), 1);
        let listed = st.list_evidence(10);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].height, 100);
    }

    #[test]
    fn evidence_excluded_from_state_root() {
        let (_td, st) = fresh_state();
        let r0 = st.compute_state_root();
        let ev = DoubleSignEvidence {
            validator: Address([3u8; 20]),
            height: 10, round: 0,
            vote_type: "precommit".to_string(),
            previous_block_hash: Hash::ZERO,
            conflicting_block_hash: Hash::ZERO,
            recorded_at_height: 10,
            slashed_amount_wei: 0,
        };
        st.record_evidence(&ev).unwrap();
        let r1 = st.compute_state_root();
        assert_eq!(r0, r1, "evidence write must NOT change state root");
    }

    #[test]
    fn slash_and_record_evidence_is_atomic_pair() {
        // Smoke test: helper writes BOTH staking blob and evidence row in one
        // batch. After a successful call, both must be readable. (RocksDB
        // WriteBatch is atomic-by-construction — we cannot force a partial
        // failure in a unit test, but we verify the happy path commits both
        // sides and uses a single sequence increment.)
        let (_td, st) = fresh_state();
        // Bootstrap one validator directly via the public `validators` map
        // (avoids needing a real secp256k1 pubkey for the unit test).
        let mut sm = st.staking();
        let v = Address([0x44u8; 20]);
        let mut vs = crate::staking::ValidatorState::default();
        vs.address = v;
        vs.total_stake = 10_000_000_000_000_000_000u128; // 10 ZBX
        vs.total_shares = vs.total_stake; // 1:1 shares for the test
        sm.validators.insert(v, vs);
        st.put_staking(&sm).unwrap();

        let ev_template = DoubleSignEvidence {
            validator: v,
            height: 50,
            round: 1,
            vote_type: "prevote".to_string(),
            previous_block_hash: Hash([7u8; 32]),
            conflicting_block_hash: Hash([8u8; 32]),
            recorded_at_height: 50,
            slashed_amount_wei: 0,
        };
        let before_count = st.evidence_count();
        let burned = st.slash_and_record_evidence(v, ev_template).unwrap();
        // Evidence row was committed.
        assert_eq!(st.evidence_count(), before_count + 1, "evidence seq must increment by 1");
        let listed = st.list_evidence(10);
        assert!(!listed.is_empty(), "evidence must be readable after atomic write");
        let last = listed.iter().find(|e| e.validator == v).expect("our evidence row");
        assert_eq!(last.slashed_amount_wei, burned, "evidence row records actual burned amount");
        // Staking blob was committed: validator must be jailed.
        let sm2 = st.staking();
        let v_state = sm2.validators.get(&v).expect("validator must still exist");
        assert!(v_state.jailed, "validator must be jailed after atomic slash");
        assert!(burned > 0, "slash must burn a non-zero amount given non-zero stake");
    }

    #[test]
    fn slash_and_record_evidence_failure_writes_nothing() {
        // Negative path: when staking.slash_double_sign fails (validator
        // unknown), we must NOT have written ANY of: staking blob, evidence
        // row, evidence seq counter. Verifies the early return happens
        // before the WriteBatch commits.
        let (_td, st) = fresh_state();
        let count_before = st.evidence_count();
        let unknown = Address([0xeeu8; 20]);
        let ev_template = DoubleSignEvidence {
            validator: unknown,
            height: 1,
            round: 0,
            vote_type: "prevote".to_string(),
            previous_block_hash: Hash::ZERO,
            conflicting_block_hash: Hash::ZERO,
            recorded_at_height: 1,
            slashed_amount_wei: 0,
        };
        let res = st.slash_and_record_evidence(unknown, ev_template);
        assert!(res.is_err(), "must error on unknown validator");
        assert_eq!(
            st.evidence_count(),
            count_before,
            "evidence seq must NOT increment on slash failure"
        );
        assert!(
            st.list_evidence(10).is_empty(),
            "no evidence row must be written on slash failure"
        );
    }

    #[test]
    fn checkpoint_creates_directory() {
        let (_td, st) = fresh_state();
        let mut acc = st.account(&Address([1u8; 20]));
        acc.balance = 42;
        st.put_account(&Address([1u8; 20]), &acc).unwrap();
        let snap_dir = TempDir::new().unwrap();
        let snap_path = snap_dir.path().join("snap1");
        st.create_checkpoint(&snap_path).unwrap();
        assert!(snap_path.exists(), "checkpoint dir must exist");
        assert!(snap_path.is_dir(), "checkpoint must be a directory");
    }

    // ────────────────────────────────────────────────────────────────
    // Phase E + Audit hardening — block-forgery + token roundtrip tests
    // ────────────────────────────────────────────────────────────────

    use crate::crypto::{generate_keypair, sign_bytes};
    use crate::transaction::TxKind;
    use crate::types::{Block, BlockHeader, Validator};

    fn install_validator(st: &State) -> ([u8; 32], [u8; 33], Address) {
        let (sk, pk) = generate_keypair();
        let addr = crate::crypto::address_from_pubkey(&pk);
        st.put_validator(&Validator { address: addr, pubkey: pk, voting_power: 1 }).unwrap();
        (sk, pk, addr)
    }

    fn build_block(
        st: &State,
        proposer: Address,
        signing_secret: &[u8; 32],
    ) -> Block {
        let (h, parent) = st.tip();
        let header = BlockHeader {
            height: h + 1,
            parent_hash: parent,
            state_root: Hash::ZERO,
            tx_root: Hash::ZERO,
            timestamp_ms: 1_700_000_000_000,
            proposer,
        };
        let sig = sign_bytes(signing_secret, &header_signing_bytes(&header));
        Block { header, txs: Vec::new(), signature: sig }
    }

    #[test]
    fn apply_block_accepts_well_signed_proposer() {
        let (_td, st) = fresh_state();
        let (sk, _pk, addr) = install_validator(&st);
        let blk = build_block(&st, addr, &sk);
        st.apply_block(&blk).expect("well-signed block from registered validator must apply");
        let (h, _) = st.tip();
        assert_eq!(h, 1, "tip must advance");
    }

    #[test]
    fn apply_block_rejects_non_validator_proposer() {
        let (_td, st) = fresh_state();
        // Register validator A so the chain has at least one validator,
        // but propose as attacker B (NOT in the set).
        let (_sk_a, _pk_a, _addr_a) = install_validator(&st);
        let (sk_b, pk_b) = generate_keypair();
        let attacker = crate::crypto::address_from_pubkey(&pk_b);
        let blk = build_block(&st, attacker, &sk_b);
        let err = st.apply_block(&blk).expect_err("must reject non-validator proposer");
        let msg = format!("{err}");
        assert!(
            msg.contains("NOT in validator set") || msg.contains("forgery"),
            "error must call out forgery: {msg}"
        );
    }

    #[test]
    fn apply_block_rejects_forged_signature() {
        let (_td, st) = fresh_state();
        let (_sk_a, _pk_a, addr_a) = install_validator(&st);
        // Build header claiming validator A as proposer, but sign with
        // attacker B's key. A is in the validator set so the membership
        // check passes — only the signature check must catch this.
        let (sk_b, _pk_b) = generate_keypair();
        let blk = build_block(&st, addr_a, &sk_b);
        let err = st.apply_block(&blk).expect_err("forged signature must be rejected");
        let msg = format!("{err}");
        assert!(
            msg.contains("signature INVALID") || msg.contains("forgery"),
            "error must call out invalid signature: {msg}"
        );
    }

    #[test]
    fn mempool_rejects_insufficient_balance() {
        use crate::mempool::Mempool;
        use crate::transaction::TxBody;
        use std::sync::Arc;
        let (_td, st) = fresh_state();
        let st = Arc::new(st);
        // Sender has zero balance — any non-zero tx must be rejected.
        let (sk, pk) = generate_keypair();
        let from = crate::crypto::address_from_pubkey(&pk);
        let body = TxBody {
            from,
            to: Address::ZERO,
            amount: 1,
            nonce: 0,
            fee: crate::tokenomics::MIN_TX_FEE_WEI,
            chain_id: 7878,
            kind: TxKind::Transfer,
        };
        let tx = crate::crypto::sign_tx(&sk, body);
        let mp = Mempool::new(st, 64);
        let err = mp.add(tx).expect_err("zero-balance sender must be rejected");
        let msg = format!("{err}");
        assert!(msg.contains("insufficient balance"), "expected balance error: {msg}");
    }

    #[test]
    fn mempool_rejects_nonce_too_far() {
        use crate::mempool::{Mempool, MAX_NONCE_GAP};
        use crate::transaction::TxBody;
        use std::sync::Arc;
        let (_td, st) = fresh_state();
        // Fund sender so balance check passes — only nonce gap should fail.
        let (sk, pk) = generate_keypair();
        let from = crate::crypto::address_from_pubkey(&pk);
        let mut acc = st.account(&from);
        acc.balance = 10u128.pow(20);
        st.put_account(&from, &acc).unwrap();
        let st = Arc::new(st);
        let body = TxBody {
            from,
            to: Address::ZERO,
            amount: 1,
            nonce: MAX_NONCE_GAP + 1, // cur=0, max gap window exceeded
            fee: crate::tokenomics::MIN_TX_FEE_WEI,
            chain_id: 7878,
            kind: TxKind::Transfer,
        };
        let tx = crate::crypto::sign_tx(&sk, body);
        let mp = Mempool::new(st, 64);
        let err = mp.add(tx).expect_err("nonce far in future must be rejected");
        let msg = format!("{err}");
        assert!(msg.contains("nonce too far"), "expected nonce-gap error: {msg}");
    }

    #[test]
    fn token_create_then_transfer_roundtrip() {
        let (_td, st) = fresh_state();
        // Two parties: creator (alice) and recipient (bob).
        let (sk_a, pk_a) = generate_keypair();
        let alice = crate::crypto::address_from_pubkey(&pk_a);
        let (_sk_b, pk_b) = generate_keypair();
        let bob = crate::crypto::address_from_pubkey(&pk_b);
        // Fund alice with enough ZBX to cover fee + the 100-ZBX creation burn.
        let mut acc = st.account(&alice);
        acc.balance = 200u128 * 1_000_000_000_000_000_000u128;
        st.put_account(&alice, &acc).unwrap();

        let fee = crate::tokenomics::BOOTSTRAP_MIN_FEE_WEI.max(1_000_000_000_000_000);
        let create_body = crate::transaction::TxBody {
            from: alice,
            to: Address::ZERO,
            amount: 0,
            nonce: 0,
            fee,
            chain_id: 7878,
            kind: TxKind::TokenCreate {
                name: "MyCoin".to_string(),
                symbol: "MYC".to_string(),
                decimals: 8,
                initial_supply: 1_000_000,
            },
        };
        let create_tx = crate::crypto::sign_tx(&sk_a, create_body);
        st.apply_tx(&create_tx).expect("token create must succeed");

        // Token #1 should now exist and alice should hold full supply.
        let tok = st.get_token_by_symbol("MYC").expect("MYC token must exist");
        assert_eq!(tok.id, 1);
        assert_eq!(tok.creator, alice);
        assert_eq!(tok.decimals, 8);
        assert_eq!(tok.total_supply, 1_000_000);
        assert_eq!(st.token_balance_of(tok.id, &alice), 1_000_000);
        assert_eq!(st.token_balance_of(tok.id, &bob), 0);

        // Now transfer 250_000 MYC alice -> bob.
        let xfer_body = crate::transaction::TxBody {
            from: alice,
            to: Address::ZERO,
            amount: 0,
            nonce: 1,
            fee,
            chain_id: 7878,
            kind: TxKind::TokenTransfer {
                token_id: tok.id,
                to: bob,
                amount: 250_000,
            },
        };
        let xfer_tx = crate::crypto::sign_tx(&sk_a, xfer_body);
        st.apply_tx(&xfer_tx).expect("token transfer must succeed");
        assert_eq!(st.token_balance_of(tok.id, &alice), 750_000);
        assert_eq!(st.token_balance_of(tok.id, &bob), 250_000);
        // Total supply unchanged on transfer.
        let tok_after = st.get_token(tok.id).unwrap();
        assert_eq!(tok_after.total_supply, 1_000_000);
    }

    #[test]
    fn apply_block_fails_loud_on_runtime_tx_error() {
        // Regression test for audit follow-up: any apply_tx error inside
        // the runtime loop MUST abort the whole block AND leave the
        // crash-safety marker set, so startup refuses to boot. We trigger
        // this by including a TokenMint tx submitted by a non-creator
        // (passes pre-validation: nonce/balance/fee all OK; fails at
        // apply_tx with the creator-only check).
        let (_td, st) = fresh_state();
        let (sk_v, _pk_v, addr_v) = install_validator(&st);

        // Alice creates a token outside of any block (direct apply_tx).
        let (sk_a, pk_a) = generate_keypair();
        let alice = crate::crypto::address_from_pubkey(&pk_a);
        let mut acc_a = st.account(&alice);
        acc_a.balance = 200u128 * 1_000_000_000_000_000_000u128;
        st.put_account(&alice, &acc_a).unwrap();
        let fee = crate::tokenomics::MIN_TX_FEE_WEI;
        let create = crate::transaction::TxBody {
            from: alice, to: Address::ZERO, amount: 0, nonce: 0, fee, chain_id: 7878,
            kind: TxKind::TokenCreate {
                name: "Foo".to_string(), symbol: "FOO".to_string(),
                decimals: 6, initial_supply: 100,
            },
        };
        st.apply_tx(&crate::crypto::sign_tx(&sk_a, create)).unwrap();
        let tok = st.get_token_by_symbol("FOO").unwrap();

        // Bob (non-creator) attempts to mint inside a block. Fund bob.
        let (sk_b, pk_b) = generate_keypair();
        let bob = crate::crypto::address_from_pubkey(&pk_b);
        let mut acc_b = st.account(&bob);
        acc_b.balance = 10u128 * 1_000_000_000_000_000_000u128;
        st.put_account(&bob, &acc_b).unwrap();

        let mint_body = crate::transaction::TxBody {
            from: bob, to: Address::ZERO, amount: 0, nonce: 0, fee, chain_id: 7878,
            kind: TxKind::TokenMint { token_id: tok.id, to: bob, amount: 999 },
        };
        let bad_tx = crate::crypto::sign_tx(&sk_b, mint_body);

        // Build a block with that tx, signed by the registered validator.
        let (h0, parent) = st.tip();
        let header = BlockHeader {
            height: h0 + 1,
            parent_hash: parent,
            state_root: Hash::ZERO,
            tx_root: Hash::ZERO,
            timestamp_ms: 1_700_000_000_000,
            proposer: addr_v,
        };
        let sig = sign_bytes(&sk_v, &header_signing_bytes(&header));
        let blk = Block { header, txs: vec![bad_tx], signature: sig };

        let res = st.apply_block(&blk);
        assert!(res.is_err(), "block with creator-only mint by non-creator must abort");

        // Tip must NOT advance.
        let (h1, _) = st.tip();
        assert_eq!(h1, h0, "tip must not advance on aborted block");
        // Marker MUST remain set so startup refuses to boot.
        let marker = st.read_block_applying_marker();
        assert!(marker.is_some(), "marker must remain set on aborted block");
        let (mh, _) = marker.unwrap();
        assert_eq!(mh, h0 + 1, "marker height must equal the failed block's height");
        // Bob must NOT have received any minted balance.
        assert_eq!(st.token_balance_of(tok.id, &bob), 0);

        // ── In-process guard: any subsequent apply_block call must be
        // refused while the marker is set, EVEN if the new block would
        // otherwise be valid. The operator must restart and run the
        // recovery procedure to clear the marker.
        let header2 = BlockHeader {
            height: h0 + 1,
            parent_hash: parent,
            state_root: Hash::ZERO,
            tx_root: Hash::ZERO,
            timestamp_ms: 1_700_000_001_000,
            proposer: addr_v,
        };
        let sig2 = sign_bytes(&sk_v, &header_signing_bytes(&header2));
        let blk2 = Block { header: header2, txs: vec![], signature: sig2 };
        let res2 = st.apply_block(&blk2);
        assert!(res2.is_err(), "apply_block must refuse while marker is stuck");
        let msg = format!("{:?}", res2.err().unwrap());
        assert!(
            msg.contains("stuck apply-marker") || msg.contains("apply-marker"),
            "error must mention stuck marker, got: {msg}"
        );

        // Operator recovery: clear the marker, then a valid block applies.
        st.clear_block_applying_marker().unwrap();
        let res3 = st.apply_block(&blk2);
        assert!(res3.is_ok(), "after marker cleared, valid block must apply: {res3:?}");
        let (h3, _) = st.tip();
        assert_eq!(h3, h0 + 1, "tip advances after recovery");
    }

    #[test]
    fn apply_block_auto_clears_stale_marker_matching_tip() {
        // The marker == committed tip case can happen if the previous run
        // committed the block fully but died before deleting the marker.
        // apply_block must auto-clear and proceed; this test locks that in.
        let (_td, st) = fresh_state();
        let (sk_v, _pk_v, addr_v) = install_validator(&st);

        // Apply one valid empty block to advance the tip.
        let (h0, parent) = st.tip();
        let header = BlockHeader {
            height: h0 + 1, parent_hash: parent,
            state_root: Hash::ZERO, tx_root: Hash::ZERO,
            timestamp_ms: 1_700_000_000_000, proposer: addr_v,
        };
        let sig = sign_bytes(&sk_v, &header_signing_bytes(&header));
        let blk = Block { header, txs: vec![], signature: sig };
        st.apply_block(&blk).unwrap();
        let (tip_h, tip_hash) = st.tip();
        assert_eq!(tip_h, h0 + 1);

        // Simulate a crash AFTER commit but BEFORE marker delete.
        st.set_block_applying_marker(tip_h, &tip_hash).unwrap();
        assert!(st.read_block_applying_marker().is_some());

        // Next apply_block must auto-clear (marker matches tip) and proceed.
        let header2 = BlockHeader {
            height: tip_h + 1, parent_hash: tip_hash,
            state_root: Hash::ZERO, tx_root: Hash::ZERO,
            timestamp_ms: 1_700_000_001_000, proposer: addr_v,
        };
        let sig2 = sign_bytes(&sk_v, &header_signing_bytes(&header2));
        let blk2 = Block { header: header2, txs: vec![], signature: sig2 };
        st.apply_block(&blk2).expect("auto-clear path should allow valid block");
        let (tip_h2, _) = st.tip();
        assert_eq!(tip_h2, tip_h + 1);
        // Marker cleared by successful commit.
        assert!(st.read_block_applying_marker().is_none());
    }

    #[test]
    fn token_mint_only_creator() {
        let (_td, st) = fresh_state();
        let (sk_a, pk_a) = generate_keypair();
        let alice = crate::crypto::address_from_pubkey(&pk_a);
        let (sk_b, pk_b) = generate_keypair();
        let bob = crate::crypto::address_from_pubkey(&pk_b);
        let fee = crate::tokenomics::BOOTSTRAP_MIN_FEE_WEI.max(1_000_000_000_000_000);
        // Fund both
        for (a, sk_amt) in [(alice, 200u128), (bob, 5u128)] {
            let mut acc = st.account(&a);
            acc.balance = sk_amt * 1_000_000_000_000_000_000u128;
            st.put_account(&a, &acc).unwrap();
            let _ = sk_amt;
        }
        // Alice creates the token.
        let create_body = crate::transaction::TxBody {
            from: alice, to: Address::ZERO, amount: 0, nonce: 0, fee, chain_id: 7878,
            kind: TxKind::TokenCreate {
                name: "AliceCoin".to_string(),
                symbol: "ALC".to_string(),
                decimals: 6,
                initial_supply: 100,
            },
        };
        st.apply_tx(&crate::crypto::sign_tx(&sk_a, create_body)).unwrap();
        let tok = st.get_token_by_symbol("ALC").unwrap();

        // Bob (non-creator) tries to mint — must fail; balance must NOT change.
        let bob_mint = crate::transaction::TxBody {
            from: bob, to: Address::ZERO, amount: 0, nonce: 0, fee, chain_id: 7878,
            kind: TxKind::TokenMint { token_id: tok.id, to: bob, amount: 999 },
        };
        let res = st.apply_tx(&crate::crypto::sign_tx(&sk_b, bob_mint));
        assert!(res.is_err(), "non-creator mint must fail");
        assert_eq!(st.token_balance_of(tok.id, &bob), 0, "bob must not have minted");
        assert_eq!(st.get_token(tok.id).unwrap().total_supply, 100);
    }
}
