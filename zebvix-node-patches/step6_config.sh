#!/usr/bin/env bash
# Step 6: Genesis config + network config patches

set -euo pipefail

PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "  [6.1] Chain ID in genesis"
find . -name "*.rs" -not -path "*/target/*" | xargs grep -rl '"sui"' 2>/dev/null | while read f; do
    # Only replace chain-id style references, not just any "sui" string
    sed -i 's/chain_id: "sui"/chain_id: "zebvix-mainnet-1"/g' "$f" 2>/dev/null || true
done

echo "  [6.2] Network config YAML/TOML templates"
find . \( -name "*.yaml" -o -name "*.yml" \) -not -path "*/target/*" | xargs grep -rl 'chain-id: sui' 2>/dev/null | while read f; do
    sed -i 's/chain-id: sui/chain-id: zebvix-mainnet-1/g' "$f"
done

echo "  [6.3] Writing genesis template config"
cp "$PATCH_DIR/config/genesis_template.yaml" config/ 2>/dev/null || true
cp "$PATCH_DIR/config/validator.yaml"         config/ 2>/dev/null || true
cp "$PATCH_DIR/config/fullnode.yaml"          config/ 2>/dev/null || true

echo "  Step 6 done."
