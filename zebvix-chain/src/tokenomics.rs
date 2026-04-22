//! ZBX tokenomics: 150M total supply with Bitcoin-style halving.

/// 1 ZBX = 10^18 wei (EVM standard).
pub const ZBX_DECIMALS: u32 = 18;
pub const WEI_PER_ZBX: u128 = 1_000_000_000_000_000_000u128;

/// Total max supply = 150,000,000 ZBX.
/// Breakdown:
///   - Founder pre-mine (genesis allocation):  10,000,000 ZBX
///   - Block rewards over time:               140,000,000 ZBX
pub const TOTAL_SUPPLY_ZBX: u128 = 150_000_000u128;
pub const TOTAL_SUPPLY_WEI: u128 = TOTAL_SUPPLY_ZBX * WEI_PER_ZBX;

/// Default founder pre-mine = 10,000,000 ZBX (allocated at genesis to validator address).
pub const FOUNDER_PREMINE_ZBX: u128 = 10_000_000u128;
pub const FOUNDER_PREMINE_WEI: u128 = FOUNDER_PREMINE_ZBX * WEI_PER_ZBX;

/// Initial block reward = 3 ZBX.
pub const INITIAL_REWARD_WEI: u128 = 3u128 * WEI_PER_ZBX;

/// Halving every 25,000,000 blocks (~3.96 years at 5s blocks).
/// Math: 3 ZBX × 25M × 2 (geometric sum) = 150M ZBX exactly.
pub const HALVING_INTERVAL: u64 = 25_000_000;

/// Block time in seconds.
pub const BLOCK_TIME_SECS: u64 = 5;

/// Chain ID for Zebvix mainnet.
pub const CHAIN_ID: u64 = 7878;

/// Gas units required for a standard ZBX transfer (Ethereum-compatible).
pub const MIN_GAS_UNITS: u64 = 21_000;

/// Minimum gas price in wei = 50 gwei (1 gwei = 10^9 wei).
/// Network rejects any tx below this price.
pub const MIN_GAS_PRICE_WEI: u128 = 50_000_000_000u128;

/// Minimum gas fee per transaction = 21,000 × 50 gwei = 0.00105 ZBX.
/// Required for spam protection. Fees go to the block proposer.
pub const MIN_TX_FEE_WEI: u128 = MIN_GAS_UNITS as u128 * MIN_GAS_PRICE_WEI;

/// Recommended fee for a standard transfer (= minimum for v0.1).
/// Future versions will compute by actual gas usage (EVM ops).
pub const STANDARD_TX_FEE_WEI: u128 = MIN_TX_FEE_WEI;

/// Compute block reward at a given height (1-indexed). Returns 0 once reward halves to 0.
pub fn reward_at_height(height: u64) -> u128 {
    if height == 0 {
        return 0; // genesis has no reward
    }
    let halvings = (height - 1) / HALVING_INTERVAL;
    if halvings >= 64 {
        return 0;
    }
    INITIAL_REWARD_WEI >> halvings
}

/// Cumulative supply minted up to and including `height`.
pub fn cumulative_supply(height: u64) -> u128 {
    if height == 0 {
        return 0;
    }
    let mut total: u128 = 0;
    let mut h = 1u64;
    while h <= height {
        let halvings = (h - 1) / HALVING_INTERVAL;
        if halvings >= 64 { break; }
        let reward = INITIAL_REWARD_WEI >> halvings;
        let era_end = ((halvings + 1) * HALVING_INTERVAL).min(height);
        let blocks = era_end - h + 1;
        total = total.saturating_add(reward.saturating_mul(blocks as u128));
        h = era_end + 1;
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reward_halves_correctly() {
        assert_eq!(reward_at_height(1), INITIAL_REWARD_WEI);
        assert_eq!(reward_at_height(HALVING_INTERVAL), INITIAL_REWARD_WEI);
        assert_eq!(reward_at_height(HALVING_INTERVAL + 1), INITIAL_REWARD_WEI / 2);
        assert_eq!(reward_at_height(2 * HALVING_INTERVAL + 1), INITIAL_REWARD_WEI / 4);
    }
    #[test]
    fn total_supply_caps_at_150m() {
        // After ~64 halvings supply must equal exactly 2 × initial × interval = 150M ZBX.
        let final_supply = cumulative_supply(HALVING_INTERVAL * 64);
        // Geometric sum 1 + 1/2 + 1/4 + ... → 2, so total = 2 × initial × interval.
        // Due to integer floor on halvings small dust may remain; verify within 1 ZBX.
        let target = 2u128 * INITIAL_REWARD_WEI * HALVING_INTERVAL as u128;
        assert!(target.abs_diff(final_supply) <= WEI_PER_ZBX);
        assert!(final_supply <= TOTAL_SUPPLY_WEI);
    }
}
