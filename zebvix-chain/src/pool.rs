//! On-chain AMM pool — Uniswap V2 style constant-product (x·y = k) with
//! **explicit fee bucket** for transparent loan repayment + admin payout.
//!
//! Single ZBX/zUSD pool. **Permissionless** — no admin can withdraw the genesis
//! liquidity. Anyone can swap; the only way to interact is by sending tokens
//! to `POOL_ADDRESS`. The block executor intercepts that transfer and runs
//! the swap automatically (auto-router).
//!
//! Fee model (Phase 2):
//!   - Each swap takes 0.3% from the input token, sequestered in a
//!     `fee_acc_<token>` bucket (NOT added to reserves).
//!   - `settle_fees()` is called after every swap:
//!       * If `loan_outstanding_zusd > 0`: fees go entirely to repaying the
//!         10M zUSD genesis liquidity loan. Tokens move into reserves.
//!       * Once loan = 0: future fees split 50/50 between
//!         the admin address (real income) and the pool reserves
//!         (compounding LP value).

use serde::{Deserialize, Serialize};

use crate::tokenomics::{POOL_FEE_BPS_DEN, POOL_FEE_BPS_NUM};

/// Minimum LP tokens locked permanently to prevent share-price manipulation.
pub const MIN_LIQUIDITY: u128 = 1_000;

/// 1 zUSD = 10^18 micro-units (same scale as ZBX wei). 1 zUSD = $1 by definition.
pub const ZUSD_PER_DOLLAR: u128 = 1_000_000_000_000_000_000u128;
pub const SCALE_18: u128 = 1_000_000_000_000_000_000u128;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Pool {
    /// Reserves of ZBX (in wei).
    pub zbx_reserve: u128,
    /// Reserves of zUSD (in 18-decimal units, $1 = 10^18).
    pub zusd_reserve: u128,
    /// Total LP tokens minted (locked to POOL_ADDRESS — nobody can withdraw).
    pub lp_supply: u128,
    /// Block height of last TWAP cumulative update.
    pub last_update_height: u64,
    /// Cumulative price (zusd_per_zbx, 18-dec) × blocks_elapsed. Used for TWAP.
    pub price_cumulative: u128,
    /// Block height when pool was first initialized (genesis-like marker).
    pub init_height: u64,

    // ─────── Fee accounting (Phase 2) ───────
    /// Outstanding genesis liquidity loan (in zUSD value). Starts at 10M.
    /// Decreases as swap fees accumulate. Once 0, the loan is repaid and
    /// the 50/50 admin/liquidity split kicks in.
    #[serde(default)]
    pub loan_outstanding_zusd: u128,
    /// ZBX fees collected from swaps awaiting settlement.
    #[serde(default)]
    pub fee_acc_zbx: u128,
    /// zUSD fees collected from swaps awaiting settlement.
    #[serde(default)]
    pub fee_acc_zusd: u128,
    /// Lifetime: total fees ever collected, valued in zUSD at swap time.
    #[serde(default)]
    pub total_fees_collected_zusd: u128,
    /// Lifetime: total zUSD-equivalent value paid out to admin (post-loan).
    #[serde(default)]
    pub total_admin_paid_zusd: u128,
    /// Lifetime: total zUSD-equivalent value reinvested into reserves.
    #[serde(default)]
    pub total_reinvested_zusd: u128,
}

impl Pool {
    pub fn is_initialized(&self) -> bool {
        self.lp_supply > 0
    }

    pub fn loan_repaid(&self) -> bool {
        self.loan_outstanding_zusd == 0 && self.is_initialized()
    }

    /// Spot price: how many zUSD wei per 1 ZBX wei (scaled by 10^18).
    pub fn spot_price_zusd_per_zbx(&self) -> u128 {
        if self.zbx_reserve == 0 {
            return 0;
        }
        self.zusd_reserve
            .saturating_mul(SCALE_18)
            .checked_div(self.zbx_reserve)
            .unwrap_or(0)
    }

