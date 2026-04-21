// ================================================================
// Module: zebvix::staking_pool
// Validator Staking + Delegator System
// Rules:
//   - MAX_VALIDATORS = 41 (only 41 slots)
//   - MIN_VALIDATOR_STAKE = 10,000 ZBX
//   - MAX_VALIDATOR_STAKE = 250,000 ZBX (validator's own stake only)
//   - GLOBAL_STAKE_CAP = 5,000,000 ZBX (ALL validators + ALL delegators combined)
//   - Math: 41 slots × 10,000 min = 410,000 ZBX minimum commitment; joining
//     one slot (10,000) leaves 400,000 ZBX for remaining 40 validators
//   - VALIDATOR_STAKING_APR = 120% (on own stake)
//   - DELEGATOR_APR = 80% (on delegated amount)
//   - VALIDATOR_DELEGATION_BONUS = 40% (on total delegated in their slot)
//   - NODE_DAILY_REWARD = 5 ZBX/day (only node runners get this)
//   - Reward distribution per epoch:
//       active_slots   → reward_balance (validators/delegators claim from here)
//       empty_slots    → founder treasury (slot subsidy for unfilled positions)
//       0 validators   → all rewards → founder treasury
// ================================================================
module zebvix::staking_pool {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use zebvix::zbx::ZBX;

    // ── Constants ──
    const MAX_VALIDATORS:                u64 = 41;
    const MIN_VALIDATOR_STAKE_MIST:      u64 =     10_000_000_000_000; // 10,000 ZBX
    const MAX_VALIDATOR_STAKE_MIST:      u64 =    250_000_000_000_000; // 250,000 ZBX (per validator, own stake only)
    const GLOBAL_STAKE_CAP_MIST:         u64 =  5_000_000_000_000_000; // 5,000,000 ZBX total (validators + delegators)
    const VALIDATOR_STAKING_APR_BPS:     u64 = 12_000; // 120% APR in BPS
    const DELEGATOR_APR_BPS:             u64 =  8_000; //  80% APR in BPS
    const VALIDATOR_DELEGATION_BONUS_BPS: u64 = 4_000; //  40% bonus APR on delegated amount
    const NODE_DAILY_REWARD_MIST:        u64 = 5_000_000_000; // 5 ZBX/day

    // ── Errors ──
    const E_VALIDATOR_CAP_REACHED:   u64 = 1;
    const E_GLOBAL_CAP_REACHED:      u64 = 2; // total 5M ZBX pool is full
    const E_MIN_STAKE_NOT_MET:       u64 = 3;
    const E_NOT_VALIDATOR:           u64 = 4;
    const E_NOT_DELEGATOR:           u64 = 5;
    const E_LOCK_PERIOD_NOT_MET:     u64 = 6;
    const E_INVALID_VALIDATOR:       u64 = 7;
    const E_ALREADY_VALIDATOR:       u64 = 8;
    const E_MAX_VALIDATOR_STAKE:     u64 = 9; // validator's own stake > 250,000 ZBX

    // ── Validator Stake object ──
    public struct ValidatorStake has key, store {
        id:                UID,
        validator_addr:    address,
        staked_balance:    Balance<ZBX>,
        staked_epoch:      u64,
        last_reward_epoch: u64,
        node_wallet:       address,
    }

    // ── Delegator Stake object ──
    public struct DelegatorStake has key, store {
        id:                UID,
        delegator_addr:    address,
        validator_addr:    address,
        staked_balance:    Balance<ZBX>,
        staked_epoch:      u64,
        last_reward_epoch: u64,
    }

    // ── Global Staking Pool (shared object) ──
    public struct StakingPool has key {
        id:                UID,
        total_staked_mist: u64,  // total locked = all validators + all delegators
        active_validators: u64,
        // validator_addr → validator's own stake amount
        slot_stakes:       Table<address, u64>,
        // validator_addr → total delegated into this slot
        slot_delegated:    Table<address, u64>,
        // founder treasury address — receives empty-slot subsidy
        founder_treasury:  address,
        // reward balance — active validators + delegators claim from here
        reward_balance:    Balance<ZBX>,
    }

    // ── NodeWallet — per-node identity ──
    public struct NodeWallet has key, store {
        id:               UID,
        validator_addr:   address,
        node_wallet:      address,
        registered_epoch: u64,
    }

    // ── Initialize pool (genesis) ──
    fun init(ctx: &mut TxContext) {
        let pool = StakingPool {
            id:                object::new(ctx),
            total_staked_mist: 0,
            active_validators: 0,
            slot_stakes:       table::new(ctx),
            slot_delegated:    table::new(ctx),
            founder_treasury:  tx_context::sender(ctx),
            reward_balance:    balance::zero(),
        };
        transfer::share_object(pool);
    }

