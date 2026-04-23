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

/// Default founder pre-mine = 0 ZBX. Admin/founder earns ZBX **only** through
/// block rewards (proposer reward + tx fees) and the post-loan 50% swap-fee
/// share. No genesis allocation to the founder.
pub const FOUNDER_PREMINE_ZBX: u128 = 0u128;
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

// ───────── Dynamic gas pricing (Phase 1: read-only oracle) ─────────

/// Target USD value per standard transfer, in micro-USD ($0.001 = 1000).
/// User-friendly fee — auto-scales as ZBX price moves.
pub const TARGET_FEE_USD_MICRO: u128 = 1_000;

/// Floor gas price = 1 gwei (spam protection — fee never below 21k × 1 gwei).
pub const DYNAMIC_GAS_FLOOR_GWEI: u128 = 1;

/// Cap gas price = 10,000 gwei = 0.21 ZBX max fee per tx (price-crash safety).
pub const DYNAMIC_GAS_CAP_GWEI: u128 = 10_000;

// ───────── Pool / admin addresses ─────────

/// Admin / founder address. Also receives 50% of swap fees after the
/// genesis liquidity loan (10M zUSD) is repaid.
pub const ADMIN_ADDRESS_HEX: &str = "0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc";

/// Founder's Ed25519 public key (32 bytes, hex). This is the pubkey whose
/// last-20-byte address equals `ADMIN_ADDRESS_HEX`. Used by `cmd_init` to seed
/// the genesis validator set deterministically — every node, regardless of its
/// local `--validator-key`, starts with exactly this one validator at genesis.
/// Post-genesis additions go through `validator-add` txs (B.3.1).
pub const FOUNDER_PUBKEY_HEX: &str =
    "0xaa9f6c1f047126b58bdfe62d7adc2ad04ec36d83b9391d313022fbd50cb5d097";

/// Maximum number of times the admin/founder address may be rotated.
/// After 3 changes, the admin address is permanently locked. Each change must
/// be signed by the current admin's key.
pub const MAX_ADMIN_CHANGES: u8 = 3;

/// **Governor address** (Phase B.3.2) — the *only* role authorized to mutate
/// the validator set: `ValidatorAdd`, `ValidatorEdit`, `ValidatorRemove`.
/// Separate from `ADMIN_ADDRESS_HEX` so a compromise of the economic/admin
/// key cannot rewrite the consensus committee.
///
/// Default = admin address (backward-compatible bootstrap). The genesis
/// governor can be rotated via `TxKind::GovernorChange`, signed by the
/// *current* governor; rotations are capped at `MAX_GOVERNOR_CHANGES`.
pub const GOVERNOR_ADDRESS_HEX: &str = ADMIN_ADDRESS_HEX;

/// Maximum number of governor rotations (parallel to admin rotation cap).
pub const MAX_GOVERNOR_CHANGES: u8 = 3;

// ───────── Reward locking + gas fee redistribution (Phase B.5) ─────────

/// Burn sink address. ZBX sent here is provably destroyed (no key controls it).
/// Bytes spell "burn" (62 75 72 6e) followed by zero bytes ending in 0xdead.
pub const BURN_ADDRESS_HEX: &str = "0x6275726e0000000000000000000000000000dead";

/// Dedicated treasury sub-account where the founder/admin's reward share lands.
/// Defaults to ADMIN_ADDRESS so existing CLI/UX continues to work; can be
/// rotated independently via future governance.
pub const TREASURY_ADDRESS_HEX: &str = ADMIN_ADDRESS_HEX;

/// Bootstrap thresholds. While **either** condition is unmet, the network is
/// in Phase A (high treasury cut, slower locked release pressure).
pub const BOOTSTRAP_VAL_THRESHOLD: usize = 500;
pub const BOOTSTRAP_DEL_THRESHOLD: usize = 1000;

/// Treasury cut of every epoch staking reward.
///   Phase A: 50.00% → treasury (LIQUID, founder development)
///   Phase B: 10.00% → treasury (LIQUID, hamesha)
pub const TREASURY_CUT_BPS_PHASE_A: u64 = 5_000;
pub const TREASURY_CUT_BPS_PHASE_B: u64 = 1_000;

/// Locked-reward unlock parameters.
///   Daily drip       = 0.50% of staked amount per day (per-address)
///   Bulk release     = 25.00% of remaining locked balance every 5,000,000 blocks
pub const DRIP_BPS_PER_DAY: u64 = 50;
pub const BULK_INTERVAL_BLOCKS: u64 = 5_000_000;
pub const BULK_RELEASE_BPS: u64 = 2_500;

