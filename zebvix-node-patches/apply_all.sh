#!/usr/bin/env bash
# ============================================================
# Zebvix Node — Master Patch Script
# Run from: ~/zebvix-node (your Sui repo root)
# Usage: bash ~/zebvix-node-patches/apply_all.sh
# ============================================================
set -euo pipefail

PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo -e "${CYAN}"
echo "=============================================="
echo "   Zebvix Node Patch System v1.0"
echo "   Sui fork → Zebvix Chain (ZBX)"
echo "=============================================="
echo -e "${NC}"

[ -f "$REPO_DIR/Cargo.toml" ] || error "Sui repo nahi mila. Repo root se chalaao."

info "Step 1: SUI → ZBX rename + binary name..."
bash "$PATCH_DIR/step1_rename.sh"
success "Step 1 complete"

info "Step 2: EVM 20-byte address..."
bash "$PATCH_DIR/step2_address.sh"
success "Step 2 complete"

info "Step 3: Tokenomics constants + burn cap..."
bash "$PATCH_DIR/step3_constants.sh"
success "Step 3 complete"

info "Step 4: MultiSig rules..."
bash "$PATCH_DIR/step4_multisig.sh"
success "Step 4 complete"

info "Step 5: Move modules copy..."
bash "$PATCH_DIR/step5_move.sh"
success "Step 5 complete"

info "Step 6: Config files..."
bash "$PATCH_DIR/step6_config.sh"
success "Step 6 complete"

echo ""
echo -e "${GREEN}======================================================"
echo "  All patches applied successfully!"
echo "  Next: cargo build --release -p sui-node --bin zebvix-node"
echo -e "======================================================${NC}"