    // ── Set founder treasury (founder only, called once) ──
    public fun set_founder_treasury(
        pool:     &mut StakingPool,
        treasury: address,
        ctx:      &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == pool.founder_treasury, 1);
        pool.founder_treasury = treasury;
    }

    // ──────────────────────────────────────────────────────────────────────
    // EPOCH REWARD DISTRIBUTION
    // Called by the protocol each epoch with the epoch's total reward coin.
    // Splits reward between active validators and founder (empty slots):
    //
    //   active_share  = total × active_validators / MAX_VALIDATORS
    //   founder_share = total − active_share   (for empty validator slots)
    //
    // If 0 validators: entire reward → founder treasury (pre-launch period).
    // If all 41 slots filled: entire reward → reward_balance.
    // ──────────────────────────────────────────────────────────────────────
    public fun distribute_epoch_reward(
        pool:        &mut StakingPool,
        reward_coin: Coin<ZBX>,
        ctx:         &mut TxContext,
    ) {
        let total = coin::value(&reward_coin);
        let mut reward_bal = coin::into_balance(reward_coin);

        if (pool.active_validators == 0 || total == 0) {
            // Pre-validator period OR zero reward: all → founder treasury
            transfer::public_transfer(
                coin::from_balance(reward_bal, ctx),
                pool.founder_treasury,
            );
        } else if (pool.active_validators >= MAX_VALIDATORS) {
            // All 41 slots filled → everything to validators/delegators
            balance::join(&mut pool.reward_balance, reward_bal);
        } else {
            // Partial fill: split proportionally
            //   active_share  = total * active_validators / MAX_VALIDATORS
            //   founder_share = total - active_share
            let active_share  = total * pool.active_validators / MAX_VALIDATORS;
            let founder_share = total - active_share;

            // Put active share in reward pool for validators/delegators
            balance::join(
                &mut pool.reward_balance,
                balance::split(&mut reward_bal, active_share),
            );

            // Remaining (founder_share) → founder treasury
            // reward_bal now holds exactly founder_share
            if (founder_share > 0) {
                transfer::public_transfer(
                    coin::from_balance(reward_bal, ctx),
                    pool.founder_treasury,
                );
            } else {
                // edge: active_share rounded up to total, destroy remainder
                balance::destroy_zero(reward_bal);
            };
        }
    }

    // ── Legacy: direct fund (e.g. from genesis treasury) ──
    public fun fund_rewards(pool: &mut StakingPool, coin: Coin<ZBX>) {
        balance::join(&mut pool.reward_balance, coin::into_balance(coin));
    }

    // ──────────────────────────────────────────────────────────────────────
    // VALIDATOR: stake ZBX and become a validator
    //
    // Constraints:
    //   1. Sender not already a validator
    //   2. Active slots < 41
    //   3. amount >= 10,000 ZBX  (MIN_VALIDATOR_STAKE)
    //   4. amount <= 250,000 ZBX (MAX_VALIDATOR_STAKE — validator's own only)
    //   5. pool.total_staked + amount <= 5,000,000 ZBX (GLOBAL_STAKE_CAP)
    // ──────────────────────────────────────────────────────────────────────
    public fun stake(
        pool:        &mut StakingPool,
        zbx_coin:    Coin<ZBX>,
        node_wallet: address,
        ctx:         &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let amount = coin::value(&zbx_coin);

        assert!(!table::contains(&pool.slot_stakes, sender),           E_ALREADY_VALIDATOR);
        assert!(pool.active_validators < MAX_VALIDATORS,               E_VALIDATOR_CAP_REACHED);
        assert!(amount >= MIN_VALIDATOR_STAKE_MIST,                    E_MIN_STAKE_NOT_MET);
        assert!(amount <= MAX_VALIDATOR_STAKE_MIST,                    E_MAX_VALIDATOR_STAKE);
        assert!(pool.total_staked_mist + amount <= GLOBAL_STAKE_CAP_MIST, E_GLOBAL_CAP_REACHED);

        table::add(&mut pool.slot_stakes,    sender, amount);
        table::add(&mut pool.slot_delegated, sender, 0);
        pool.active_validators  = pool.active_validators + 1;
        pool.total_staked_mist  = pool.total_staked_mist + amount;

        let stake_obj = ValidatorStake {
            id:                object::new(ctx),
            validator_addr:    sender,
            staked_balance:    coin::into_balance(zbx_coin),
            staked_epoch:      tx_context::epoch(ctx),
            last_reward_epoch: tx_context::epoch(ctx),
            node_wallet:       node_wallet,
        };
        transfer::transfer(stake_obj, sender);

        let nw = NodeWallet {
            id:               object::new(ctx),
            validator_addr:   sender,
            node_wallet:      node_wallet,
            registered_epoch: tx_context::epoch(ctx),
        };
        transfer::transfer(nw, sender);
    }

    // ── VALIDATOR: unstake (min 1 epoch lock) ──
    public fun unstake(
        pool:      &mut StakingPool,
        stake_obj: ValidatorStake,
        ctx:       &mut TxContext,
    ): Coin<ZBX> {
        let ValidatorStake {
            id, validator_addr, staked_balance, staked_epoch,
            last_reward_epoch: _, node_wallet: _,
        } = stake_obj;
        object::delete(id);

        assert!(tx_context::epoch(ctx) > staked_epoch, E_LOCK_PERIOD_NOT_MET);

        let amount   = balance::value(&staked_balance);
        let delegated = *table::borrow(&pool.slot_delegated, validator_addr);

        table::remove(&mut pool.slot_stakes,    validator_addr);
        table::remove(&mut pool.slot_delegated, validator_addr);
        pool.active_validators = pool.active_validators - 1;

        // Remove only the validator's own stake from total (delegators will undelegate separately)
        pool.total_staked_mist = if (pool.total_staked_mist > amount) {
            pool.total_staked_mist - amount
        } else { 0 };

        let _ = delegated; // delegated stays in total until delegators undelegate
        coin::from_balance(staked_balance, ctx)
    }

    // ── VALIDATOR: claim staking APR + delegation bonus rewards ──
    public fun claim_rewards(
        pool:      &mut StakingPool,
        stake_obj: &mut ValidatorStake,
        ctx:       &mut TxContext,
    ): Coin<ZBX> {
        let current_epoch  = tx_context::epoch(ctx);
        let epochs_elapsed = current_epoch - stake_obj.last_reward_epoch;
        if (epochs_elapsed == 0) {
            return coin::from_balance(balance::zero(), ctx)
        };

        let staked_amount = balance::value(&stake_obj.staked_balance);

        // Self-stake: 120% APR
        let self_reward = staked_amount * VALIDATOR_STAKING_APR_BPS * epochs_elapsed
            / (10_000 * 365);

        // Delegation bonus: 40% APR on delegated in slot
        let delegated = if (table::contains(&pool.slot_delegated, stake_obj.validator_addr)) {
            *table::borrow(&pool.slot_delegated, stake_obj.validator_addr)
        } else { 0 };
        let delegation_bonus = delegated * VALIDATOR_DELEGATION_BONUS_BPS * epochs_elapsed
            / (10_000 * 365);

        let total_reward = self_reward + delegation_bonus;
        stake_obj.last_reward_epoch = current_epoch;

        let available  = balance::value(&pool.reward_balance);
        let pay_amount = if (total_reward > available) { available } else { total_reward };
        coin::from_balance(balance::split(&mut pool.reward_balance, pay_amount), ctx)
    }

    // ── VALIDATOR: claim node daily reward (5 ZBX/day for running a node) ──
    public fun claim_node_reward(
        pool:      &mut StakingPool,
        stake_obj: &mut ValidatorStake,
        ctx:       &mut TxContext,
    ): Coin<ZBX> {
        let current_epoch  = tx_context::epoch(ctx);
        let epochs_elapsed = current_epoch - stake_obj.last_reward_epoch;
        let node_reward    = NODE_DAILY_REWARD_MIST * epochs_elapsed;

        let available  = balance::value(&pool.reward_balance);
        let pay_amount = if (node_reward > available) { available } else { node_reward };
        coin::from_balance(balance::split(&mut pool.reward_balance, pay_amount), ctx)
    }

    // ──────────────────────────────────────────────────────────────────────
    // DELEGATOR: delegate ZBX to an active validator slot
    //
    // Constraints:
    //   1. Target validator must exist
    //   2. pool.total_staked + amount <= 5,000,000 ZBX (GLOBAL_STAKE_CAP)
    //      (no per-slot limit; global cap protects overall supply)
    // ──────────────────────────────────────────────────────────────────────
    public fun delegate(
        pool:           &mut StakingPool,
        validator_addr: address,
        zbx_coin:       Coin<ZBX>,
        ctx:            &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let amount = coin::value(&zbx_coin);

        assert!(table::contains(&pool.slot_stakes, validator_addr), E_INVALID_VALIDATOR);
        assert!(
            pool.total_staked_mist + amount <= GLOBAL_STAKE_CAP_MIST,
            E_GLOBAL_CAP_REACHED,
        );

        *table::borrow_mut(&mut pool.slot_stakes,    validator_addr) =
            *table::borrow(&pool.slot_stakes, validator_addr) + amount;
        *table::borrow_mut(&mut pool.slot_delegated, validator_addr) =
            *table::borrow(&pool.slot_delegated, validator_addr) + amount;
        pool.total_staked_mist = pool.total_staked_mist + amount;

        let delegation_obj = DelegatorStake {
            id:                object::new(ctx),
            delegator_addr:    sender,
            validator_addr:    validator_addr,
            staked_balance:    coin::into_balance(zbx_coin),
            staked_epoch:      tx_context::epoch(ctx),
            last_reward_epoch: tx_context::epoch(ctx),
        };
        transfer::transfer(delegation_obj, sender);
    }

    // ── DELEGATOR: undelegate (min 1 epoch lock) ──
    public fun undelegate(
        pool:       &mut StakingPool,
        delegation: DelegatorStake,
        ctx:        &mut TxContext,
    ): Coin<ZBX> {
        let DelegatorStake {
            id, delegator_addr: _, validator_addr,
            staked_balance, staked_epoch, last_reward_epoch: _,
        } = delegation;
        object::delete(id);

        assert!(tx_context::epoch(ctx) > staked_epoch, E_LOCK_PERIOD_NOT_MET);

        let amount = balance::value(&staked_balance);

        if (table::contains(&pool.slot_stakes, validator_addr)) {
            let cs = *table::borrow(&pool.slot_stakes,    validator_addr);
            let cd = *table::borrow(&pool.slot_delegated, validator_addr);
            *table::borrow_mut(&mut pool.slot_stakes,    validator_addr) =
                if (cs > amount) { cs - amount } else { 0 };
            *table::borrow_mut(&mut pool.slot_delegated, validator_addr) =
                if (cd > amount) { cd - amount } else { 0 };
        };

        pool.total_staked_mist = if (pool.total_staked_mist > amount) {
            pool.total_staked_mist - amount
        } else { 0 };

        coin::from_balance(staked_balance, ctx)
    }

    // ── DELEGATOR: claim 80% APR rewards ──
    public fun claim_delegation_rewards(
        pool:       &mut StakingPool,
        delegation: &mut DelegatorStake,
        ctx:        &mut TxContext,
    ): Coin<ZBX> {
        let current_epoch  = tx_context::epoch(ctx);
        let epochs_elapsed = current_epoch - delegation.last_reward_epoch;
        if (epochs_elapsed == 0) {
            return coin::from_balance(balance::zero(), ctx)
        };

        let staked  = balance::value(&delegation.staked_balance);
        let reward  = staked * DELEGATOR_APR_BPS * epochs_elapsed / (10_000 * 365);
        delegation.last_reward_epoch = current_epoch;

        let available  = balance::value(&pool.reward_balance);
        let pay_amount = if (reward > available) { available } else { reward };
        coin::from_balance(balance::split(&mut pool.reward_balance, pay_amount), ctx)
    }

    // ── View functions ──
    public fun active_validators(pool: &StakingPool): u64  { pool.active_validators }
    public fun total_staked(pool: &StakingPool): u64       { pool.total_staked_mist }
    public fun slots_remaining(pool: &StakingPool): u64    { MAX_VALIDATORS - pool.active_validators }
    public fun founder_treasury(pool: &StakingPool): address { pool.founder_treasury }
    public fun global_cap_remaining(pool: &StakingPool): u64 {
        if (GLOBAL_STAKE_CAP_MIST > pool.total_staked_mist) {
            GLOBAL_STAKE_CAP_MIST - pool.total_staked_mist
        } else { 0 }
    }

    public fun slot_stake(pool: &StakingPool, validator_addr: address): u64 {
        if (table::contains(&pool.slot_stakes, validator_addr)) {
            *table::borrow(&pool.slot_stakes, validator_addr)
        } else { 0 }
    }

    public fun slot_delegated(pool: &StakingPool, validator_addr: address): u64 {
        if (table::contains(&pool.slot_delegated, validator_addr)) {
            *table::borrow(&pool.slot_delegated, validator_addr)
        } else { 0 }
    }

    public fun is_global_cap_reached(pool: &StakingPool): bool {
        pool.total_staked_mist >= GLOBAL_STAKE_CAP_MIST
    }
}