/// ── Block-mint pool & periodic distribution ──
/// Per-block 3 ZBX mint flows into a holding address (REWARDS_POOL) instead of
/// going to the proposer. Every `REWARDS_DISTRIBUTION_INTERVAL` blocks, the
/// entire pool balance is drained and split:
///   * `REWARDS_COMMISSION_BPS` → operator of each validator (LIQUID, instant)
///   * remainder                → stake-proportional, into stakers' LOCKED bucket
/// Locked balances unlock via daily 0.5%-of-stake drip + 5M-block 25% bulk.
/// Bytes spell "rwds" + 16 zero bytes.
pub const REWARDS_POOL_ADDRESS_HEX: &str = "0x7277647300000000000000000000000000000000";
pub const REWARDS_DISTRIBUTION_INTERVAL: u64 = 100;
pub const REWARDS_COMMISSION_BPS: u64 = 500;

/// Day length in blocks at 5s block time (86,400 / 5).
pub const BLOCKS_PER_DAY: u64 = 17_280;

/// Burn cap = 50% of TOTAL_SUPPLY = 75M ZBX. Once cumulative gas-fee burn
/// reaches this, the 10% gas-fee burn slice is rerouted to AMM liquidity.
pub const BURN_CAP_WEI: u128 = 75_000_000u128 * WEI_PER_ZBX;

/// Gas fee redistribution (per transaction, in basis points of `tx.fee`).
///   50% → block proposer (validator)
///   20% → its delegators (stake-proportional)
///   20% → admin treasury (liquid)
///   10% → burn (or AMM liquidity once BURN_CAP_WEI reached)
/// Sum MUST equal 10_000.
pub const GAS_FEE_VALIDATOR_BPS: u64 = 5_000;
pub const GAS_FEE_DELEGATORS_BPS: u64 = 2_000;
pub const GAS_FEE_TREASURY_BPS: u64 = 2_000;
pub const GAS_FEE_BURN_BPS: u64 = 1_000;

/// zSwap pool's magic address — no private key exists for it.
/// Bytes spell "zswap" (7a 73 77 61 70) followed by 15 zero bytes.
/// Any normal user sending ZBX (or zUSD) to this address triggers an
/// **auto-swap** — they receive the opposite token back at the current pool
/// rate. The admin address is exempt: admin transfers add to the corresponding
/// reserve as single-sided liquidity (no swap, no LP mint).
pub const POOL_ADDRESS_HEX: &str = "0x7a73776170000000000000000000000000000000";

// ───────── Genesis pool seed (minted at first pool init) ─────────

/// 10M ZBX minted directly INTO the pool's ZBX reserve at pool genesis.
/// Admin does NOT receive these tokens — they are pool-owned permanent liquidity.
pub const GENESIS_POOL_ZBX_WEI: u128 = 10_000_000u128 * WEI_PER_ZBX;

/// 10M zUSD minted into the pool's zUSD reserve as a "liquidity loan".
/// The loan balance decreases as swap fees accumulate; once fully repaid,
/// future fees split 50/50 between admin payout and pool liquidity.
pub const GENESIS_POOL_ZUSD_LOAN: u128 = 10_000_000u128 * WEI_PER_ZBX;

/// Pool fee in basis-points-of-input (0.30%).
pub const POOL_FEE_BPS_NUM: u128 = 3;
pub const POOL_FEE_BPS_DEN: u128 = 1000;

// ───────── Anti-whale swap limits (per single transaction) ─────────

/// Maximum ZBX per single swap = 100,000 ZBX (1 lakh).
/// Protects pool from whale dumps & flash-loan-style price manipulation.
/// Bigger trades must split into multiple txs.
pub const MAX_SWAP_ZBX_WEI: u128 = 100_000u128 * WEI_PER_ZBX;

/// Maximum zUSD per single swap = 100,000 zUSD ($100k).
/// Same scale as ZBX (18 decimals).
pub const MAX_SWAP_ZUSD: u128 = 100_000u128 * WEI_PER_ZBX;

/// Minimum swap output: 0.01 zUSD (or its ZBX-equivalent for reverse swaps).
/// Trades that would receive less than this are rejected — protects the pool
/// from dust-spam and ensures every swap is economically meaningful.
pub const MIN_SWAP_OUT_ZUSD: u128 = 10_000_000_000_000_000u128; // 0.01 * 10^18
pub const MIN_SWAP_OUT_ZBX_WEI: u128 = 10_000_000_000_000_000u128; // 0.01 ZBX

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
