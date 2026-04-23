//! Sui-style Proof-of-Stake staking module for Zebvix.
//!
//! Features
//! ────────
//!  • Validator registry (create / edit / jail / unjail / remove)
//!  • Delegated staking with **share-based accounting** (auto-compounds rewards
//!    and survives slashing without iterating all delegators)
//!  • Two-phase unbonding with a configurable cooldown (default 7 epochs)
//!  • Epoch-based reward distribution with per-validator commission split
//!  • Slashing for double-sign and downtime, with optional jailing
//!  • Pure in-memory data structures — caller (state.rs) is responsible for
//!    persistence (bincode-serializable). All mutating methods take `&mut self`
//!    and return a `StakingError` on invalid input so apply_block can revert.
//!
//! Wire types: see [`StakeOp`] and the new variants added to `types::TxKind`.
//!
//! Integration sketch (state.rs):
//!  1. Embed `StakingModule` as `pub staking: RwLock<StakingModule>` in `State`.
//!  2. In `apply_block`, after balance moves, dispatch `TxKind::Stake{..}` etc.
//!     to the corresponding `StakingModule::*` method, debiting/crediting the
//!     sender's balance accordingly.
//!  3. At the end of every epoch (e.g. every `EPOCH_BLOCKS` heights) call
//!     `end_epoch(block_reward)` to distribute rewards and process matured
//!     unbondings; credit the returned `Payout` map to account balances.
//!  4. Mirror `active_set()` into `consensus.rs` so voting power reflects stake.

use crate::types::{Address, Validator};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

// ─────────────────────────── Tunables ───────────────────────────

/// Number of blocks per epoch (≈ 1 day at 5s blocks ≈ 17,280; we use 17,280).
pub const EPOCH_BLOCKS: u64 = 17_280;

/// Unbonding cooldown, expressed in epochs. Stake remains slashable during
/// this window even though the delegator has signalled exit.
pub const UNBONDING_EPOCHS: u64 = 7;

/// Maximum size of the active validator set (top-N by total stake).
pub const MAX_ACTIVE_VALIDATORS: usize = 100;

/// Minimum self-bond required to register a validator (1,000 ZBX in wei).
pub const MIN_SELF_BOND_WEI: u128 = 1_000u128 * 1_000_000_000_000_000_000u128;

/// Minimum delegation amount (1 ZBX). Prevents share-precision dust.
pub const MIN_DELEGATION_WEI: u128 = 1_000_000_000_000_000_000u128;

/// Commission rate is stored in basis points (1 bp = 0.01 %). Range 0..=10_000.
pub const COMMISSION_BPS_DEN: u64 = 10_000;
/// Hard cap on commission = 50.00 %.
pub const MAX_COMMISSION_BPS: u64 = 5_000;
/// Maximum commission rate change per edit = 1.00 % per epoch (anti-rug).
pub const MAX_COMMISSION_BPS_DELTA: u64 = 100;

/// Total ZBX (in wei) freshly minted for stakers each epoch. This is in
/// addition to per-block proposer rewards. ~50 ZBX/epoch ≈ ~50 ZBX/day at
/// 1 epoch/day. Tune via governance later.
pub const STAKING_EPOCH_REWARD_WEI: u128 = 50u128 * 1_000_000_000_000_000_000u128;

/// Slash fraction for double-sign = 5.00 %.
pub const SLASH_DOUBLE_SIGN_BPS: u64 = 500;
/// Slash fraction for prolonged downtime = 0.10 %.
pub const SLASH_DOWNTIME_BPS: u64 = 10;
/// Jail durations (in epochs).
pub const JAIL_EPOCHS_DOUBLE_SIGN: u64 = 10_000; // effectively permanent unless governance unjails
pub const JAIL_EPOCHS_DOWNTIME: u64 = 1;

/// Internal share-precision multiplier. All share math runs in u128 so this
/// gives us roughly 18 decimal digits of headroom on top of 18-decimal ZBX.
pub const SHARE_PRECISION: u128 = 1_000_000_000_000_000_000u128;

