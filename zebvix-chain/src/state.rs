//! Persistent state: balances, nonces, blocks. Backed by RocksDB.

use crate::crypto::{block_hash, tx_hash, verify_tx, verify_txs_batch};
use crate::pool::Pool;
use crate::tokenomics::{
    reward_at_height, ADMIN_ADDRESS_HEX, GENESIS_POOL_ZBX_WEI, GENESIS_POOL_ZUSD_LOAN,
    GOVERNOR_ADDRESS_HEX, MAX_ADMIN_CHANGES, MAX_GOVERNOR_CHANGES, POOL_ADDRESS_HEX,
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
        if tx.body.fee < crate::tokenomics::MIN_TX_FEE_WEI {
            return Err(anyhow!(
                "fee too low: {} wei < min {} wei", tx.body.fee, crate::tokenomics::MIN_TX_FEE_WEI
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
            crate::types::TxKind::Staking(_) => {
                // Phase B.4 staking ops are handled by the staking module
                // (see crate::staking). Wiring into apply_tx is pending — for
                // now, refund and return a clear error so blocks containing
                // these txs are rejected rather than silently no-op'd.
                return refund(&mut from,
                    "staking ops not yet wired into apply_tx (B.4 integration pending)".into());
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
        let reward = reward_at_height(block.header.height);
        let mut prop = self.account(&block.header.proposer);
        prop.balance = prop.balance.saturating_add(reward).saturating_add(total_fees);
        self.put_account(&block.header.proposer, &prop)?;

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

    /// Sum of all validator voting power. Used for 2/3+ quorum math.
    pub fn total_voting_power(&self) -> u64 {
        self.validators().iter().map(|v| v.voting_power).sum()
    }

    /// Quorum threshold: smallest N such that N > 2/3 * total. Returns 0 if no validators.
    pub fn quorum_threshold(&self) -> u64 {
        let total = self.total_voting_power();
        if total == 0 { 0 } else { (total * 2) / 3 + 1 }
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
