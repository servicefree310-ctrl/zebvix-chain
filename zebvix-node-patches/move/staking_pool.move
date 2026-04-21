// ================================================================
// Module: zebvix::staking_pool
// Validator Staking + Delegator System
// Rules:
//   - MAX_VALIDATORS = 41 (only 41 slots)
//   - MIN_VALIDATOR_STAKE = 10,000 ZBX + must run a node
//   - MAX_STAKE_PER_SLOT = 5,000,000 ZBX (validator + all delegators)
//   - VALIDATOR_STAKING_APR = 120% (on own stake)
//   - DELEGATOR_APR = 80% (on delegated amount)
//   - VALIDATOR_DELEGATION_BONUS = 40% (on total delegated in their slot)
//   - NODE_DAILY_REWARD = 5 ZBX/day (only node runners get this)
//   - Pre-validator: all rewards → founder treasury
// ================================================================
module zebvix::staking_pool {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::vec_map::{Self, VecMap};
    use zebvix::zbx::ZBX;

    // ── Constants ──
    const MAX_VALIDATORS:               u64 = 41;
    const MIN_VALIDATOR_STAKE_MIST:     u64 = 10_000_000_000_000; // 10,000 ZBX
    const MAX_STAKE_PER_SLOT_MIST:      u64 = 5_000_000_000_000_000; // 5M ZBX
    const VALIDATOR_STAKING_APR_BPS:    u64 = 12_000; // 120% in BPS (1 BPS = 0.01%)
    const DELEGATOR_APR_BPS:            u64 =  8_000; // 80% in BPS
    const VALIDATOR_DELEGATION_BONUS_BPS: u64 = 4_000; // 40% in BPS
    const NODE_DAILY_REWARD_MIST:       u64 = 5_000_000_000; // 5 ZBX
    const EPOCH_DURATION_SECS:          u64 = 86400; // 24 hours

    // ── Errors ──
    const E_VALIDATOR_CAP_REACHED: u64 = 1;
    const E_SLOT_FULL:             u64 = 2;
    const E_MIN_STAKE_NOT_MET:     u64 = 3;
    const E_NOT_VALIDATOR:         u64 = 4;
    const E_NOT_DELEGATOR:         u64 = 5;
    const E_LOCK_PERIOD_NOT_MET:   u64 = 6;
    const E_INVALID_VALIDATOR:     u64 = 7;
    const E_ALREADY_VALIDATOR:     u64 = 8;

    // ── Validator Stake object ──
    public struct ValidatorStake has key, store {
        id:              UID,
        validator_addr:  address,
        staked_balance:  Balance<ZBX>,
        staked_epoch:    u64,
        last_reward_epoch: u64,
        node_wallet:     address, // where node daily rewards go
    }

    // ── Delegator Stake object ──
    public struct DelegatorStake has key, store {
        id:              UID,
        delegator_addr:  address,
        validator_addr:  address,
        staked_balance:  Balance<ZBX>,
        staked_epoch:    u64,
        last_reward_epoch: u64,
    }

    // ── Global Staking Pool (shared object) ──
    public struct StakingPool has key {
        id:                  UID,
        total_staked_mist:   u64,
        active_validators:   u64,
        // validator_addr → total slot stake (self + delegators)
        slot_stakes:         Table<address, u64>,
        // validator_addr → delegated amount in their slot
        slot_delegated:      Table<address, u64>,
        // founder treasury address (pre-validator period)
        founder_treasury:    address,
        // reward pool for distribution
        reward_balance:      Balance<ZBX>,
    }

