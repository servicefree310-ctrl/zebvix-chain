#!/usr/bin/env bash
# Step 2: EVM-compatible 20-byte address
# Modifies: crates/sui-types/src/base_types.rs

set -euo pipefail

BASE_TYPES="crates/sui-types/src/base_types.rs"
[ -f "$BASE_TYPES" ] || { echo "  SKIP: $BASE_TYPES not found"; exit 0; }

echo "  [2.1] SUI_ADDRESS_LENGTH: 32 → 20"
sed -i 's/pub const SUI_ADDRESS_LENGTH: usize = 32;/pub const SUI_ADDRESS_LENGTH: usize = 20; \/\/ ZBX: EVM-compatible 20-byte address/' "$BASE_TYPES"

echo "  [2.2] SuiPublicKey::try_from — last 20 bytes of Blake2b256"
# This patches the from_bytes / address derivation to use last 20 bytes
# Pattern: wherever hash.as_ref() is sliced to get address, use &hash[12..] instead of hash.as_ref()
python3 << 'PYEOF'
import re, sys

with open("crates/sui-types/src/base_types.rs", "r") as f:
    content = f.read()

# Patch 1: SuiPublicKey derivation — take last 20 bytes from 32-byte hash
# Look for the pattern where Blake2b256 hash is used to derive address
# Original: SuiAddress((&hash).into()) — replaces full 32 bytes
# New: take last 20 bytes

# Pattern for address derivation from public key hash (function that was ~line 922)
old1 = r'(fn try_from\(pk: &SuiPublicKey\).*?)(hasher\.finalize\(\))(.*?SuiAddress\()(&?hash(?:\.as_ref\(\))?)((?:\[.*?\])?)'
# This is complex, use simpler targeted replacements

# Replace specific address-length slice patterns
content = content.replace(
    "let mut result = [0u8; SUI_ADDRESS_LENGTH];",
    "let mut result = [0u8; SUI_ADDRESS_LENGTH]; // 20 bytes"
)

# Where Blake2b256 hash (32 bytes) → address (20 bytes): take last 20
content = re.sub(
    r'(SuiAddress\()(&hash(?:\.as_ref\(\))?)\[\.\.SUI_ADDRESS_LENGTH\](\))',
    r'\1&hash[12..]\3  // ZBX: last 20 bytes of 32-byte hash',
    content
)
content = re.sub(
    r'(SuiAddress\()(&hash)\[(\d+)\.\.(\d+)\](\))',
    lambda m: f'{m.group(1)}&hash[12..]{m.group(5)}  // ZBX: last 20 bytes',
    content
)

# ObjectID to SuiAddress conversion — last 20 bytes
content = re.sub(
    r'(fn from\(id: ObjectID\).*?SuiAddress\()(&id\.0\.as_ref\(\))\[\.\.SUI_ADDRESS_LENGTH\](\))',
    r'\1&id.0.as_ref()[12..]\3  // ZBX: last 20 bytes',
    content,
    flags=re.DOTALL
)

with open("crates/sui-types/src/base_types.rs", "w") as f:
    f.write(content)

print("  Python patch applied to base_types.rs")
PYEOF

echo "  [2.3] AccountAddress ↔ SuiAddress conversions"
python3 << 'PYEOF'
import re

with open("crates/sui-types/src/base_types.rs", "r") as f:
    content = f.read()

# SuiAddress → AccountAddress: pad 20 → 32 bytes
# Find conversion where 20-byte SuiAddress is expanded to 32-byte AccountAddress
content = re.sub(
    r'AccountAddress::new\(self\.0\)',
    'AccountAddress::new({ let mut b = [0u8; 32]; b[12..].copy_from_slice(&self.0); b })',
    content
)

with open("crates/sui-types/src/base_types.rs", "w") as f:
    f.write(content)

print("  AccountAddress padding patch applied")
PYEOF

echo "  [2.4] sui_sdk_types_conversions.rs — address fix"
SDK_CONV="crates/sui-sdk-types/src/types/address.rs"
if [ ! -f "$SDK_CONV" ]; then
    SDK_CONV=$(find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl 'SuiAddress.*AccountAddress' 2>/dev/null | head -1)
fi
if [ -n "$SDK_CONV" ] && [ -f "$SDK_CONV" ]; then
    sed -i 's/\.as_ref()\[\.\.32\]/\.as_ref()[12..]/g' "$SDK_CONV" 2>/dev/null || true
fi

echo "  Step 2 done."
