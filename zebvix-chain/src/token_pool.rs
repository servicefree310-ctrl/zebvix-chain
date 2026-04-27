//! Phase F — Per-token AMM pool (Uniswap V2 style constant-product `x·y = k`).
//!
//! Each user-created ZBX-20 token may have **one** pool paired against the
//! native ZBX. Anyone can be an LP. Pool math, fee bookkeeping, and slippage
//! enforcement live here; on-chain custody / balance moves live in `state.rs`.
//!
//! Design notes:
//!   * Quote asset = native ZBX (wei, 10^18). Base asset = the token (in its
//!     own decimal scale — opaque to the pool, just a u128).
//!   * Single pool per `token_id`. To trade two tokens, route through ZBX
//!     (TOKEN_A → ZBX → TOKEN_B). Mirrors Uniswap V2's WETH base.
//!   * Swap fee = 0.3% (30 bps), deducted from the input side and **kept in
//!     the reserve** — so LPs earn the fee directly through `k` growth (no
//!     external fee bucket like the native ZBX/zUSD loan-repayment scheme).
//!   * LP tokens use sqrt(zbx · token) at init (with `MIN_LIQUIDITY = 1000`
//!     permanently burned to anti-rug the share price). Subsequent adds mint
//!     proportional to the lower of the two reserves' deposit ratios.
//!
//! On-disk schema is bincode positional. Field order is **consensus-critical
//! and FROZEN** — append new fields only, never reorder or remove.

use serde::{Deserialize, Serialize};

/// Permanently burned LP supply at pool init — mirrors Uniswap V2's
/// 1000-wei lock that prevents a single LP from exiting and minting LP at a
/// trivially small price afterward.
pub const MIN_TOKEN_POOL_LIQUIDITY: u128 = 1_000;

/// Swap fee numerator / denominator (0.3% = 30/10_000). Fee is taken from
/// the input amount and stays in the reserve, so LPs accrue value via `k`
/// growth (no separate fee accumulator).
pub const TOKEN_POOL_FEE_BPS_NUM: u128 = 30;
pub const TOKEN_POOL_FEE_BPS_DEN: u128 = 10_000;

/// Direction of a [`TxKind::TokenPoolSwap`](crate::types::TxKind::TokenPoolSwap).
///
/// Variant order is **consensus-critical** (bincode encodes as u32 LE tag).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TokenSwapDirection {
    /// Sell ZBX, receive the token ("buy token with ZBX").
    ZbxToToken,
    /// Sell the token, receive ZBX ("sell token for ZBX").
    TokenToZbx,
}

impl TokenSwapDirection {
    pub fn label(&self) -> &'static str {
        match self {
            TokenSwapDirection::ZbxToToken => "zbx_to_token",
            TokenSwapDirection::TokenToZbx => "token_to_zbx",
        }
    }
}

/// Per-token AMM pool persisted record.
///
/// **Field order is consensus-critical**. Existing fields are FROZEN; new
/// fields may be appended. `bincode` is positional — reordering corrupts
/// every existing pool on restart.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TokenPool {
    /// 1-based id of the underlying token (`TokenInfo.id`).
    pub token_id: u64,
    /// ZBX reserve, in wei.
    pub zbx_reserve: u128,
    /// Token reserve, in the token's own smallest unit (matches its decimals).
    pub token_reserve: u128,
    /// Total LP shares outstanding, including the permanently-locked
    /// `MIN_TOKEN_POOL_LIQUIDITY`.
    pub lp_supply: u128,
    /// Block height at which this pool was first initialized.
    pub init_height: u64,
    /// Address that bootstrapped the pool (informational — no special powers).
    pub creator: crate::types::Address,
    /// Lifetime cumulative ZBX-side swap input volume (in wei). Excludes
    /// fees? No — includes fees (gross input). For analytics / charts.
    #[serde(default)]
    pub cum_zbx_in_volume: u128,
    /// Lifetime cumulative token-side swap input volume (in token base-units).
    #[serde(default)]
    pub cum_token_in_volume: u128,
    /// Lifetime number of swaps executed against this pool.
    #[serde(default)]
    pub swap_count: u64,
}

