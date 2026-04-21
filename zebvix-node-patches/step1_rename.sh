#!/usr/bin/env bash
# Step 1: SUI → ZBX rename + binary name change
# Run from: ~/zebvix-node

set -euo pipefail

echo "  [1.1] Binary name: sui-node → zebvix-node"
# crates/sui-node/Cargo.toml mein [[bin]] section update
if grep -q 'name = "sui-node"' crates/sui-node/Cargo.toml 2>/dev/null; then
    sed -i 's/name = "sui-node"/name = "zebvix-node"/' crates/sui-node/Cargo.toml
fi

echo "  [1.2] Config directory: .sui → .zebvix"
find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl '\.sui' 2>/dev/null | while read f; do
    sed -i 's|\.sui/|\.zebvix/|g' "$f"
    sed -i 's|"\.sui"|"\.zebvix"|g' "$f"
done

echo "  [1.3] MIST_PER_SUI → MIST_PER_ZBX"
find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl 'MIST_PER_SUI' 2>/dev/null | while read f; do
    sed -i 's/MIST_PER_SUI/MIST_PER_ZBX/g' "$f"
done

echo "  [1.4] TOTAL_SUPPLY_SUI → TOTAL_SUPPLY_ZBX"
find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl 'TOTAL_SUPPLY_SUI' 2>/dev/null | while read f; do
    sed -i 's/TOTAL_SUPPLY_SUI/TOTAL_SUPPLY_ZBX/g' "$f"
done

echo "  [1.5] Chain name: sui → zebvix (config/genesis strings)"
find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl '"sui-mainnet"' 2>/dev/null | while read f; do
    sed -i 's/"sui-mainnet"/"zebvix-mainnet-1"/g' "$f"
done
find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl '"sui-testnet"' 2>/dev/null | while read f; do
    sed -i 's/"sui-testnet"/"zebvix-testnet-1"/g' "$f"
done

echo "  [1.6] governance.rs: MIST_PER_SUI import fix"
GOVERNANCE="crates/sui-types/src/governance.rs"
if [ -f "$GOVERNANCE" ]; then
    sed -i 's/use crate::gas_coin::MIST_PER_SUI/use crate::gas_coin::MIST_PER_ZBX/' "$GOVERNANCE"
fi

echo "  [1.7] Move.toml package names"
find . -name "Move.toml" -not -path "*/target/*" | while read f; do
    sed -i 's/SUI = "0x2"/ZBX = "0x2"/' "$f" 2>/dev/null || true
done

echo "  [1.8] Prometheus / metrics labels"
find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl '"sui_' 2>/dev/null | while read f; do
    sed -i 's/"sui_/"zebvix_/g' "$f"
done

echo "  Step 1 done."