    /// Convert a ZBX wei amount into its zUSD-value at current spot price.
    fn zbx_value_in_zusd(&self, zbx: u128) -> u128 {
        let p = self.spot_price_zusd_per_zbx();
        zbx.saturating_mul(p) / SCALE_18
    }

    /// Genesis pool initialization. Mints `zbx` + `zusd` directly INTO reserves
    /// (no debit from any account — these tokens are minted by the chain).
    /// Returns LP tokens minted (which the caller should lock to POOL_ADDRESS).
    /// Sets `loan_outstanding_zusd = zusd` (the loan amount).
    pub fn init_genesis(&mut self, zbx: u128, zusd: u128, height: u64) -> Result<u128, &'static str> {
        if self.is_initialized() {
            return Err("pool already initialized");
        }
        if zbx == 0 || zusd == 0 {
            return Err("zero liquidity");
        }
        let k = isqrt_u128(zbx.saturating_mul(zusd));
        if k <= MIN_LIQUIDITY {
            return Err("initial liquidity too small");
        }
        self.zbx_reserve = zbx;
        self.zusd_reserve = zusd;
        self.lp_supply = k;
        self.init_height = height;
        self.last_update_height = height;
        self.price_cumulative = 0;
        self.loan_outstanding_zusd = zusd; // 10M zUSD loan to be repaid via fees
        Ok(k)
    }

    /// Add proportional liquidity. Returns (zbx_used, zusd_used, lp_minted).
    pub fn add_liquidity(&mut self, zbx_max: u128, zusd_max: u128, height: u64) -> Result<(u128, u128, u128), &'static str> {
        if !self.is_initialized() {
            return Err("pool not initialized");
        }
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

        if zbx_in == 0 || zusd_in == 0 { return Err("dust amount"); }

        let lp_from_zbx = zbx_in.saturating_mul(self.lp_supply) / self.zbx_reserve;
        let lp_from_zusd = zusd_in.saturating_mul(self.lp_supply) / self.zusd_reserve;
        let lp_minted = lp_from_zbx.min(lp_from_zusd);
        if lp_minted == 0 { return Err("zero LP minted"); }

        self.update_oracle(height);
        self.zbx_reserve = self.zbx_reserve.saturating_add(zbx_in);
        self.zusd_reserve = self.zusd_reserve.saturating_add(zusd_in);
        self.lp_supply = self.lp_supply.saturating_add(lp_minted);
        Ok((zbx_in, zusd_in, lp_minted))
    }

    /// Admin single-sided ZBX deposit (just adds to ZBX reserve, no LP mint).
    pub fn admin_add_zbx(&mut self, zbx_in: u128, height: u64) -> Result<(), &'static str> {
        if !self.is_initialized() { return Err("pool not initialized"); }
        if zbx_in == 0 { return Err("zero input"); }
        self.update_oracle(height);
        self.zbx_reserve = self.zbx_reserve.saturating_add(zbx_in);
        Ok(())
    }

    /// Admin single-sided zUSD deposit (just adds to zUSD reserve, no LP mint).
    pub fn admin_add_zusd(&mut self, zusd_in: u128, height: u64) -> Result<(), &'static str> {
        if !self.is_initialized() { return Err("pool not initialized"); }
        if zusd_in == 0 { return Err("zero input"); }
        self.update_oracle(height);
        self.zusd_reserve = self.zusd_reserve.saturating_add(zusd_in);
        Ok(())
    }

    /// Swap ZBX in → zUSD out. 0.3% fee deducted from input goes into `fee_acc_zbx`.
    pub fn swap_zbx_for_zusd(&mut self, zbx_in: u128, height: u64) -> Result<u128, &'static str> {
        if !self.is_initialized() { return Err("pool not initialized"); }
        if zbx_in == 0 { return Err("zero input"); }
        if zbx_in > crate::tokenomics::MAX_SWAP_ZBX_WEI {
            return Err("amount exceeds max swap limit (100,000 ZBX per tx)");
        }
        let fee = zbx_in.saturating_mul(POOL_FEE_BPS_NUM) / POOL_FEE_BPS_DEN;
        let amount_in_eff = zbx_in.saturating_sub(fee);
        // No-fee CPMM on the effective input.
        let numerator = amount_in_eff.saturating_mul(self.zusd_reserve);
        let denominator = self.zbx_reserve.saturating_add(amount_in_eff);
        let zusd_out = numerator.checked_div(denominator).ok_or("div by zero")?;
        if zusd_out == 0 || zusd_out >= self.zusd_reserve { return Err("insufficient liquidity"); }

        self.update_oracle(height);
        self.zbx_reserve = self.zbx_reserve.saturating_add(amount_in_eff);
        self.zusd_reserve = self.zusd_reserve.saturating_sub(zusd_out);
        self.fee_acc_zbx = self.fee_acc_zbx.saturating_add(fee);
        Ok(zusd_out)
    }

    /// Swap zUSD in → ZBX out. 0.3% fee deducted from input goes into `fee_acc_zusd`.
    pub fn swap_zusd_for_zbx(&mut self, zusd_in: u128, height: u64) -> Result<u128, &'static str> {
        if !self.is_initialized() { return Err("pool not initialized"); }
        if zusd_in == 0 { return Err("zero input"); }
        if zusd_in > crate::tokenomics::MAX_SWAP_ZUSD {
            return Err("amount exceeds max swap limit (100,000 zUSD per tx)");
        }
        let fee = zusd_in.saturating_mul(POOL_FEE_BPS_NUM) / POOL_FEE_BPS_DEN;
        let amount_in_eff = zusd_in.saturating_sub(fee);
        let numerator = amount_in_eff.saturating_mul(self.zbx_reserve);
        let denominator = self.zusd_reserve.saturating_add(amount_in_eff);
        let zbx_out = numerator.checked_div(denominator).ok_or("div by zero")?;
        if zbx_out == 0 || zbx_out >= self.zbx_reserve { return Err("insufficient liquidity"); }
        if zbx_out > crate::tokenomics::MAX_SWAP_ZBX_WEI {
            return Err("output exceeds max swap limit (100,000 ZBX per tx)");
        }

        self.update_oracle(height);
        self.zusd_reserve = self.zusd_reserve.saturating_add(amount_in_eff);
        self.zbx_reserve = self.zbx_reserve.saturating_sub(zbx_out);
        self.fee_acc_zusd = self.fee_acc_zusd.saturating_add(fee);
        Ok(zbx_out)
    }

    /// Settle accumulated fees. Returns `(admin_zbx_payout, admin_zusd_payout)`.
    /// Caller (State) credits these to the admin's account.
    ///
    /// Phase A — loan outstanding > 0:
    ///   100% of fees go to reserves; loan is reduced by the zUSD-value of fees.
    /// Phase B — loan repaid:
    ///   50% of each fee bucket → admin payout; 50% → reserves (compound LP).
    pub fn settle_fees(&mut self) -> (u128, u128) {
        if self.fee_acc_zbx == 0 && self.fee_acc_zusd == 0 {
            return (0, 0);
        }

        if self.loan_outstanding_zusd > 0 {
            let value_zbx = self.zbx_value_in_zusd(self.fee_acc_zbx);
            let value_total = value_zbx.saturating_add(self.fee_acc_zusd);

            if value_total <= self.loan_outstanding_zusd {
                // 100% to loan repayment; all fee tokens → reserves.
                self.zbx_reserve = self.zbx_reserve.saturating_add(self.fee_acc_zbx);
                self.zusd_reserve = self.zusd_reserve.saturating_add(self.fee_acc_zusd);
                self.loan_outstanding_zusd = self.loan_outstanding_zusd.saturating_sub(value_total);
                self.total_fees_collected_zusd = self.total_fees_collected_zusd.saturating_add(value_total);
                self.total_reinvested_zusd = self.total_reinvested_zusd.saturating_add(value_total);
                self.fee_acc_zbx = 0;
                self.fee_acc_zusd = 0;
                return (0, 0);
            } else {
                // Partial: take exactly `loan_outstanding` worth proportionally,
                // route to reserves, then split the remainder 50/50.
                let num = self.loan_outstanding_zusd;
                let den = value_total;
                let to_loan_zbx = self.fee_acc_zbx.saturating_mul(num) / den;
                let to_loan_zusd = self.fee_acc_zusd.saturating_mul(num) / den;
                self.zbx_reserve = self.zbx_reserve.saturating_add(to_loan_zbx);
                self.zusd_reserve = self.zusd_reserve.saturating_add(to_loan_zusd);
                self.fee_acc_zbx -= to_loan_zbx;
                self.fee_acc_zusd -= to_loan_zusd;
                self.total_fees_collected_zusd = self.total_fees_collected_zusd.saturating_add(self.loan_outstanding_zusd);
                self.total_reinvested_zusd = self.total_reinvested_zusd.saturating_add(self.loan_outstanding_zusd);
                self.loan_outstanding_zusd = 0;
                // fall through to 50/50 split with what remains
            }
        }

        // Loan repaid → 50% admin, 50% reserves
        let admin_zbx = self.fee_acc_zbx / 2;
        let admin_zusd = self.fee_acc_zusd / 2;
        let liq_zbx = self.fee_acc_zbx - admin_zbx;
        let liq_zusd = self.fee_acc_zusd - admin_zusd;

        self.zbx_reserve = self.zbx_reserve.saturating_add(liq_zbx);
        self.zusd_reserve = self.zusd_reserve.saturating_add(liq_zusd);

        let admin_value = self.zbx_value_in_zusd(admin_zbx).saturating_add(admin_zusd);
        let liq_value = self.zbx_value_in_zusd(liq_zbx).saturating_add(liq_zusd);
        self.total_admin_paid_zusd = self.total_admin_paid_zusd.saturating_add(admin_value);
        self.total_reinvested_zusd = self.total_reinvested_zusd.saturating_add(liq_value);
        self.total_fees_collected_zusd = self.total_fees_collected_zusd
            .saturating_add(admin_value)
            .saturating_add(liq_value);

        self.fee_acc_zbx = 0;
        self.fee_acc_zusd = 0;

        (admin_zbx, admin_zusd)
    }

    /// Update price cumulative for TWAP. Called before any reserve change.
    fn update_oracle(&mut self, height: u64) {
        if height <= self.last_update_height { return; }
        let elapsed = (height - self.last_update_height) as u128;
        let price_now = self.spot_price_zusd_per_zbx();
        self.price_cumulative = self.price_cumulative.saturating_add(price_now.saturating_mul(elapsed));
        self.last_update_height = height;
    }

    /// Quote: how much zUSD would I get for `zbx_in` (preview only, no state change).
    pub fn quote_zbx_to_zusd(&self, zbx_in: u128) -> u128 {
        if !self.is_initialized() || zbx_in == 0 { return 0; }
        let fee = zbx_in.saturating_mul(POOL_FEE_BPS_NUM) / POOL_FEE_BPS_DEN;
        let amount_in_eff = zbx_in.saturating_sub(fee);
        let numerator = amount_in_eff.saturating_mul(self.zusd_reserve);
        let denominator = self.zbx_reserve.saturating_add(amount_in_eff);
        numerator.checked_div(denominator).unwrap_or(0)
    }

    /// Quote: how much ZBX would I get for `zusd_in`?
    pub fn quote_zusd_to_zbx(&self, zusd_in: u128) -> u128 {
        if !self.is_initialized() || zusd_in == 0 { return 0; }
        let fee = zusd_in.saturating_mul(POOL_FEE_BPS_NUM) / POOL_FEE_BPS_DEN;
        let amount_in_eff = zusd_in.saturating_sub(fee);
        let numerator = amount_in_eff.saturating_mul(self.zbx_reserve);
        let denominator = self.zusd_reserve.saturating_add(amount_in_eff);
        numerator.checked_div(denominator).unwrap_or(0)
    }
}

