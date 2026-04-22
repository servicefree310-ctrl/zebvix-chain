//! On-chain AMM pool — Uniswap V2 style constant-product formula.
//!
//! Single ZBX/zUSD pool. Founder seeds initial liquidity; anyone can swap.
//! Provides decentralized ZBX→USD price oracle for dynamic gas pricing.

use serde::{Deserialize, Serialize};

/// Pool fee = 0.3% (30 / 10_000), Uniswap V2 default.
pub const POOL_FEE_NUM: u128 = 3;
pub const POOL_FEE_DEN: u128 = 1000;

/// Minimum LP tokens locked permanently to prevent share-price manipulation.
pub const MIN_LIQUIDITY: u128 = 1_000;

/// 1 zUSD = 10^18 micro-units (same scale as ZBX wei). 1 zUSD = $1 by definition.
pub const ZUSD_PER_DOLLAR: u128 = 1_000_000_000_000_000_000u128;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Pool {
    /// Reserves of ZBX (in wei).
    pub zbx_reserve: u128,
    /// Reserves of zUSD (in 18-decimal units, $1 = 10^18).
    pub zusd_reserve: u128,
    /// Total LP tokens minted.
    pub lp_supply: u128,
    /// Block height of last TWAP cumulative update.
    pub last_update_height: u64,
    /// Cumulative price (zusd_per_zbx, 18-dec) × blocks_elapsed. Used for TWAP.
    pub price_cumulative: u128,
    /// Block height when pool was first initialized (genesis-like marker).
    pub init_height: u64,
}

impl Pool {
    pub fn is_initialized(&self) -> bool {
        self.lp_supply > 0
    }

    /// Spot price: how many zUSD wei per 1 ZBX wei (scaled by 10^18 so result has 18 decimals).
    /// e.g. if 1 ZBX = $0.50, returns 5 × 10^17.
    pub fn spot_price_zusd_per_zbx(&self) -> u128 {
        if self.zbx_reserve == 0 {
            return 0;
        }
        // Use u256-ish math via separate scaling to avoid overflow:
        // price_q18 = zusd_reserve * 10^18 / zbx_reserve
        // For very large reserves we cap with saturating_mul.
        let scale: u128 = 1_000_000_000_000_000_000;
        self.zusd_reserve
            .saturating_mul(scale)
            .checked_div(self.zbx_reserve)
            .unwrap_or(0)
    }

