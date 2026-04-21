#!/usr/bin/env bash
# Step 4: MultiSig rules — thresholds + constants

set -euo pipefail

echo "  [4.1] MAX_SIGNER_IN_MULTISIG stays 10 (already default in Sui)"
MULTISIG_RS=$(find . -name "multisig.rs" -not -path "*/target/*" | head -1)

if [ -z "$MULTISIG_RS" ]; then
    echo "  SKIP: multisig.rs not found"
    exit 0
fi

echo "  Found: $MULTISIG_RS"

python3 << PYEOF
import re

multisig_file = "$MULTISIG_RS"
with open(multisig_file, "r") as f:
    content = f.read()

MULTISIG_CONSTS = '''
// ================================================================
// ZEBVIX MULTISIG THRESHOLD RULES
// ================================================================
/// Maximum signers in any multisig wallet
pub const MAX_MULTISIG_SIGNERS: usize = 10;

/// Treasury multisig: 3 out of 5 signers required (60%)
pub const TREASURY_MULTISIG_M: u16 = 3;
pub const TREASURY_MULTISIG_N: u16 = 5;

/// Chain feature upgrade: 4 out of 6 required (67% supermajority)
pub const CHAIN_UPGRADE_M: u16 = 4;
pub const CHAIN_UPGRADE_N: u16 = 6;

/// Validator key rotation: 3 out of 5 required
pub const VALIDATOR_KEY_ROTATION_M: u16 = 3;
pub const VALIDATOR_KEY_ROTATION_N: u16 = 5;

/// Validate multisig threshold (weights must reach threshold)
pub fn validate_zbx_threshold(weights_sum: u16, threshold: u16) -> bool {
    threshold > 0 && threshold <= weights_sum
}
'''

if "TREASURY_MULTISIG_M" not in content:
    # Insert after the first pub use or use statement block
    insert_pos = content.find("pub const MAX_SIGNER_IN_MULTISIG")
    if insert_pos >= 0:
        end_of_line = content.find("\n", insert_pos) + 1
        content = content[:end_of_line] + MULTISIG_CONSTS + content[end_of_line:]
    else:
        # Fallback: add at end
        content += MULTISIG_CONSTS

    with open(multisig_file, "w") as f:
        f.write(content)
    print("  MultiSig constants added.")
else:
    print("  MultiSig already patched.")
PYEOF

echo "  Step 4 done."