/// Compute the dynamic gas price (wei/gas) targeting `target_usd_micro` per 21k-gas tx.
pub fn dynamic_gas_price_wei(
    pool: &Pool,
    target_usd_micro: u128,
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
    let target_fee_zbx_wei = target_usd_micro
        .saturating_mul(1_000_000_000_000)
        .saturating_mul(SCALE_18)
        .checked_div(price_q18)
        .unwrap_or(0);
    let gp = target_fee_zbx_wei.checked_div(gas_units as u128).unwrap_or(floor);
    gp.max(floor).min(cap)
}

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

    fn z(n: u128) -> u128 { n * SCALE_18 }

    #[test]
    fn genesis_init_sets_loan() {
        let mut p = Pool::default();
        let lp = p.init_genesis(z(10_000_000), z(10_000_000), 0).unwrap();
        assert!(lp > 0);
        assert!(p.is_initialized());
        assert_eq!(p.loan_outstanding_zusd, z(10_000_000));
        assert!(!p.loan_repaid());
        // 1 ZBX = $1 at genesis.
        assert_eq!(p.spot_price_zusd_per_zbx(), SCALE_18);
    }

    #[test]
    fn swap_collects_fee_into_bucket() {
        let mut p = Pool::default();
        p.init_genesis(z(1_000_000), z(1_000_000), 0).unwrap();
        let _ = p.swap_zbx_for_zusd(z(1000), 1).unwrap();
        // 0.3% of 1000 ZBX = 3 ZBX in the fee bucket
        assert_eq!(p.fee_acc_zbx, z(3));
        // Reserves grew by amount_in_eff = 997 ZBX (not full 1000)
        assert_eq!(p.zbx_reserve, z(1_000_000) + z(997));
    }

    #[test]
    fn settle_fees_repays_loan_first() {
        let mut p = Pool::default();
        // Tiny loan = 10 zUSD, easy to repay
        p.init_genesis(z(1_000_000), z(10), 0).unwrap();
        // huge price imbalance, but ok for test
        // Do a swap that yields ~0.003 zUSD fee value... actually let's just
        // manually push fees.
        p.fee_acc_zusd = z(15); // > 10 zUSD loan
        let (admin_zbx, admin_zusd) = p.settle_fees();
        // Loan was 10, fee_value = 15, so 10 → reserves, 5 → split 50/50
        assert_eq!(p.loan_outstanding_zusd, 0);
        assert!(p.loan_repaid());
        assert_eq!(admin_zbx, 0);
        assert_eq!(admin_zusd, z(5) / 2); // half of remaining 5
    }

    #[test]
    fn settle_fees_5050_after_loan() {
        let mut p = Pool::default();
        p.init_genesis(z(1_000_000), z(1_000_000), 0).unwrap();
        p.loan_outstanding_zusd = 0; // pretend loan repaid
        p.fee_acc_zbx = z(100);
        p.fee_acc_zusd = z(200);
        let (a_zbx, a_zusd) = p.settle_fees();
        assert_eq!(a_zbx, z(50));
        assert_eq!(a_zusd, z(100));
        // other half went to reserves
        assert_eq!(p.zbx_reserve, z(1_000_000) + z(50));
        assert_eq!(p.zusd_reserve, z(1_000_000) + z(100));
        assert_eq!(p.fee_acc_zbx, 0);
        assert_eq!(p.fee_acc_zusd, 0);
    }

    #[test]
    fn whale_swap_rejected() {
        let mut p = Pool::default();
        p.init_genesis(z(10_000_000), z(10_000_000), 0).unwrap();
        assert!(p.swap_zbx_for_zusd(z(100_001), 1).is_err());
        assert!(p.swap_zbx_for_zusd(z(100_000), 1).is_ok());
    }

    #[test]
    fn dynamic_gas_decreases_with_higher_zbx_price() {
        let mut p1 = Pool::default();
        let mut p2 = Pool::default();
        p1.init_genesis(z(1_000_000), z(1_000_000), 0).unwrap();
        p2.init_genesis(z(1_000_000), z(10_000_000), 0).unwrap();
        let g1 = dynamic_gas_price_wei(&p1, 1000, 21000, 1, 100_000);
        let g2 = dynamic_gas_price_wei(&p2, 1000, 21000, 1, 100_000);
        assert!(g2 < g1);
        assert!(g1 / g2 >= 9 && g1 / g2 <= 11);
    }
}
