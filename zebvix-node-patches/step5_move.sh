#!/usr/bin/env bash
# Step 5: Copy new Move modules into Sui framework

set -euo pipefail

PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find the Move packages directory
PKG_DIR=""
for candidate in \
    "crates/sui-framework/packages" \
    "crates/sui-move/packages" \
    "packages"; do
    if [ -d "$candidate" ]; then
        PKG_DIR="$candidate"
        break
    fi
done

if [ -z "$PKG_DIR" ]; then
    echo "  Creating packages dir at crates/sui-framework/packages"
    PKG_DIR="crates/sui-framework/packages"
    mkdir -p "$PKG_DIR"
fi

echo "  [5.1] Creating zebvix package directory"
ZEBVIX_PKG="$PKG_DIR/zebvix"
mkdir -p "$ZEBVIX_PKG/sources"

echo "  [5.2] Writing Move.toml for zebvix package"
cat > "$ZEBVIX_PKG/Move.toml" << 'MOVETOML'
[package]
name        = "zebvix"
version     = "0.0.1"
edition     = "2024.beta"
license     = "Apache-2.0"
authors     = ["Zebvix Technologies Pvt Ltd"]

[dependencies]
Sui = { local = "../sui-framework" }

[addresses]
zebvix = "0x0"
MOVETOML

echo "  [5.3] Copying Move modules"
cp "$PATCH_DIR/move/pay_id.move"       "$ZEBVIX_PKG/sources/"
cp "$PATCH_DIR/move/staking_pool.move" "$ZEBVIX_PKG/sources/"
cp "$PATCH_DIR/move/master_pool.move"  "$ZEBVIX_PKG/sources/"
cp "$PATCH_DIR/move/sub_pool.move"     "$ZEBVIX_PKG/sources/"
cp "$PATCH_DIR/move/founder_admin.move" "$ZEBVIX_PKG/sources/"
cp "$PATCH_DIR/move/zbx_token.move"   "$ZEBVIX_PKG/sources/"

echo "  [5.4] Modules in place:"
ls "$ZEBVIX_PKG/sources/"

echo "  Step 5 done."