impl TokenPool {
    pub fn is_initialized(&self) -> bool {
        self.lp_supply > 0
    }

    /// Spot price: how many ZBX wei per 1 token base-unit (scaled by 10^18).
    /// Returns 0 when uninitialized or when the token reserve is empty.
    pub fn spot_price_zbx_per_token_q18(&self) -> u128 {
        if self.token_reserve == 0 {
            return 0;
        }
        use primitive_types::U256;
        let scale = U256::from(crate::pool::SCALE_18);
        let num = U256::from(self.zbx_reserve) * scale;
        let result = num / U256::from(self.token_reserve);
        if result.bits() > 128 { u128::MAX } else { result.as_u128() }
    }

    /// Bootstrap a new pool with single-sided ZBX + token amounts at any ratio
    /// the creator chooses. Returns LP shares minted (caller credits LP balance
    /// to the creator MINUS the permanently-locked `MIN_TOKEN_POOL_LIQUIDITY`).
    ///
    /// Mirrors Uniswap V2 `_mint` first-time path.
    pub fn init(
        &mut self,
        creator: crate::types::Address,
        token_id: u64,
        zbx_in: u128,
        token_in: u128,
        height: u64,
    ) -> Result<u128, &'static str> {
        if self.is_initialized() {
            return Err("token-pool: already initialized");
        }
        if zbx_in == 0 || token_in == 0 {
            return Err("token-pool: zero initial liquidity");
        }
        // sqrt(k) with U256 to avoid u128 overflow on huge initial deposits.
        let prod = primitive_types::U256::from(zbx_in) * primitive_types::U256::from(token_in);
        let lp_total = isqrt_u256(prod);
        if lp_total <= MIN_TOKEN_POOL_LIQUIDITY {
            return Err("token-pool: initial liquidity too small (sqrt(k) must exceed 1000)");
        }
        self.token_id = token_id;
        self.zbx_reserve = zbx_in;
        self.token_reserve = token_in;
        self.lp_supply = lp_total;
        self.init_height = height;
        self.creator = creator;
        self.cum_zbx_in_volume = 0;
        self.cum_token_in_volume = 0;
        self.swap_count = 0;
        // Caller receives `lp_total - MIN_TOKEN_POOL_LIQUIDITY`. The lock
        // shares stay in `lp_supply` but are owned by no address — they can
        // never be redeemed.
        Ok(lp_total.saturating_sub(MIN_TOKEN_POOL_LIQUIDITY))
    }

    /// Add proportional liquidity. Caller specifies a desired ZBX deposit
    /// (`zbx_in_desired`) and a maximum token allowance (`token_in_max`).
    /// Returns `(zbx_used, token_used, lp_minted)`.
    ///
    /// LP minted = min( zbx_in * lp_supply / zbx_reserve,
    ///                  token_in * lp_supply / token_reserve ).
    pub fn add_liquidity(
        &mut self,
        zbx_in_desired: u128,
        token_in_max: u128,
    ) -> Result<(u128, u128, u128), &'static str> {
        if !self.is_initialized() {
            return Err("token-pool: not initialized");
        }
        if zbx_in_desired == 0 || token_in_max == 0 {
            return Err("token-pool: zero liquidity input");
        }
        // Compute the optimal token deposit for this ZBX amount at the current ratio.
        // token_optimal = zbx_in_desired * token_reserve / zbx_reserve
        use primitive_types::U256;
        let token_optimal_u = U256::from(zbx_in_desired) * U256::from(self.token_reserve)
            / U256::from(self.zbx_reserve);
        if token_optimal_u.bits() > 128 {
            return Err("token-pool: deposit ratio overflow");
        }
        let token_optimal = token_optimal_u.as_u128();

        let (zbx_in, token_in) = if token_optimal <= token_in_max {
            (zbx_in_desired, token_optimal)
        } else {
            // Fall back: use full token_in_max and recompute the matching ZBX.
            // zbx_actual = token_in_max * zbx_reserve / token_reserve
            let zbx_actual_u = U256::from(token_in_max) * U256::from(self.zbx_reserve)
                / U256::from(self.token_reserve);
            if zbx_actual_u.bits() > 128 {
                return Err("token-pool: deposit ratio overflow");
            }
            let zbx_actual = zbx_actual_u.as_u128();
            if zbx_actual > zbx_in_desired {
                // Should not happen given the branch condition, but defensive.
                return Err("token-pool: ratio recompute exceeds requested ZBX");
            }
            (zbx_actual, token_in_max)
        };

        if zbx_in == 0 || token_in == 0 {
            return Err("token-pool: dust deposit (one side rounds to 0)");
        }

        // LP minted = min(zbx_share, token_share) where each share is
        // amount * lp_supply / reserve. Use U256 to avoid overflow.
        let lp_from_zbx_u = U256::from(zbx_in) * U256::from(self.lp_supply)
            / U256::from(self.zbx_reserve);
        let lp_from_token_u = U256::from(token_in) * U256::from(self.lp_supply)
            / U256::from(self.token_reserve);
        let lp_minted_u = lp_from_zbx_u.min(lp_from_token_u);
        if lp_minted_u.bits() > 128 {
            return Err("token-pool: LP mint overflow");
        }
        let lp_minted = lp_minted_u.as_u128();
        if lp_minted == 0 {
            return Err("token-pool: zero LP minted (deposit too small)");
        }

        self.zbx_reserve = self.zbx_reserve.saturating_add(zbx_in);
        self.token_reserve = self.token_reserve.saturating_add(token_in);
        self.lp_supply = self.lp_supply.saturating_add(lp_minted);
        Ok((zbx_in, token_in, lp_minted))
    }

    /// Burn `lp_burn` shares and return `(zbx_out, token_out)` proportional
    /// to current reserves. Caller must already have ensured the burner owns
    /// at least `lp_burn` shares.
    ///
    /// Refuses to leave the pool with a total LP supply below
    /// `MIN_TOKEN_POOL_LIQUIDITY` (those shares are permanently locked).
    pub fn remove_liquidity(&mut self, lp_burn: u128) -> Result<(u128, u128), &'static str> {
        if !self.is_initialized() {
            return Err("token-pool: not initialized");
        }
        if lp_burn == 0 {
            return Err("token-pool: zero LP burn");
        }
        if lp_burn > self.lp_supply.saturating_sub(MIN_TOKEN_POOL_LIQUIDITY) {
            return Err("token-pool: cannot burn the locked initial liquidity");
        }
        // amount_out = reserve * lp_burn / lp_supply (use U256 for safety)
        use primitive_types::U256;
        let zbx_out_u = U256::from(self.zbx_reserve) * U256::from(lp_burn)
            / U256::from(self.lp_supply);
        let token_out_u = U256::from(self.token_reserve) * U256::from(lp_burn)
            / U256::from(self.lp_supply);
        if zbx_out_u.bits() > 128 || token_out_u.bits() > 128 {
            return Err("token-pool: withdraw overflow");
        }
        let zbx_out = zbx_out_u.as_u128();
        let token_out = token_out_u.as_u128();
        if zbx_out == 0 || token_out == 0 {
            return Err("token-pool: dust withdraw (one side rounds to 0)");
        }

        self.zbx_reserve = self.zbx_reserve.saturating_sub(zbx_out);
        self.token_reserve = self.token_reserve.saturating_sub(token_out);
        self.lp_supply = self.lp_supply.saturating_sub(lp_burn);
        Ok((zbx_out, token_out))
    }

    /// Swap ZBX in → token out. Fee deducted from input stays in reserves.
    pub fn swap_zbx_for_token(&mut self, zbx_in: u128) -> Result<u128, &'static str> {
        if !self.is_initialized() {
            return Err("token-pool: not initialized");
        }
        if zbx_in == 0 {
            return Err("token-pool: zero input");
        }
        let token_out = self.quote_zbx_for_token(zbx_in);
        if token_out == 0 {
            return Err("token-pool: insufficient liquidity for this input");
        }
        if token_out >= self.token_reserve {
            return Err("token-pool: output would drain reserve");
        }
        // Reserves grow by the FULL input (fee included) — this is what makes
        // LPs earn the fee implicitly.
        self.zbx_reserve = self.zbx_reserve.saturating_add(zbx_in);
        self.token_reserve = self.token_reserve.saturating_sub(token_out);
        self.cum_zbx_in_volume = self.cum_zbx_in_volume.saturating_add(zbx_in);
        self.swap_count = self.swap_count.saturating_add(1);
        Ok(token_out)
    }

    /// Swap token in → ZBX out. Fee deducted from input stays in reserves.
    pub fn swap_token_for_zbx(&mut self, token_in: u128) -> Result<u128, &'static str> {
        if !self.is_initialized() {
            return Err("token-pool: not initialized");
        }
        if token_in == 0 {
            return Err("token-pool: zero input");
        }
        let zbx_out = self.quote_token_for_zbx(token_in);
        if zbx_out == 0 {
            return Err("token-pool: insufficient liquidity for this input");
        }
        if zbx_out >= self.zbx_reserve {
            return Err("token-pool: output would drain reserve");
        }
        self.token_reserve = self.token_reserve.saturating_add(token_in);
        self.zbx_reserve = self.zbx_reserve.saturating_sub(zbx_out);
        self.cum_token_in_volume = self.cum_token_in_volume.saturating_add(token_in);
        self.swap_count = self.swap_count.saturating_add(1);
        Ok(zbx_out)
    }

    /// Quote: how many tokens you'd receive for `zbx_in`. Pure function.
    pub fn quote_zbx_for_token(&self, zbx_in: u128) -> u128 {
        if !self.is_initialized() || zbx_in == 0 {
            return 0;
        }
        let fee = zbx_in.saturating_mul(TOKEN_POOL_FEE_BPS_NUM) / TOKEN_POOL_FEE_BPS_DEN;
        let amount_in_eff = zbx_in.saturating_sub(fee);
        // out = token_reserve * amount_in_eff / (zbx_reserve + amount_in_eff)
        // Use U256 to avoid intermediate overflow.
        use primitive_types::U256;
        let num = U256::from(self.token_reserve) * U256::from(amount_in_eff);
        let den = U256::from(self.zbx_reserve) + U256::from(amount_in_eff);
        if den.is_zero() {
            return 0;
        }
        let out = num / den;
        if out.bits() > 128 { 0 } else { out.as_u128() }
    }

    /// Quote: how much ZBX you'd receive for `token_in`. Pure function.
    pub fn quote_token_for_zbx(&self, token_in: u128) -> u128 {
        if !self.is_initialized() || token_in == 0 {
            return 0;
        }
        let fee = token_in.saturating_mul(TOKEN_POOL_FEE_BPS_NUM) / TOKEN_POOL_FEE_BPS_DEN;
        let amount_in_eff = token_in.saturating_sub(fee);
        use primitive_types::U256;
        let num = U256::from(self.zbx_reserve) * U256::from(amount_in_eff);
        let den = U256::from(self.token_reserve) + U256::from(amount_in_eff);
        if den.is_zero() {
            return 0;
        }
        let out = num / den;
        if out.bits() > 128 { 0 } else { out.as_u128() }
    }

    /// Quote (preview-only) for the user-facing swap. Returns the same value
    /// as the matching quote_* function based on `direction`.
    pub fn quote(&self, direction: TokenSwapDirection, amount_in: u128) -> u128 {
        match direction {
            TokenSwapDirection::ZbxToToken => self.quote_zbx_for_token(amount_in),
            TokenSwapDirection::TokenToZbx => self.quote_token_for_zbx(amount_in),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase H — Deterministic pool address derivation
// ─────────────────────────────────────────────────────────────────────────
//
// Every per-token AMM pool gets a deterministic 20-byte address derived
// purely from its `token_id`. The derivation is:
//
//     pool_address = keccak256(POOL_ADDR_DOMAIN_TAG || token_id_be)[12..]
//
// The domain tag (`b"zbx-pool-v1"`) prevents any chance of collision with
// a real ECDSA-derived externally-owned account: an EOA address comes from
// `keccak256(uncompressed_pubkey_64bytes)[12..]`, so the preimage lengths
// are completely different (19 vs 64 bytes) and the leading bytes also
// differ structurally. Cryptographic collision probability is ~2^-160.
//
// Why a domain tag with a version suffix (`-v1`) rather than just a static
// prefix? So that future protocol upgrades (e.g. multi-asset pools, V3
// concentrated liquidity) can derive non-overlapping address spaces by
// bumping the version, without the risk of accidentally re-using an
// existing pool's address.
//
// **This function is consensus-critical.** Changing the bytes, the
// hash function, or the byte ordering would silently re-route every
// existing pool's custody to a different address on the next block.

pub const POOL_ADDR_DOMAIN_TAG: &[u8] = b"zbx-pool-v1";

/// Deterministic 20-byte address for the AMM pool of `token_id`.
/// Pure function — same inputs always produce the same output. Safe to
/// call from RPC handlers, indexers, and the dashboard's frontend code.
pub fn pool_address(token_id: u64) -> crate::types::Address {
    let mut buf = Vec::with_capacity(POOL_ADDR_DOMAIN_TAG.len() + 8);
    buf.extend_from_slice(POOL_ADDR_DOMAIN_TAG);
    buf.extend_from_slice(&token_id.to_be_bytes());
    let h = crate::crypto::keccak256(&buf);
    let mut out = [0u8; crate::types::ADDRESS_LEN];
    out.copy_from_slice(&h.0[12..]);
    crate::types::Address(out)
}

/// Integer square root for U256 — needed by `init` to size the LP supply.
fn isqrt_u256(n: primitive_types::U256) -> u128 {
    use primitive_types::U256;
    if n < U256::from(2u8) {
        return n.as_u128();
    }
    let bits = 256 - n.leading_zeros();
    let shift = (bits + 1) / 2;
    let mut x: U256 = U256::one() << shift as usize;
    loop {
        let next = (x + n / x) >> 1;
        if next >= x {
            return x.as_u128();
        }
        x = next;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Address;

    fn addr(b: u8) -> Address {
        let mut a = [0u8; 20];
        a[19] = b;
        Address(a)
    }

    fn z(n: u128) -> u128 {
        n * 1_000_000_000_000_000_000u128
    }

    #[test]
    fn init_locks_min_liquidity() {
        let mut p = TokenPool::default();
        // sqrt(100 * 100) = 100; minus 1000 lock would underflow → too small.
        assert!(p.init(addr(1), 1, 100, 100, 0).is_err());
        // sqrt(2000^2) = 2000 → creator gets 1000, lock keeps 1000.
        let lp = p.init(addr(1), 1, 2000, 2000, 0).unwrap();
        assert_eq!(lp, 1000);
        assert_eq!(p.lp_supply, 2000);
        assert!(p.is_initialized());
    }

    #[test]
    fn add_liquidity_proportional() {
        let mut p = TokenPool::default();
        p.init(addr(1), 1, z(1000), z(2000), 0).unwrap();
        // Add z(100) ZBX → token_optimal = 100 * 2000 / 1000 = 200 tokens.
        let (zbx_used, token_used, lp_minted) = p.add_liquidity(z(100), z(500)).unwrap();
        assert_eq!(zbx_used, z(100));
        assert_eq!(token_used, z(200));
        assert!(lp_minted > 0);
        // Reserves grew by exactly the deposit.
        assert_eq!(p.zbx_reserve, z(1100));
        assert_eq!(p.token_reserve, z(2200));
    }

    #[test]
    fn remove_liquidity_returns_proportional() {
        let mut p = TokenPool::default();
        let creator_lp = p.init(addr(1), 1, z(1000), z(2000), 0).unwrap();
        // Burn half of the creator's LP.
        let burn = creator_lp / 2;
        let (zbx_out, token_out) = p.remove_liquidity(burn).unwrap();
        // Creator owned (lp_total - 1000) shares ≈ 1414 - 1000 = 414 shares.
        // Burning half (~207) should return proportional ZBX/token.
        assert!(zbx_out > 0 && token_out > 0);
        // Token out should be ~2x ZBX out at the 1:2 ratio.
        let ratio = token_out / zbx_out.max(1);
        assert!((1..=3).contains(&ratio));
    }

    #[test]
    fn cannot_burn_locked_liquidity() {
        let mut p = TokenPool::default();
        p.init(addr(1), 1, z(1000), z(2000), 0).unwrap();
        // Try to burn ALL shares including the locked 1000.
        assert!(p.remove_liquidity(p.lp_supply).is_err());
    }

    #[test]
    fn swap_zbx_for_token_collects_fee_in_reserve() {
        // NOTE (test-fixture fix, April 2026): the previous version used
        // `z(1_000_000)` reserves which produces `k = 1e24 * 1e24 = 1e48`
        // — well above `u128::MAX ≈ 3.4e38`. `saturating_mul` then pinned
        // both `k_before` and `k_after` to `u128::MAX`, making the
        // `k_after > k_before` assertion always false (MAX > MAX is
        // false). The production semantics — fee stays in reserve, k
        // grows — are unchanged; we just need a test pool small enough
        // for the `k = z * t` invariant to fit in u128. Using `z(100)`
        // each side gives `k ≈ (100·1e18)² = 1e40` … still overflows.
        // Drop scale further: `1_000` units each side → k ≈ (1e21)² =
        // 1e42 (overflows). Use raw u128 amounts (no z() macro) so we
        // pick magnitudes that fit. With reserves of `1_000_000_000`
        // each, k ≈ 1e18 (well under u128::MAX), and a 1_000-unit input
        // exercises the same code path with measurable fee growth.
        let mut p = TokenPool::default();
        p.init(addr(1), 1, 1_000_000_000u128, 1_000_000_000u128, 0).unwrap();
        let k_before = p.zbx_reserve.saturating_mul(p.token_reserve);
        let token_out = p.swap_zbx_for_token(1_000u128).unwrap();
        assert!(token_out > 0);
        // k must grow (fee stays in reserve).
        let k_after = p.zbx_reserve.saturating_mul(p.token_reserve);
        assert!(k_after > k_before, "fee should grow k (got before={k_before}, after={k_after})");
        assert_eq!(p.swap_count, 1);
        assert_eq!(p.cum_zbx_in_volume, 1_000u128);
    }

    #[test]
    fn swap_token_for_zbx_round_trip_loses_fee() {
        let mut p = TokenPool::default();
        p.init(addr(1), 1, z(1_000_000), z(1_000_000), 0).unwrap();
        let token_out = p.swap_zbx_for_token(z(1_000)).unwrap();
        let zbx_back = p.swap_token_for_zbx(token_out).unwrap();
        // Round trip must lose ~0.6% (two 0.3% fees).
        assert!(zbx_back < z(1_000));
        assert!(zbx_back > z(1_000) * 99 / 100); // > 99% retained
    }

    #[test]
    fn quote_matches_swap_output() {
        let mut p = TokenPool::default();
        p.init(addr(1), 1, z(1_000_000), z(2_000_000), 0).unwrap();
        let q = p.quote_zbx_for_token(z(500));
        let actual = p.swap_zbx_for_token(z(500)).unwrap();
        assert_eq!(q, actual);
    }

    #[test]
    fn quote_for_uninitialized_pool_is_zero() {
        let p = TokenPool::default();
        assert_eq!(p.quote_zbx_for_token(z(100)), 0);
        assert_eq!(p.quote_token_for_zbx(z(100)), 0);
    }

    #[test]
    fn spot_price_reflects_ratio() {
        let mut p = TokenPool::default();
        p.init(addr(1), 1, z(1_000_000), z(2_000_000), 0).unwrap();
        // 1M ZBX vs 2M token → price = 0.5 ZBX per token (Q18).
        let price = p.spot_price_zbx_per_token_q18();
        let half = 500_000_000_000_000_000u128;
        let diff = if price > half { price - half } else { half - price };
        assert!(diff < 1_000_000_000u128, "price ~ 0.5 ZBX/token, got {}", price);
    }
}