    /// Initialize the pool with first liquidity. Returns LP tokens minted.
    pub fn init_liquidity(&mut self, zbx: u128, zusd: u128, height: u64) -> Result<u128, &'static str> {
        if self.is_initialized() {
            return Err("pool already initialized");
        }
        if zbx == 0 || zusd == 0 {
            return Err("zero liquidity");
        }
        // First LP = sqrt(zbx * zusd) - MIN_LIQUIDITY
        let k = isqrt_u128(zbx.saturating_mul(zusd));
        if k <= MIN_LIQUIDITY {
            return Err("initial liquidity too small");
        }
        let lp_to_user = k - MIN_LIQUIDITY;
        self.zbx_reserve = zbx;
        self.zusd_reserve = zusd;
        self.lp_supply = k; // includes locked MIN_LIQUIDITY
        self.init_height = height;
        self.last_update_height = height;
        self.price_cumulative = 0;
        Ok(lp_to_user)
    }

    /// Add proportional liquidity. Returns LP tokens minted to provider.
    pub fn add_liquidity(&mut self, zbx_max: u128, zusd_max: u128, height: u64) -> Result<(u128, u128, u128), &'static str> {
        if !self.is_initialized() {
            return Err("pool not initialized");
        }
        // Compute optimal amounts to maintain ratio.
        // zbx_optimal = zusd_max * zbx_reserve / zusd_reserve
        let zbx_optimal = zusd_max
            .saturating_mul(self.zbx_reserve)
            .checked_div(self.zusd_reserve)
            .unwrap_or(0);

        let (zbx_in, zusd_in) = if zbx_optimal <= zbx_max {
            (zbx_optimal, zusd_max)
        } else {
            let zusd_optimal = zbx_max
                .saturating_mul(self.zusd_reserve)
                .checked_div(self.zbx_reserve)
                .unwrap_or(0);
            (zbx_max, zusd_optimal)
        };

        if zbx_in == 0 || zusd_in == 0 {
            return Err("dust amount");
        }

        // LP minted = min(zbx_in / zbx_reserve, zusd_in / zusd_reserve) * lp_supply
        let lp_from_zbx = zbx_in.saturating_mul(self.lp_supply) / self.zbx_reserve;
        let lp_from_zusd = zusd_in.saturating_mul(self.lp_supply) / self.zusd_reserve;
        let lp_minted = lp_from_zbx.min(lp_from_zusd);
        if lp_minted == 0 {
            return Err("zero LP minted");
        }

        self.update_oracle(height);
        self.zbx_reserve = self.zbx_reserve.saturating_add(zbx_in);
        self.zusd_reserve = self.zusd_reserve.saturating_add(zusd_in);
        self.lp_supply = self.lp_supply.saturating_add(lp_minted);
        Ok((zbx_in, zusd_in, lp_minted))
    }

    /// Swap ZBX in → zUSD out. Returns zUSD output (after 0.3% fee).
    pub fn swap_zbx_for_zusd(&mut self, zbx_in: u128, height: u64) -> Result<u128, &'static str> {
        if !self.is_initialized() { return Err("pool not initialized"); }
        if zbx_in == 0 { return Err("zero input"); }
        if zbx_in > crate::tokenomics::MAX_SWAP_ZBX_WEI {
            return Err("amount exceeds max swap limit (100,000 ZBX per tx)");
        }
        let amount_in_after_fee = zbx_in.saturating_mul(POOL_FEE_DEN - POOL_FEE_NUM);
        let numerator = amount_in_after_fee.saturating_mul(self.zusd_reserve);
        let denominator = self.zbx_reserve.saturating_mul(POOL_FEE_DEN).saturating_add(amount_in_after_fee);
        let zusd_out = numerator.checked_div(denominator).ok_or("div by zero")?;
        if zusd_out == 0 || zusd_out >= self.zusd_reserve { return Err("insufficient liquidity"); }

        self.update_oracle(height);
        self.zbx_reserve = self.zbx_reserve.saturating_add(zbx_in);
        self.zusd_reserve = self.zusd_reserve.saturating_sub(zusd_out);
        Ok(zusd_out)
    }

    /// Swap zUSD in → ZBX out. Returns ZBX output (after 0.3% fee).
    pub fn swap_zusd_for_zbx(&mut self, zusd_in: u128, height: u64) -> Result<u128, &'static str> {
        if !self.is_initialized() { return Err("pool not initialized"); }
        if zusd_in == 0 { return Err("zero input"); }
        if zusd_in > crate::tokenomics::MAX_SWAP_ZUSD {
            return Err("amount exceeds max swap limit (100,000 zUSD per tx)");
        }
        // Also cap output to MAX_SWAP_ZBX (whale buy protection).
        let amount_in_after_fee = zusd_in.saturating_mul(POOL_FEE_DEN - POOL_FEE_NUM);
        let numerator = amount_in_after_fee.saturating_mul(self.zbx_reserve);
        let denominator = self.zusd_reserve.saturating_mul(POOL_FEE_DEN).saturating_add(amount_in_after_fee);
        let zbx_out = numerator.checked_div(denominator).ok_or("div by zero")?;
        if zbx_out == 0 || zbx_out >= self.zbx_reserve { return Err("insufficient liquidity"); }
        if zbx_out > crate::tokenomics::MAX_SWAP_ZBX_WEI {
            return Err("output exceeds max swap limit (100,000 ZBX per tx)");
        }

        self.update_oracle(height);
        self.zusd_reserve = self.zusd_reserve.saturating_add(zusd_in);
        self.zbx_reserve = self.zbx_reserve.saturating_sub(zbx_out);
        Ok(zbx_out)
    }

    /// Update price cumulative for TWAP. Called before any reserve change.
    fn update_oracle(&mut self, height: u64) {
        if height <= self.last_update_height { return; }
        let elapsed = (height - self.last_update_height) as u128;
        let price_now = self.spot_price_zusd_per_zbx();
        self.price_cumulative = self.price_cumulative.saturating_add(price_now.saturating_mul(elapsed));
        self.last_update_height = height;
    }

    /// Quote: how much zUSD would I get for `zbx_in`?
    pub fn quote_zbx_to_zusd(&self, zbx_in: u128) -> u128 {
        if !self.is_initialized() || zbx_in == 0 { return 0; }
        let amount_in_after_fee = zbx_in.saturating_mul(POOL_FEE_DEN - POOL_FEE_NUM);
        let numerator = amount_in_after_fee.saturating_mul(self.zusd_reserve);
        let denominator = self.zbx_reserve.saturating_mul(POOL_FEE_DEN).saturating_add(amount_in_after_fee);
        numerator.checked_div(denominator).unwrap_or(0)
    }
}