// ─────────────────────────── Errors ─────────────────────────────

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum StakingError {
    #[error("validator not found: {0}")]
    ValidatorNotFound(Address),
    #[error("validator already exists: {0}")]
    ValidatorExists(Address),
    #[error("delegation not found")]
    DelegationNotFound,
    #[error("amount below minimum")]
    AmountTooSmall,
    #[error("self-bond below minimum")]
    SelfBondTooSmall,
    #[error("commission out of range")]
    CommissionOutOfRange,
    #[error("commission change exceeds per-epoch cap")]
    CommissionChangeTooLarge,
    #[error("validator is jailed")]
    Jailed,
    #[error("insufficient shares")]
    InsufficientShares,
    #[error("redelegate to same validator")]
    SelfRedelegate,
    #[error("arithmetic overflow")]
    Overflow,
}

// ─────────────────────────── Wire ops ───────────────────────────

/// On-chain operations dispatched via the new `TxKind::Staking(StakeOp)` variant.
/// `signer` for each op is the tx sender (`tx.body.from`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StakeOp {
    CreateValidator {
        pubkey: [u8; 32],
        commission_bps: u64,
        self_bond: u128,
    },
    EditValidator {
        validator: Address,
        new_commission_bps: Option<u64>,
    },
    Stake {
        validator: Address,
        amount: u128,
    },
    /// Begin unbonding `shares` from `validator`. Funds become withdrawable
    /// after `UNBONDING_EPOCHS`.
    Unstake {
        validator: Address,
        shares: u128,
    },
    /// Move stake atomically from one validator to another (no cooldown,
    /// but slashable on the source until `UNBONDING_EPOCHS` pass).
    Redelegate {
        from: Address,
        to: Address,
        shares: u128,
    },
    /// Pull all matured rewards for the signer on `validator` (auto-compound is
    /// the default — claim is only needed to convert shares → liquid balance).
    ClaimRewards {
        validator: Address,
    },
}

// ─────────────────────────── Data model ─────────────────────────

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ValidatorState {
    pub address: Address,
    pub pubkey: [u8; 32],
    /// Operator (= the address that registered the validator). Earns commission.
    pub operator: Address,
    /// Sum of all bonded stake (self + delegators), in wei.
    pub total_stake: u128,
    /// Total shares outstanding. `delegation.amount = shares * total_stake / total_shares`.
    pub total_shares: u128,
    /// Commission, in basis points (0..=MAX_COMMISSION_BPS).
    pub commission_bps: u64,
    /// Pending operator commission accrued from rewards (claimable).
    pub commission_pool: u128,
    /// True while the validator is jailed and excluded from the active set.
    pub jailed: bool,
    /// Epoch (inclusive) until which the validator is jailed.
    pub jailed_until: u64,
    /// Epoch in which the last commission edit occurred (rate-limit anchor).
    pub last_commission_edit_epoch: u64,
}

