// ================================================================
// Module: zebvix::sub_pool
// Sub Pool — Permissionless token pair pools (linked to MasterPool)
// Rules:
//   - Koi bhi SubPool<T> create kar sakta hai
//   - No owner field — only creator_fee_addr (receives fee)
//   - x * y = k formula
//   - add_liquidity / remove_liquidity PERMANENTLY DISABLED
//   - Creator gets fee_bps (e.g. 0.3%) on every trade
// ================================================================
module zebvix::sub_pool {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use zebvix::zbx::ZBX;
    use zebvix::master_pool::{Self, MasterPool};

    // ── Errors ──
    const E_ZERO_AMOUNT:          u64 = 1;
    const E_INSUFFICIENT_OUT:     u64 = 2;
    const E_SLIPPAGE_TOO_HIGH:    u64 = 3;
    const E_MIN_OUT_NOT_MET:      u64 = 4;
    const E_ADD_LIQ_DISABLED:     u64 = 100; // PERMANENT — anti-rug
    const E_REMOVE_LIQ_DISABLED:  u64 = 101; // PERMANENT — anti-rug
    const E_POOL_EMPTY:           u64 = 102;

    const MAX_FEE_BPS: u64 = 1000; // Max 10% fee cap
    const MIN_FEE_BPS: u64 = 1;    // Min 0.01% fee

    // ── SubPool<T> — no owner, only creator_fee_addr ──
    public struct SubPool<phantom T> has key {
        id:               UID,
        token_reserve:    Balance<T>,
        zbx_reserve:      Balance<ZBX>,
        creator_fee_addr: address,   // creator gets fee — no ownership
        fee_bps:          u64,       // e.g. 30 = 0.3%
        total_volume_zbx: u64,
        total_fees_zbx:   u64,
    }

    // ── Create a new SubPool (permissionless) ──
    public fun create<T>(
        master:          &mut MasterPool,
        initial_tokens:  Coin<T>,
        initial_zbx:     Coin<ZBX>,
        fee_bps:         u64,
        ctx:             &mut TxContext,
    ) {
        assert!(fee_bps >= MIN_FEE_BPS && fee_bps <= MAX_FEE_BPS, E_ZERO_AMOUNT);
        assert!(coin::value(&initial_tokens) > 0, E_ZERO_AMOUNT);
        assert!(coin::value(&initial_zbx) > 0, E_ZERO_AMOUNT);

        // Creator gets fee only — no ownership, no admin powers
        let creator = tx_context::sender(ctx);

        // Deposit ZBX side into master pool
        master_pool::deposit_zbx(master, coin::into_balance(initial_zbx));

        let pool = SubPool<T> {
            id:               object::new(ctx),
            token_reserve:    coin::into_balance(initial_tokens),
            zbx_reserve:      balance::zero(), // ZBX tracked in master pool
            creator_fee_addr: creator,
            fee_bps:          fee_bps,
            total_volume_zbx: 0,
            total_fees_zbx:   0,
        };
        transfer::share_object(pool);
    }

    // ── ADD LIQUIDITY — PERMANENTLY DISABLED (anti-rug) ──
    public fun add_liquidity<T>(
        _pool:   &mut SubPool<T>,
        _tokens: Coin<T>,
        _zbx:    Coin<ZBX>,
        _ctx:    &mut TxContext,
    ) {
        abort E_ADD_LIQ_DISABLED
    }

    // ── REMOVE LIQUIDITY — PERMANENTLY DISABLED (anti-rug) ──
    public fun remove_liquidity<T>(
        _pool:   &mut SubPool<T>,
        _amount: u64,
        _ctx:    &mut TxContext,
    ) {
        abort E_REMOVE_LIQ_DISABLED
    }

    // ── BUY: spend ZBX → get token ──
    public fun buy<T>(
        pool:        &mut SubPool<T>,
        master:      &mut MasterPool,
        zbx_in:      Coin<ZBX>,
        min_out:     u64,        // slippage protection
        ctx:         &mut TxContext,
    ): Coin<T> {
        let zbx_amount = coin::value(&zbx_in);
        assert!(zbx_amount > 0, E_ZERO_AMOUNT);

        let token_reserve = balance::value(&pool.token_reserve);
        assert!(token_reserve > 0, E_POOL_EMPTY);

        // Calculate output using master pool's ZBX reserve
        let zbx_reserve = master_pool::zbx_reserve(master);
        let fee_amount = zbx_amount * pool.fee_bps / 10_000;
        let in_after_fee = zbx_amount - fee_amount;

        let numerator = token_reserve * in_after_fee;
        let denominator = zbx_reserve + in_after_fee;
        let token_out = numerator / denominator;

        assert!(token_out >= min_out, E_MIN_OUT_NOT_MET);
        assert!(token_out < token_reserve, E_INSUFFICIENT_OUT);

        // Deposit ZBX into master pool
        master_pool::deposit_zbx(master, coin::into_balance(zbx_in));

        // Send creator fee (in ZBX — already deposited, track separately)
        pool.total_volume_zbx = pool.total_volume_zbx + zbx_amount;
        pool.total_fees_zbx   = pool.total_fees_zbx + fee_amount;

        // Pay fee to creator (mint from fee tracked — simplified)
        // In production: fee withdrawal separate function

        // Return tokens to buyer
        coin::from_balance(balance::split(&mut pool.token_reserve, token_out), ctx)
    }