/// Compute the dynamic gas price (wei/gas) targeting `target_usd_micro` per 21k-gas tx.
/// Returns gas_price_wei. Floored at `floor_gwei`.
///
/// price_zusd_per_zbx_q18 = how many zUSD (18-dec) per 1 ZBX wei × 10^18
/// To get price ZBX/USD: 1 USD = 10^18 / price_zusd_per_zbx_q18 ZBX wei
///
/// target_fee_wei = target_zusd_micro * 10^12 / price_zusd_per_zbx_q18 (units: ZBX wei)
/// gas_price_wei = target_fee_wei / gas_units
pub fn dynamic_gas_price_wei(
    pool: &Pool,
    target_usd_micro: u128, // e.g. 1000 = $0.001
    gas_units: u64,
    floor_gwei: u128,
    cap_gwei: u128,
) -> u128 {
    let floor = floor_gwei.saturating_mul(1_000_000_000);
    let cap = cap_gwei.saturating_mul(1_000_000_000);
    if !pool.is_initialized() {
        return floor;
    }
    let price_q18 = pool.spot_price_zusd_per_zbx();
    if price_q18 == 0 { return floor; }
    // 1 zUSD micro-unit = 10^12 zUSD wei (since 10^18 / 10^6).
    // target_fee_wei = (target_usd_micro * 10^12 * 10^18) / (price_q18 * gas_units)
    // Reorder to avoid overflow: compute in two steps.
    let target_fee_zbx_wei = target_usd_micro
        .saturating_mul(1_000_000_000_000) // → zUSD wei
        .saturating_mul(1_000_000_000_000_000_000) // × 10^18 for q18 reciprocal
        .checked_div(price_q18)
        .unwrap_or(0);
    let gp = target_fee_zbx_wei.checked_div(gas_units as u128).unwrap_or(floor);
    gp.max(floor).min(cap)
}

/// Integer square root (Newton's method). Used for initial LP minting.
fn isqrt_u128(n: u128) -> u128 {
    if n < 2 { return n; }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x { x = y; y = (x + n / x) / 2; }
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_liquidity_works() {
        let mut p = Pool::default();
        let zbx = 1_000_000u128 * 1_000_000_000_000_000_000;  // 1M ZBX
        let zusd = 1_000_000u128 * 1_000_000_000_000_000_000; // 1M zUSD = $1M (so 1 ZBX = $1)
        let lp = p.init_liquidity(zbx, zusd, 100).unwrap();
        assert!(lp > 0);
        assert!(p.is_initialized());
        // 1 ZBX should equal 1 zUSD = $1
        let price = p.spot_price_zusd_per_zbx();
        assert_eq!(price, 1_000_000_000_000_000_000); // exactly $1 per ZBX (q18)
    }

    #[test]
    fn swap_zbx_to_zusd_costs_fee() {
        let mut p = Pool::default();
        let scale = 1_000_000_000_000_000_000u128;
        p.init_liquidity(1_000_000 * scale, 1_000_000 * scale, 100).unwrap();
        // Swap 1000 ZBX
        let out = p.swap_zbx_for_zusd(1000 * scale, 101).unwrap();
        // Without fee, would get ~999 zUSD (slight slippage). With 0.3% fee: ~996 zUSD.
        assert!(out < 999 * scale);
        assert!(out > 990 * scale);
    }

    #[test]
    fn whale_swap_rejected_above_limit() {
        let mut p = Pool::default();
        let scale = 1_000_000_000_000_000_000u128;
        // Big pool so liquidity isn't the bottleneck.
        p.init_liquidity(10_000_000 * scale, 10_000_000 * scale, 100).unwrap();
        // 100,001 ZBX should fail (over 1 lakh limit).
        let huge = 100_001 * scale;
        assert!(p.swap_zbx_for_zusd(huge, 101).is_err());
        // 100,000 ZBX exactly should succeed.
        let max_ok = 100_000 * scale;
        assert!(p.swap_zbx_for_zusd(max_ok, 101).is_ok());
    }

    #[test]
    fn dynamic_gas_decreases_with_higher_zbx_price() {
        let mut p1 = Pool::default();
        let mut p2 = Pool::default();
        let scale = 1_000_000_000_000_000_000u128;
        // Pool 1: 1 ZBX = $1
        p1.init_liquidity(1_000_000 * scale, 1_000_000 * scale, 100).unwrap();
        // Pool 2: 1 ZBX = $10 (10x reserves on USD side)
        p2.init_liquidity(1_000_000 * scale, 10_000_000 * scale, 100).unwrap();

        let g1 = dynamic_gas_price_wei(&p1, 1000, 21000, 1, 100_000); // target $0.001
        let g2 = dynamic_gas_price_wei(&p2, 1000, 21000, 1, 100_000);
        // g2 should be ~10x lower than g1
        assert!(g2 < g1);
        assert!(g1 / g2 >= 9 && g1 / g2 <= 11);
    }
}