impl ValidatorState {
    /// Convert a delegator's shares into the underlying stake amount.
    pub fn shares_to_amount(&self, shares: u128) -> u128 {
        if self.total_shares == 0 {
            return 0;
        }
        mul_div(shares, self.total_stake, self.total_shares)
    }
    /// Convert a stake amount into the equivalent number of shares to mint.
    pub fn amount_to_shares(&self, amount: u128) -> u128 {
        if self.total_shares == 0 || self.total_stake == 0 {
            // Bootstrap: 1 share = 1 wei (scaled).
            amount.saturating_mul(SHARE_PRECISION) / SHARE_PRECISION.max(1)
        } else {
            mul_div(amount, self.total_shares, self.total_stake)
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UnbondingEntry {
    pub delegator: Address,
    pub validator: Address,
    pub amount: u128,
    /// Epoch at which the entry matures and is paid out.
    pub mature_at_epoch: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct StakingModule {
    pub current_epoch: u64,
    /// `validator address → state`.
    pub validators: BTreeMap<Address, ValidatorState>,
    /// `(delegator, validator) → shares`.
    pub delegations: BTreeMap<(Address, Address), u128>,
    /// FIFO queue of pending unbondings.
    pub unbonding_queue: VecDeque<UnbondingEntry>,
    /// Cumulative slashed wei (for telemetry / on-chain inflation tracking).
    pub total_slashed: u128,
}

/// Result of `end_epoch`: liquid wei to credit to each address.
pub type Payout = BTreeMap<Address, u128>;

// ─────────────────────────── API ────────────────────────────────

impl StakingModule {
    pub fn new() -> Self {
        Self::default()
    }

    // ── validator lifecycle ───────────────────────────────────────

    pub fn create_validator(
        &mut self,
        signer: Address,
        pubkey: [u8; 32],
        commission_bps: u64,
        self_bond: u128,
    ) -> Result<(), StakingError> {
        if commission_bps > MAX_COMMISSION_BPS {
            return Err(StakingError::CommissionOutOfRange);
        }
        if self_bond < MIN_SELF_BOND_WEI {
            return Err(StakingError::SelfBondTooSmall);
        }
        let address = crate::crypto::address_from_pubkey(&pubkey);
        if self.validators.contains_key(&address) {
            return Err(StakingError::ValidatorExists(address));
        }
        let mut v = ValidatorState {
            address,
            pubkey,
            operator: signer,
            commission_bps,
            last_commission_edit_epoch: self.current_epoch,
            ..Default::default()
        };
        // Bootstrap delegation: signer self-bonds.
        let shares = v.amount_to_shares(self_bond);
        v.total_stake = self_bond;
        v.total_shares = shares;
        self.validators.insert(address, v);
        self.delegations.insert((signer, address), shares);
        Ok(())
    }

    pub fn edit_validator(
        &mut self,
        signer: Address,
        validator: Address,
        new_commission_bps: Option<u64>,
    ) -> Result<(), StakingError> {
        let v = self
            .validators
            .get_mut(&validator)
            .ok_or(StakingError::ValidatorNotFound(validator))?;
        if v.operator != signer {
            return Err(StakingError::ValidatorNotFound(validator));
        }
        if let Some(new) = new_commission_bps {
            if new > MAX_COMMISSION_BPS {
                return Err(StakingError::CommissionOutOfRange);
            }
            let delta = if new > v.commission_bps {
                new - v.commission_bps
            } else {
                v.commission_bps - new
            };
            if delta > MAX_COMMISSION_BPS_DELTA {
                return Err(StakingError::CommissionChangeTooLarge);
            }
            v.commission_bps = new;
            v.last_commission_edit_epoch = self.current_epoch;
        }
        Ok(())
    }

    // ── delegation ────────────────────────────────────────────────

    pub fn stake(
        &mut self,
        delegator: Address,
        validator: Address,
        amount: u128,
    ) -> Result<u128, StakingError> {
        if amount < MIN_DELEGATION_WEI {
            return Err(StakingError::AmountTooSmall);
        }
        let v = self
            .validators
            .get_mut(&validator)
            .ok_or(StakingError::ValidatorNotFound(validator))?;
        if v.jailed {
            return Err(StakingError::Jailed);
        }
        let shares = v.amount_to_shares(amount);
        v.total_stake = v.total_stake.checked_add(amount).ok_or(StakingError::Overflow)?;
        v.total_shares = v.total_shares.checked_add(shares).ok_or(StakingError::Overflow)?;
        let entry = self.delegations.entry((delegator, validator)).or_insert(0);
        *entry = entry.checked_add(shares).ok_or(StakingError::Overflow)?;
        Ok(shares)
    }

    /// Begin unbonding. Returns the wei amount that will mature.
    pub fn unstake(
        &mut self,
        delegator: Address,
        validator: Address,
        shares: u128,
    ) -> Result<u128, StakingError> {
        let v = self
            .validators
            .get_mut(&validator)
            .ok_or(StakingError::ValidatorNotFound(validator))?;
        let key = (delegator, validator);
        let held = *self.delegations.get(&key).unwrap_or(&0);
        if held < shares || shares == 0 {
            return Err(StakingError::InsufficientShares);
        }
        let amount = v.shares_to_amount(shares);
        v.total_stake = v.total_stake.saturating_sub(amount);
        v.total_shares = v.total_shares.saturating_sub(shares);
        let remaining = held - shares;
        if remaining == 0 {
            self.delegations.remove(&key);
        } else {
            self.delegations.insert(key, remaining);
        }
        self.unbonding_queue.push_back(UnbondingEntry {
            delegator,
            validator,
            amount,
            mature_at_epoch: self.current_epoch + UNBONDING_EPOCHS,
        });
        Ok(amount)
    }

    pub fn redelegate(
        &mut self,
        delegator: Address,
        from: Address,
        to: Address,
        shares: u128,
    ) -> Result<u128, StakingError> {
        if from == to {
            return Err(StakingError::SelfRedelegate);
        }
        // Withdraw from source (no unbonding queue — atomic move).
        let amount = {
            let v = self
                .validators
                .get_mut(&from)
                .ok_or(StakingError::ValidatorNotFound(from))?;
            let key = (delegator, from);
            let held = *self.delegations.get(&key).unwrap_or(&0);
            if held < shares || shares == 0 {
                return Err(StakingError::InsufficientShares);
            }
            let amt = v.shares_to_amount(shares);
            v.total_stake = v.total_stake.saturating_sub(amt);
            v.total_shares = v.total_shares.saturating_sub(shares);
            let remaining = held - shares;
            if remaining == 0 {
                self.delegations.remove(&key);
            } else {
                self.delegations.insert(key, remaining);
            }
            amt
        };
        // Deposit into destination.
        self.stake(delegator, to, amount.max(MIN_DELEGATION_WEI))?;
        Ok(amount)
    }

    /// Convert the operator's accrued commission into a liquid payout.
    /// Delegator rewards auto-compound into shares — there is nothing to claim
    /// for them; their share value simply grows with `total_stake`.
    pub fn claim_rewards(
        &mut self,
        signer: Address,
        validator: Address,
    ) -> Result<u128, StakingError> {
        let v = self
            .validators
            .get_mut(&validator)
            .ok_or(StakingError::ValidatorNotFound(validator))?;
        if v.operator != signer {
            return Err(StakingError::ValidatorNotFound(validator));
        }
        let amt = v.commission_pool;
        v.commission_pool = 0;
        Ok(amt)
    }

    // ── slashing ──────────────────────────────────────────────────

    pub fn slash_double_sign(&mut self, validator: Address) -> Result<u128, StakingError> {
        self.slash(validator, SLASH_DOUBLE_SIGN_BPS, JAIL_EPOCHS_DOUBLE_SIGN)
    }

    pub fn slash_downtime(&mut self, validator: Address) -> Result<u128, StakingError> {
        self.slash(validator, SLASH_DOWNTIME_BPS, JAIL_EPOCHS_DOWNTIME)
    }

    fn slash(
        &mut self,
        validator: Address,
        bps: u64,
        jail_epochs: u64,
    ) -> Result<u128, StakingError> {
        let v = self
            .validators
            .get_mut(&validator)
            .ok_or(StakingError::ValidatorNotFound(validator))?;
        // Reduce total_stake — share math automatically dilutes every delegator
        // by the same fraction without iterating the delegation map.
        let bonded_burn = mul_div(v.total_stake, bps as u128, COMMISSION_BPS_DEN as u128);
        v.total_stake = v.total_stake.saturating_sub(bonded_burn);
        // Slash unbonding entries that belong to this validator (still slashable
        // during cooldown). They were already removed from total_stake at unbond
        // time, so they need an explicit pro-rata cut here.
        let mut unbonding_burn: u128 = 0;
        for u in self.unbonding_queue.iter_mut() {
            if u.validator == validator {
                let cut = mul_div(u.amount, bps as u128, COMMISSION_BPS_DEN as u128);
                u.amount = u.amount.saturating_sub(cut);
                unbonding_burn = unbonding_burn.saturating_add(cut);
            }
        }
        v.jailed = true;
        v.jailed_until = self.current_epoch + jail_epochs;
        let total = bonded_burn.saturating_add(unbonding_burn);
        self.total_slashed = self.total_slashed.saturating_add(total);
        Ok(total)
    }

    pub fn unjail(&mut self, signer: Address, validator: Address) -> Result<(), StakingError> {
        let v = self
            .validators
            .get_mut(&validator)
            .ok_or(StakingError::ValidatorNotFound(validator))?;
        if v.operator != signer {
            return Err(StakingError::ValidatorNotFound(validator));
        }
        if self.current_epoch < v.jailed_until {
            return Err(StakingError::Jailed);
        }
        v.jailed = false;
        Ok(())
    }

    // ── epoch processing ──────────────────────────────────────────

    /// Advance to the next epoch. Distributes `total_reward` proportionally to
    /// each non-jailed validator's `total_stake` (operator commission split
    /// off first), and pays out matured unbonding entries.
    ///
    /// Returns the liquid `Payout` map the caller must credit on-chain.
    pub fn end_epoch(&mut self, total_reward: u128) -> Payout {
        let mut payout: Payout = BTreeMap::new();

        // 1. Distribute rewards proportional to active stake.
        let active_total: u128 = self
            .validators
            .values()
            .filter(|v| !v.jailed)
            .map(|v| v.total_stake)
            .sum();

        if active_total > 0 && total_reward > 0 {
            for v in self.validators.values_mut().filter(|v| !v.jailed) {
                let share = mul_div(total_reward, v.total_stake, active_total);
                if share == 0 {
                    continue;
                }
                let commission =
                    mul_div(share, v.commission_bps as u128, COMMISSION_BPS_DEN as u128);
                let to_pool = share.saturating_sub(commission);
                v.commission_pool = v.commission_pool.saturating_add(commission);
                // Auto-compound: grow total_stake without minting new shares.
                v.total_stake = v.total_stake.saturating_add(to_pool);
            }
        }

        // 2. Mature unbonding entries.
        self.current_epoch += 1;
        while let Some(front) = self.unbonding_queue.front() {
            if front.mature_at_epoch > self.current_epoch {
                break;
            }
            let e = self.unbonding_queue.pop_front().unwrap();
            let slot = payout.entry(e.delegator).or_insert(0);
            *slot = slot.saturating_add(e.amount);
        }

        payout
    }

    // ── views ─────────────────────────────────────────────────────

    /// Top-N validators by total stake, mapped into the consensus `Validator`
    /// struct (voting_power scaled to 1 unit per ZBX, min 1).
    pub fn active_set(&self) -> Vec<Validator> {
        let mut all: Vec<&ValidatorState> =
            self.validators.values().filter(|v| !v.jailed).collect();
        all.sort_by(|a, b| b.total_stake.cmp(&a.total_stake));
        all.into_iter()
            .take(MAX_ACTIVE_VALIDATORS)
            .map(|v| {
                let power = (v.total_stake / 1_000_000_000_000_000_000u128).max(1) as u64;
                Validator { address: v.address, pubkey: v.pubkey, voting_power: power }
            })
            .collect()
    }

    /// Wei value of a delegator's position on a validator (incl. compounded rewards).
    pub fn delegation_value(&self, delegator: Address, validator: Address) -> u128 {
        let shares = *self.delegations.get(&(delegator, validator)).unwrap_or(&0);
        match self.validators.get(&validator) {
            Some(v) => v.shares_to_amount(shares),
            None => 0,
        }
    }

    /// Sum across all validators that this delegator is staking on.
    pub fn total_delegated(&self, delegator: Address) -> u128 {
        let mut delegators_validators: BTreeSet<Address> = BTreeSet::new();
        for ((d, v), _) in self.delegations.iter() {
            if *d == delegator {
                delegators_validators.insert(*v);
            }
        }
        delegators_validators
            .into_iter()
            .map(|v| self.delegation_value(delegator, v))
            .sum()
    }
}

// ─────────────────────────── helpers ────────────────────────────

/// Saturating `(a * b) / c` in u128 via u256 expansion through `primitive_types::U256`.
fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    if c == 0 {
        return 0;
    }
    use primitive_types::U256;
    let prod = U256::from(a).saturating_mul(U256::from(b));
    let res = prod / U256::from(c);
    if res > U256::from(u128::MAX) {
        u128::MAX
    } else {
        res.as_u128()
    }
}

// ─────────────────────────── tests ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(b: u8) -> Address {
        let mut a = [0u8; 20];
        a[0] = b;
        Address(a)
    }

    fn pk(b: u8) -> [u8; 32] {
        let mut p = [0u8; 32];
        p[0] = b;
        p
    }

    fn make_validator(s: &mut StakingModule, op: Address, seed: u8, bond: u128) -> Address {
        let pubkey = pk(seed);
        s.create_validator(op, pubkey, 500, bond).unwrap();
        crate::crypto::address_from_pubkey(&pubkey)
    }

    #[test]
    fn create_stake_and_unstake_roundtrip() {
        let mut s = StakingModule::new();
        let op = addr(1);
        let v = make_validator(&mut s, op, 10, MIN_SELF_BOND_WEI * 2);
        let d = addr(2);
        s.stake(d, v, MIN_DELEGATION_WEI * 100).unwrap();
        let shares = *s.delegations.get(&(d, v)).unwrap();
        assert!(shares > 0);
        let amt = s.unstake(d, v, shares).unwrap();
        // Within rounding: should equal what we deposited (no rewards yet).
        assert!(amt >= MIN_DELEGATION_WEI * 100 - 1 && amt <= MIN_DELEGATION_WEI * 100 + 1);
    }

    #[test]
    fn rewards_compound_on_shares() {
        let mut s = StakingModule::new();
        let op = addr(1);
        let v = make_validator(&mut s, op, 11, MIN_SELF_BOND_WEI);
        let d = addr(2);
        s.stake(d, v, MIN_DELEGATION_WEI * 1_000).unwrap();
        let stake_before = s.delegation_value(d, v);
        // Reward = 100 ZBX, 5% commission.
        let _ = s.end_epoch(100u128 * 1_000_000_000_000_000_000u128);
        let stake_after = s.delegation_value(d, v);
        assert!(stake_after > stake_before, "auto-compound failed");
    }

    #[test]
    fn unbonding_matures_after_cooldown() {
        let mut s = StakingModule::new();
        let op = addr(1);
        let v = make_validator(&mut s, op, 12, MIN_SELF_BOND_WEI);
        let d = addr(2);
        s.stake(d, v, MIN_DELEGATION_WEI * 10).unwrap();
        let shares = *s.delegations.get(&(d, v)).unwrap();
        s.unstake(d, v, shares).unwrap();
        // First epoch end — not matured yet.
        let p = s.end_epoch(0);
        assert!(p.is_empty());
        // Advance UNBONDING_EPOCHS - 1 more times; entry matures on the last call.
        let mut payout: Payout = BTreeMap::new();
        for _ in 0..UNBONDING_EPOCHS {
            let p = s.end_epoch(0);
            for (k, v) in p {
                *payout.entry(k).or_insert(0) += v;
            }
        }
        assert!(payout.get(&d).copied().unwrap_or(0) > 0, "no payout matured");
    }

    #[test]
    fn double_sign_slashes_5_percent() {
        let mut s = StakingModule::new();
        let op = addr(1);
        let v = make_validator(&mut s, op, 13, MIN_SELF_BOND_WEI * 10);
        let before = s.validators.get(&v).unwrap().total_stake;
        let burnt = s.slash_double_sign(v).unwrap();
        let after = s.validators.get(&v).unwrap().total_stake;
        assert_eq!(before - after, burnt);
        assert!(s.validators.get(&v).unwrap().jailed);
        // ~5% of before.
        let expected = before * 5 / 100;
        assert!(burnt.abs_diff(expected) <= 1);
    }

    #[test]
    fn redelegate_moves_stake() {
        let mut s = StakingModule::new();
        let op1 = addr(1);
        let op2 = addr(2);
        let v1 = make_validator(&mut s, op1, 14, MIN_SELF_BOND_WEI);
        let v2 = make_validator(&mut s, op2, 15, MIN_SELF_BOND_WEI);
        let d = addr(9);
        s.stake(d, v1, MIN_DELEGATION_WEI * 50).unwrap();
        let shares = *s.delegations.get(&(d, v1)).unwrap();
        s.redelegate(d, v1, v2, shares).unwrap();
        assert!(s.delegations.get(&(d, v1)).is_none());
        assert!(s.delegations.get(&(d, v2)).copied().unwrap_or(0) > 0);
    }

    #[test]
    fn commission_change_capped_per_epoch() {
        let mut s = StakingModule::new();
        let op = addr(1);
        let v = make_validator(&mut s, op, 16, MIN_SELF_BOND_WEI);
        // Start at 500 bps (5%); jumping to 1000 (+500) should fail.
        assert!(matches!(
            s.edit_validator(op, v, Some(1_000)),
            Err(StakingError::CommissionChangeTooLarge)
        ));
        // +100 bps allowed.
        s.edit_validator(op, v, Some(600)).unwrap();
    }
}