    // ── SELL: spend token → get ZBX ──
    public fun sell<T>(
        pool:       &mut SubPool<T>,
        master:     &mut MasterPool,
        token_in:   Coin<T>,
        min_zbx:    u64,        // slippage protection
        ctx:        &mut TxContext,
    ): Coin<ZBX> {
        let token_amount = coin::value(&token_in);
        assert!(token_amount > 0, E_ZERO_AMOUNT);

        let zbx_reserve   = master_pool::zbx_reserve(master);
        let token_reserve = balance::value(&pool.token_reserve);
        assert!(zbx_reserve > 0, E_POOL_EMPTY);

        let fee_amount   = token_amount * pool.fee_bps / 10_000;
        let in_after_fee = token_amount - fee_amount;

        let numerator   = zbx_reserve * in_after_fee;
        let denominator = token_reserve + in_after_fee;
        let zbx_out     = numerator / denominator;

        assert!(zbx_out >= min_zbx, E_MIN_OUT_NOT_MET);
        assert!(zbx_out < zbx_reserve, E_INSUFFICIENT_OUT);

        // Deposit tokens into pool
        balance::join(&mut pool.token_reserve, coin::into_balance(token_in));

        pool.total_volume_zbx = pool.total_volume_zbx + zbx_out;
        pool.total_fees_zbx   = pool.total_fees_zbx + (zbx_out * pool.fee_bps / 10_000);

        // Withdraw ZBX from master pool
        master_pool::withdraw_zbx(master, zbx_out, ctx)
    }

    // ── SWAP: token A ↔ token B (via ZBX bridge) ──
    // First sell tokenA for ZBX, then buy tokenB with that ZBX
    // Caller handles routing — simplified entry point
    public fun swap_a_to_b<A, B>(
        pool_a:   &mut SubPool<A>,
        pool_b:   &mut SubPool<B>,
        master:   &mut MasterPool,
        token_in: Coin<A>,
        min_out:  u64,
        ctx:      &mut TxContext,
    ): Coin<B> {
        // Sell A for ZBX
        let zbx = sell<A>(pool_a, master, token_in, 0, ctx);
        // Buy B with ZBX
        buy<B>(pool_b, master, zbx, min_out, ctx)
    }

    // ── Creator fee claim (collected fees) ──
    public fun claim_creator_fees<T>(
        pool:    &mut SubPool<T>,
        master:  &mut MasterPool,
        ctx:     &mut TxContext,
    ): Coin<ZBX> {
        assert!(tx_context::sender(ctx) == pool.creator_fee_addr, 1);
        let fee_amount = pool.total_fees_zbx;
        pool.total_fees_zbx = 0;
        let available = master_pool::zbx_reserve(master);
        let pay_amount = if (fee_amount > available) { available } else { fee_amount };
        master_pool::withdraw_zbx(master, pay_amount, ctx)
    }

    // ── View functions ──
    public fun token_reserve<T>(pool: &SubPool<T>): u64 {
        balance::value(&pool.token_reserve)
    }
    public fun creator_fee_addr<T>(pool: &SubPool<T>): address { pool.creator_fee_addr }
    public fun fee_bps<T>(pool: &SubPool<T>): u64              { pool.fee_bps }
    public fun total_volume<T>(pool: &SubPool<T>): u64         { pool.total_volume_zbx }

    // ── Get price quote (read-only) ──
    public fun quote_buy<T>(
        pool:   &SubPool<T>,
        master: &MasterPool,
        zbx_in: u64,
    ): u64 {
        let zbx_reserve   = master_pool::zbx_reserve(master);
        let token_reserve = balance::value(&pool.token_reserve);
        let in_after_fee  = zbx_in - (zbx_in * pool.fee_bps / 10_000);
        (token_reserve * in_after_fee) / (zbx_reserve + in_after_fee)
    }

    public fun quote_sell<T>(
        pool:       &SubPool<T>,
        master:     &MasterPool,
        token_in:   u64,
    ): u64 {
        let zbx_reserve   = master_pool::zbx_reserve(master);
        let token_reserve = balance::value(&pool.token_reserve);
        let in_after_fee  = token_in - (token_in * pool.fee_bps / 10_000);
        (zbx_reserve * in_after_fee) / (token_reserve + in_after_fee)
    }
}
