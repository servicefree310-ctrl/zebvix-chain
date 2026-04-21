// ================================================================
// Module: zebvix::master_pool
// Master AMM Pool — ZBX native base pool
// Rules:
//   - No admin key — protocol-owned, decentralized
//   - x * y = k constant product formula
//   - Manual add_liquidity / remove_liquidity PERMANENTLY DISABLED
//     (anti-rug-pull by design)
//   - Liquidity only adjusts through buy/sell trades
// ================================================================
module zebvix::master_pool {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use zebvix::zbx::ZBX;

    // ── Errors ──
    const E_ZERO_AMOUNT:       u64 = 1;
    const E_INSUFFICIENT_OUT:  u64 = 2;
    const E_SLIPPAGE_TOO_HIGH: u64 = 3;
    const E_ADD_LIQ_DISABLED:  u64 = 100; // permanent
    const E_REMOVE_LIQ_DISABLED: u64 = 101; // permanent

    // ── Master Pool (shared object — no admin) ──
    public struct MasterPool has key {
        id:           UID,
        zbx_reserve:  Balance<ZBX>,
        total_volume: u64,      // lifetime ZBX volume
        total_fees:   u64,      // lifetime fees collected
        fee_bps:      u64,      // base fee (default: 30 bps = 0.3%)
    }

    // ── Initialize (genesis — called once) ──
    fun init(ctx: &mut TxContext) {
        let pool = MasterPool {
            id:           object::new(ctx),
            zbx_reserve:  balance::zero(),
            total_volume:  0,
            total_fees:    0,
            fee_bps:       30, // 0.3%
        };
        transfer::share_object(pool);
    }

    // ── Seed pool with initial ZBX (one-time) ──
    // Can be called to seed the pool; but remove_liquidity is permanently blocked
    public fun seed_pool(pool: &mut MasterPool, zbx_coin: Coin<ZBX>) {
        balance::join(&mut pool.zbx_reserve, coin::into_balance(zbx_coin));
    }

    // ── ADD LIQUIDITY — PERMANENTLY DISABLED ──
    public fun add_liquidity(_pool: &mut MasterPool, _coin: Coin<ZBX>, _ctx: &mut TxContext) {
        abort E_ADD_LIQ_DISABLED
    }

    // ── REMOVE LIQUIDITY — PERMANENTLY DISABLED ──
    public fun remove_liquidity(_pool: &mut MasterPool, _amount: u64, _ctx: &mut TxContext) {
        abort E_REMOVE_LIQ_DISABLED
    }

    // ── Get ZBX output for a given reserve and input (constant product) ──
    // Returns: (zbx_out, fee_mist)
    public fun get_zbx_out(
        pool:         &MasterPool,
        token_in:     u64,
        token_reserve: u64,
    ): (u64, u64) {
        let zbx_reserve = balance::value(&pool.zbx_reserve);
        // x * y = k → out = (y * in_after_fee) / (x + in_after_fee)
        let fee = token_in * pool.fee_bps / 10_000;
        let in_after_fee = token_in - fee;
        let numerator = zbx_reserve * in_after_fee;
        let denominator = token_reserve + in_after_fee;
        let zbx_out = numerator / denominator;
        (zbx_out, fee)
    }

    // ── Get token output for a given ZBX input ──
    // Returns: (token_out, fee_mist)
    public fun get_token_out(
        pool:          &MasterPool,
        zbx_in:        u64,
        token_reserve: u64,
    ): (u64, u64) {
        let zbx_reserve = balance::value(&pool.zbx_reserve);
        let fee = zbx_in * pool.fee_bps / 10_000;
        let in_after_fee = zbx_in - fee;
        let numerator = token_reserve * in_after_fee;
        let denominator = zbx_reserve + in_after_fee;
        let token_out = numerator / denominator;
        (token_out, fee)
    }

    // ── Deposit ZBX (from buys — called by sub_pool) ──
    public(package) fun deposit_zbx(pool: &mut MasterPool, zbx: Balance<ZBX>) {
        let amount = balance::value(&zbx);
        pool.total_volume = pool.total_volume + amount;
        balance::join(&mut pool.zbx_reserve, zbx);
    }

    // ── Withdraw ZBX (for sells — called by sub_pool) ──
    public(package) fun withdraw_zbx(
        pool:   &mut MasterPool,
        amount: u64,
        ctx:    &mut TxContext,
    ): Coin<ZBX> {
        assert!(amount <= balance::value(&pool.zbx_reserve), E_INSUFFICIENT_OUT);
        coin::from_balance(balance::split(&mut pool.zbx_reserve, amount), ctx)
    }

    // ── View functions ──
    public fun zbx_reserve(pool: &MasterPool): u64  { balance::value(&pool.zbx_reserve) }
    public fun total_volume(pool: &MasterPool): u64  { pool.total_volume }
    public fun fee_bps(pool: &MasterPool): u64       { pool.fee_bps }
}
