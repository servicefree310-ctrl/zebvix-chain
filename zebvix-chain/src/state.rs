//! Persistent state: balances, nonces, blocks. Backed by RocksDB.

use crate::crypto::{block_hash, tx_hash, verify_tx, verify_txs_batch};
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

pub struct State {
    db: Arc<DB>,
    tip: RwLock<(u64, Hash)>,
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
        Ok(Self { db: Arc::new(db), tip: RwLock::new((height, last)) })
    }

    pub fn tip(&self) -> (u64, Hash) { *self.tip.read() }

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
        let total = tx.body.amount.checked_add(tx.body.fee)
            .ok_or_else(|| anyhow!("amount+fee overflow"))?;
        if from.balance < total { return Err(anyhow!("insufficient balance")); }
        from.balance -= total;
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
                        // Dynamic minimum self-bond: $50 worth of ZBX at the
                        // current AMM spot price. Falls back to MIN_SELF_BOND_WEI
                        // when the pool isn't initialized yet.
                        let pool_price = self.pool().spot_price_zusd_per_zbx();
                        let min_bond = crate::staking::dynamic_min_self_bond_wei(pool_price);
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
                                    Err(anyhow!("create-validator: {} (min self-bond: {} wei ≈ $50)", e, min_bond))
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

    pub fn apply_block(&self, block: &Block) -> Result<()> {
        let (h, last) = self.tip();
        if block.header.height != h + 1 {
            return Err(anyhow!("non-contiguous height: tip {h} got {}", block.header.height));
        }
        if block.header.parent_hash != last {
            return Err(anyhow!("parent hash mismatch"));
        }
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

        let mut total_fees: u128 = 0;
        for tx in &block.txs {
            self.apply_tx(tx)?;
            total_fees = total_fees.saturating_add(tx.body.fee);
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

        let cf_b = self.db.cf_handle(CF_BLOCKS).unwrap();
        let cf_m = self.db.cf_handle(CF_META).unwrap();
        let key = block.header.height.to_be_bytes();
        self.db.put_cf(cf_b, key, bincode::serialize(block)?)?;
        let bh = block_hash(&block.header);
        self.db.put_cf(cf_m, META_HEIGHT, key)?;
        self.db.put_cf(cf_m, META_LAST_HASH, bh.0)?;
        *self.tip.write() = (block.header.height, bh);
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

    /// **Genesis pool init** — mints 10M ZBX + 10M zUSD directly into pool reserves.
    /// No admin debit. LP tokens are locked permanently to POOL_ADDRESS (nobody can withdraw).
    /// Sets `loan_outstanding = 10M zUSD` to be repaid via swap fees.
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