    // ── NodeWallet — per-node identity ──
    public struct NodeWallet has key, store {
        id:             UID,
        validator_addr: address,
        node_wallet:    address,
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
            founder_treasury:  tx_context::sender(ctx), // founder sets this
            reward_balance:    balance::zero(),
        };
        transfer::share_object(pool);
    }

    // ── Set founder treasury (founder admin only) ──
    public fun set_founder_treasury(
        pool:     &mut StakingPool,
        treasury: address,
        ctx:      &mut TxContext,
    ) {
        // Only current founder can update
        assert!(tx_context::sender(ctx) == pool.founder_treasury, 1);
        pool.founder_treasury = treasury;
    }

    // ── Fund reward pool (protocol mints rewards here) ──
    public fun fund_rewards(pool: &mut StakingPool, coin: Coin<ZBX>) {
        balance::join(&mut pool.reward_balance, coin::into_balance(coin));
    }

    // ── VALIDATOR: stake ZBX + become validator ──
    public fun stake(
        pool:        &mut StakingPool,
        zbx_coin:    Coin<ZBX>,
        node_wallet: address,
        ctx:         &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let amount = coin::value(&zbx_coin);

        // Validations
        assert!(!table::contains(&pool.slot_stakes, sender), E_ALREADY_VALIDATOR);
        assert!(pool.active_validators < MAX_VALIDATORS,      E_VALIDATOR_CAP_REACHED);
        assert!(amount >= MIN_VALIDATOR_STAKE_MIST,           E_MIN_STAKE_NOT_MET);

        // Register slot
        table::add(&mut pool.slot_stakes,    sender, amount);
        table::add(&mut pool.slot_delegated, sender, 0);
        pool.active_validators   = pool.active_validators + 1;
        pool.total_staked_mist   = pool.total_staked_mist + amount;

        // Create ValidatorStake object
        let stake_obj = ValidatorStake {
            id:                object::new(ctx),
            validator_addr:    sender,
            staked_balance:    coin::into_balance(zbx_coin),
            staked_epoch:      tx_context::epoch(ctx),
            last_reward_epoch: tx_context::epoch(ctx),
            node_wallet:       node_wallet,
        };
        transfer::transfer(stake_obj, sender);

        // Register NodeWallet
        let nw = NodeWallet {
            id:               object::new(ctx),
            validator_addr:   sender,
            node_wallet:      node_wallet,
            registered_epoch: tx_context::epoch(ctx),
        };
        transfer::transfer(nw, sender);
    }

    // ── VALIDATOR: unstake ──
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

        let current_epoch = tx_context::epoch(ctx);
        // Minimum 1 epoch lock
        assert!(current_epoch > staked_epoch, E_LOCK_PERIOD_NOT_MET);

        let amount = balance::value(&staked_balance);
        let slot_current = *table::borrow(&pool.slot_stakes, validator_addr);
        let delegated    = *table::borrow(&pool.slot_delegated, validator_addr);

        *table::borrow_mut(&mut pool.slot_stakes, validator_addr) = slot_current - amount;
        pool.active_validators  = pool.active_validators - 1;
        pool.total_staked_mist  = pool.total_staked_mist - (amount + delegated);

        // Remove slot entries
        table::remove(&mut pool.slot_stakes,    validator_addr);
        table::remove(&mut pool.slot_delegated, validator_addr);

        coin::from_balance(staked_balance, ctx)
    }

    // ── VALIDATOR: claim staking APR reward ──
    public fun claim_rewards(
        pool:      &mut StakingPool,
        stake_obj: &mut ValidatorStake,
        ctx:       &mut TxContext,
    ): Coin<ZBX> {
        let current_epoch = tx_context::epoch(ctx);
        let epochs_elapsed = current_epoch - stake_obj.last_reward_epoch;
        if (epochs_elapsed == 0) {
            return coin::from_balance(balance::zero(), ctx)
        };

        let staked_amount = balance::value(&stake_obj.staked_balance);

        // Self-stake APR reward
        let self_reward = staked_amount * VALIDATOR_STAKING_APR_BPS * epochs_elapsed
            / (10_000 * 365);

        // Delegation bonus: 40% APR on delegated amount in slot
        let delegated = if (table::contains(&pool.slot_delegated, stake_obj.validator_addr)) {
            *table::borrow(&pool.slot_delegated, stake_obj.validator_addr)
        } else { 0 };
        let delegation_bonus = delegated * VALIDATOR_DELEGATION_BONUS_BPS * epochs_elapsed
            / (10_000 * 365);

        let total_reward = self_reward + delegation_bonus;
        stake_obj.last_reward_epoch = current_epoch;

        // Pay from reward pool; if insufficient, pay what's available
        let available = balance::value(&pool.reward_balance);
        let pay_amount = if (total_reward > available) { available } else { total_reward };
        coin::from_balance(balance::split(&mut pool.reward_balance, pay_amount), ctx)
    }

    // ── VALIDATOR: claim node daily reward ──
    public fun claim_node_reward(
        pool:      &mut StakingPool,
        stake_obj: &mut ValidatorStake,
        ctx:       &mut TxContext,
    ): Coin<ZBX> {
        let current_epoch = tx_context::epoch(ctx);
        let epochs_elapsed = current_epoch - stake_obj.last_reward_epoch;
        let node_reward = NODE_DAILY_REWARD_MIST * epochs_elapsed;

        let available = balance::value(&pool.reward_balance);
        let pay_amount = if (node_reward > available) { available } else { node_reward };
        coin::from_balance(balance::split(&mut pool.reward_balance, pay_amount), ctx)
    }

    // ── DELEGATOR: delegate to a validator ──
    public fun delegate(
        pool:          &mut StakingPool,
        validator_addr: address,
        zbx_coin:      Coin<ZBX>,
        ctx:           &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let amount = coin::value(&zbx_coin);

        assert!(table::contains(&pool.slot_stakes, validator_addr), E_INVALID_VALIDATOR);

        let current_slot = *table::borrow(&pool.slot_stakes, validator_addr);
        assert!(current_slot + amount <= MAX_STAKE_PER_SLOT_MIST,  E_SLOT_FULL);

        // Update slot totals
        *table::borrow_mut(&mut pool.slot_stakes,    validator_addr) = current_slot + amount;
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

    // ── DELEGATOR: undelegate ──
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

        let current_epoch = tx_context::epoch(ctx);
        assert!(current_epoch > staked_epoch, E_LOCK_PERIOD_NOT_MET);

        let amount = balance::value(&staked_balance);

        if (table::contains(&pool.slot_stakes, validator_addr)) {
            let cs = *table::borrow(&pool.slot_stakes, validator_addr);
            *table::borrow_mut(&mut pool.slot_stakes, validator_addr) =
                if (cs > amount) { cs - amount } else { 0 };
            let cd = *table::borrow(&pool.slot_delegated, validator_addr);
            *table::borrow_mut(&mut pool.slot_delegated, validator_addr) =
                if (cd > amount) { cd - amount } else { 0 };
        };

        pool.total_staked_mist = if (pool.total_staked_mist > amount) {
            pool.total_staked_mist - amount
        } else { 0 };

        coin::from_balance(staked_balance, ctx)
    }

    // ── DELEGATOR: claim delegation rewards (80% APR) ──
    public fun claim_delegation_rewards(
        pool:       &mut StakingPool,
        delegation: &mut DelegatorStake,
        ctx:        &mut TxContext,
    ): Coin<ZBX> {
        let current_epoch = tx_context::epoch(ctx);
        let epochs_elapsed = current_epoch - delegation.last_reward_epoch;
        if (epochs_elapsed == 0) {
            return coin::from_balance(balance::zero(), ctx)
        };

        let staked = balance::value(&delegation.staked_balance);
        let reward = staked * DELEGATOR_APR_BPS * epochs_elapsed / (10_000 * 365);
        delegation.last_reward_epoch = current_epoch;

        let available = balance::value(&pool.reward_balance);
        let pay_amount = if (reward > available) { available } else { reward };
        coin::from_balance(balance::split(&mut pool.reward_balance, pay_amount), ctx)
    }

    // ── View functions ──
    public fun active_validators(pool: &StakingPool): u64 { pool.active_validators }
    public fun total_staked(pool: &StakingPool): u64      { pool.total_staked_mist }
    public fun slots_remaining(pool: &StakingPool): u64   { MAX_VALIDATORS - pool.active_validators }

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

    public fun is_slot_full(pool: &StakingPool, validator_addr: address): bool {
        slot_stake(pool, validator_addr) >= MAX_STAKE_PER_SLOT_MIST
    }

    public fun founder_treasury(pool: &StakingPool): address { pool.founder_treasury }
}
