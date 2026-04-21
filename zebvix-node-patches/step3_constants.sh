#!/usr/bin/env bash
# Step 3: Tokenomics constants + burn cap in gas_coin.rs

set -euo pipefail

GAS_COIN="crates/sui-types/src/gas_coin.rs"
[ -f "$GAS_COIN" ] || { echo "  SKIP: $GAS_COIN not found"; exit 0; }

echo "  [3.1] Injecting ZBX tokenomics constants into gas_coin.rs"

# Check if already patched
if grep -q "MAX_TOTAL_SUPPLY_ZBX" "$GAS_COIN"; then
    echo "  Already patched, skipping."
    exit 0
fi

# Find the end of existing pub const MIST_PER_ZBX line and insert after it
python3 << 'PYEOF'
with open("crates/sui-types/src/gas_coin.rs", "r") as f:
    content = f.read()

ZEBVIX_CONSTANTS = '''
// ================================================================
// ZEBVIX TOKENOMICS CONSTANTS
// ================================================================

/// ZBX base unit
pub const MIST_PER_ZBX: u64 = 1_000_000_000;

/// Maximum total supply: 150 million ZBX (hard cap — never exceeded)
pub const MAX_TOTAL_SUPPLY_ZBX: u64 = 150_000_000;
pub const MAX_TOTAL_SUPPLY_MIST: u64 = MAX_TOTAL_SUPPLY_ZBX * MIST_PER_ZBX;

/// Genesis supply: 2 million ZBX minted at chain start
pub const GENESIS_SUPPLY_ZBX: u64 = 2_000_000;
pub const GENESIS_SUPPLY_MIST: u64 = GENESIS_SUPPLY_ZBX * MIST_PER_ZBX;

/// Halving thresholds (by total minted ZBX)
pub const FIRST_HALVING_ZBX: u64  =  50_000_000;
pub const SECOND_HALVING_ZBX: u64 = 100_000_000;

/// Block rewards
pub const INITIAL_BLOCK_REWARD_MIST: u64 = 100_000_000; // 0.1 ZBX per block

/// Gas fee distribution (basis points, must sum to 10000)
pub const GAS_VALIDATOR_BPS: u64 = 7200; // 72% → active validators
pub const GAS_TREASURY_BPS:  u64 = 1800; // 18% → founder treasury
pub const GAS_BURN_BPS:      u64 = 1000; // 10% → burn (until cap)

/// Burn cap: 50% of max supply = 75 million ZBX
pub const MAX_BURN_SUPPLY_ZBX:  u64 = 75_000_000;
pub const MAX_BURN_SUPPLY_MIST: u64 = MAX_BURN_SUPPLY_ZBX * MIST_PER_ZBX;

/// Validator system
pub const MAX_VALIDATORS:             u64 = 41;
pub const MIN_VALIDATOR_STAKE_ZBX:    u64 = 10_000;
pub const MIN_VALIDATOR_STAKE_MIST:   u64 = MIN_VALIDATOR_STAKE_ZBX * MIST_PER_ZBX;
pub const MAX_VALIDATOR_STAKE_ZBX:    u64 = 250_000;  // validator's OWN stake cap
pub const MAX_VALIDATOR_STAKE_MIST:   u64 = MAX_VALIDATOR_STAKE_ZBX * MIST_PER_ZBX;
pub const GLOBAL_STAKE_CAP_ZBX:       u64 = 5_000_000; // ALL validators + ALL delegators combined
pub const GLOBAL_STAKE_CAP_MIST:      u64 = GLOBAL_STAKE_CAP_ZBX * MIST_PER_ZBX;
pub const VALIDATOR_STAKING_APR:      u64 = 120;       // % APR on self-stake
pub const DELEGATOR_APR:              u64 = 80;        // % APR for delegators
pub const VALIDATOR_DELEGATION_BONUS_APR: u64 = 40;   // % bonus on delegated amount
pub const NODE_DAILY_REWARD_MIST:     u64 = 5 * MIST_PER_ZBX; // 5 ZBX/day per node

/// Chain info
pub const CHAIN_ID: &str     = "zebvix-mainnet-1";
pub const TOKEN_SYMBOL: &str = "ZBX";
pub const TOKEN_DECIMALS: u8 = 9;

// ================================================================
// ZEBVIX HELPER FUNCTIONS
// ================================================================

/// Returns true if burning is still allowed (below burn cap)
pub fn is_burn_allowed(total_burned_mist: u64) -> bool {
    total_burned_mist < MAX_BURN_SUPPLY_MIST
}

/// Returns halving divisor based on total minted
/// Phase 1 (0–50M): divisor=1 → full reward
/// Phase 2 (50M–100M): divisor=2 → half reward
/// Phase 3 (100M+): divisor=4 → quarter reward
pub fn get_halving_multiplier(total_minted_zbx: u64) -> u64 {
    if total_minted_zbx < FIRST_HALVING_ZBX {
        1
    } else if total_minted_zbx < SECOND_HALVING_ZBX {
        2
    } else {
        4
    }
}

/// Adjusted block reward based on total minted supply
pub fn adjusted_block_reward(total_minted_zbx: u64) -> u64 {
    INITIAL_BLOCK_REWARD_MIST / get_halving_multiplier(total_minted_zbx)
}

/// Gas fee split for a given fee amount (returns validator_share, treasury_share, burn_share)
pub fn split_gas_fee(fee_mist: u64, total_burned_mist: u64) -> (u64, u64, u64) {
    let validator_share = fee_mist * GAS_VALIDATOR_BPS / 10_000;
    let treasury_share  = fee_mist * GAS_TREASURY_BPS  / 10_000;
    let burn_raw        = fee_mist * GAS_BURN_BPS       / 10_000;

    // If burn cap reached, redirect burn share to validators
    let (burn_share, validator_final) = if is_burn_allowed(total_burned_mist) {
        (burn_raw, validator_share)
    } else {
        (0, validator_share + burn_raw) // burn cap hit → all to validators
    };

    (validator_final, treasury_share, burn_share)
}

/// Check if validator slot limit is reached
pub fn is_validator_cap_reached(active_validators: u64) -> bool {
    active_validators >= MAX_VALIDATORS
}

/// Check if a validator's stake slot is full
pub fn is_slot_full(current_slot_stake_mist: u64) -> bool {
    current_slot_stake_mist >= MAX_STAKE_PER_VALIDATOR * MIST_PER_ZBX
}
'''

# Remove old MIST_PER_SUI / TOTAL_SUPPLY_SUI constants if present
import re
content = re.sub(r'pub const MIST_PER_SUI.*?;', '', content)
content = re.sub(r'pub const TOTAL_SUPPLY_SUI.*?;', '', content)

# Add Zebvix constants at the top after the first use statement
insert_after = "use serde::{Deserialize, Serialize};"
if insert_after in content:
    content = content.replace(insert_after, insert_after + "\n" + ZEBVIX_CONSTANTS, 1)
else:
    # Fallback: prepend to file after any #![...] attrs
    content = ZEBVIX_CONSTANTS + "\n" + content

with open("crates/sui-types/src/gas_coin.rs", "w") as f:
    f.write(content)

print("  ZBX constants written to gas_coin.rs")
PYEOF

echo "  Step 3 done."
