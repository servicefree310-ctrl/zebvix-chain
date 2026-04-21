#!/bin/bash
# ============================================================
#  Zebvix Technologies Pvt Ltd
#  Zebvix (ZBX) Blockchain — Automated Setup Script
#  Run this on: Ubuntu 22.04 LTS
#  Usage: chmod +x zebvix-setup.sh && sudo ./zebvix-setup.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${CYAN}[ZEBVIX]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}  Zebvix Technologies Pvt Ltd                   ${NC}"
echo -e "${CYAN}  ZBX Blockchain Node — Setup Script v1.0       ${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

# ── 1. Check OS ──────────────────────────────────────────
log "Checking operating system..."
if ! grep -q "Ubuntu" /etc/os-release; then
    fail "This script requires Ubuntu 22.04 LTS."
fi
ok "Ubuntu detected."

# ── 2. Update system ─────────────────────────────────────
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
ok "System updated."

# ── 3. Install dependencies ──────────────────────────────
log "Installing build dependencies..."
apt-get install -y -qq \
    build-essential \
    libssl-dev \
    pkg-config \
    clang \
    cmake \
    curl \
    git \
    jq \
    wget \
    unzip \
    libclang-dev \
    libpq-dev
ok "Dependencies installed."

# ── 4. Install Rust ──────────────────────────────────────
log "Installing Rust toolchain..."
if command -v rustup &> /dev/null; then
    warn "Rust already installed. Updating..."
    rustup update stable
else
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.75.0
    source "$HOME/.cargo/env"
fi
rustup default 1.75.0
ok "Rust $(rustc --version) installed."

# ── 5. Create zebvix user & directories ──────────────────
log "Creating zebvix system user and directories..."
if ! id "zebvix" &>/dev/null; then
    useradd -r -m -s /bin/bash zebvix
fi
mkdir -p /var/zebvix/{db,genesis,consensus_db,logs}
chown -R zebvix:zebvix /var/zebvix
ok "Directories created at /var/zebvix/"

# ── 6. Clone Sui repository ──────────────────────────────
log "Cloning Sui repository (base for Zebvix)..."
REPO_DIR="/opt/zebvix"
if [ -d "$REPO_DIR" ]; then
    warn "Directory $REPO_DIR already exists. Pulling latest..."
    cd "$REPO_DIR" && git pull
else
    git clone --depth=1 --branch mainnet-v1.20.0 \
        https://github.com/MystenLabs/sui.git "$REPO_DIR"
fi
cd "$REPO_DIR"
ok "Repository cloned to $REPO_DIR"

# ── 7. Rename to Zebvix in Cargo.toml ────────────────────
log "Renaming binary from sui-node to zebvix-node..."

# Rename package in sui-node Cargo.toml
sed -i 's/^name = "sui-node"/name = "zebvix-node"/' \
    "$REPO_DIR/crates/sui-node/Cargo.toml"

# Rename binary name
sed -i '/^\[\[bin\]\]/,/^name = "sui-node"/ s/name = "sui-node"/name = "zebvix-node"/' \
    "$REPO_DIR/crates/sui-node/Cargo.toml"

# Rename CLI tool
sed -i 's/^name = "sui"$/name = "zebvix"/' \
    "$REPO_DIR/crates/sui-tool/Cargo.toml" 2>/dev/null || true

ok "Binary renamed to zebvix-node"

# ── 8. Rename token symbol SUI -> ZBX ────────────────────
log "Updating token symbol: SUI -> ZBX..."
GAS_COIN="$REPO_DIR/crates/sui-types/src/gas_coin.rs"
if [ -f "$GAS_COIN" ]; then
    sed -i 's/SUI_SYMBOL = "SUI"/SUI_SYMBOL = "ZBX"/' "$GAS_COIN"
    sed -i 's/SUI_NAME = "Sui"/SUI_NAME = "Zebvix"/' "$GAS_COIN"
    ok "Token symbol updated: ZBX"
else
    warn "gas_coin.rs not found at expected path. Manual update needed."
fi

# ── 9. Update config directory .sui -> .zebvix ───────────
log "Updating config directory from .sui to .zebvix..."
CONFIG_LIB="$REPO_DIR/crates/sui-config/src/lib.rs"
if [ -f "$CONFIG_LIB" ]; then
    sed -i 's/".sui"/.zebvix"/g' "$CONFIG_LIB"
    sed -i 's/SUI_CONFIG_DIR/ZEBVIX_CONFIG_DIR/g' "$CONFIG_LIB"
    ok "Config directory updated to .zebvix"
else
    warn "sui-config lib.rs not found. Manual update may be needed."
fi

# ── 10. Build Zebvix node ─────────────────────────────────
log "Building zebvix-node binary (this will take 20-40 minutes)..."
source "$HOME/.cargo/env"
cd "$REPO_DIR"
cargo build --release -p zebvix-node 2>&1 | tee /var/zebvix/logs/build.log

if [ -f "$REPO_DIR/target/release/zebvix-node" ]; then
    ok "zebvix-node built successfully!"
    cp "$REPO_DIR/target/release/zebvix-node" /usr/local/bin/zebvix-node
    chmod +x /usr/local/bin/zebvix-node
    ok "Binary copied to /usr/local/bin/zebvix-node"
else
    fail "Build failed. Check /var/zebvix/logs/build.log"
fi

# ── 11. Generate genesis.yaml ─────────────────────────────
log "Creating Zebvix genesis.yaml template..."
cat > /var/zebvix/genesis/genesis.yaml << 'GENESIS_EOF'
---
chain_id: "zebvix-mainnet-1"
epoch_duration_ms: 86400000
protocol_version: 1
reference_gas_price: 1000
initial_stake_subsidy_amount: 1000000000000000
min_validator_count: 4
max_validator_count: 100

# Add your validators below after generating keypairs
# Run: zebvix keytool generate ed25519
validators: []
GENESIS_EOF
ok "genesis.yaml created at /var/zebvix/genesis/genesis.yaml"

# ── 12. Create validator.yaml template ───────────────────
log "Creating validator.yaml template..."
cat > /var/zebvix/validator.yaml << 'VALIDATOR_EOF'
---
# Zebvix Technologies Pvt Ltd — Validator Configuration
# Replace all placeholder values before starting the node

protocol-key-pair:
  value: "REPLACE_WITH_YOUR_PROTOCOL_KEY"
network-key-pair:
  value: "REPLACE_WITH_YOUR_NETWORK_KEY"
worker-key-pair:
  value: "REPLACE_WITH_YOUR_WORKER_KEY"
account-key-pair:
  value: "REPLACE_WITH_YOUR_ACCOUNT_KEY"

network-address: "/ip4/0.0.0.0/tcp/8080/http"
metrics-address: "0.0.0.0:9184"
admin-interface-port: 1337

consensus-config:
  address: "/ip4/127.0.0.1/tcp/8083/http"
  db-path: "/var/zebvix/consensus_db"

genesis:
  genesis-file-location: "/var/zebvix/genesis/genesis.blob"

db-path: "/var/zebvix/db"
VALIDATOR_EOF
ok "validator.yaml created at /var/zebvix/validator.yaml"

# ── 13. Create systemd service ────────────────────────────
log "Creating zebvix-node systemd service..."
cat > /etc/systemd/system/zebvix-node.service << 'SERVICE_EOF'
[Unit]
Description=Zebvix Node — Zebvix Technologies Pvt Ltd
After=network.target
Wants=network.target

[Service]
Type=simple
User=zebvix
ExecStart=/usr/local/bin/zebvix-node --config-path /var/zebvix/validator.yaml
Restart=always
RestartSec=10
LimitNOFILE=1000000
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zebvix-node

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
ok "systemd service created: zebvix-node"

# ── 14. Setup firewall ────────────────────────────────────
log "Configuring UFW firewall rules..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp comment "SSH"
    ufw allow 8080/tcp comment "Zebvix P2P"
    ufw allow 9000/tcp comment "Zebvix RPC"
    ufw allow 9184/tcp comment "Zebvix Metrics"
    ok "Firewall rules added."
else
    warn "UFW not found. Configure firewall manually."
fi

# ── Done ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Zebvix Setup Complete!                        ${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "  Binary:     ${CYAN}/usr/local/bin/zebvix-node${NC}"
echo -e "  Validator:  ${CYAN}/var/zebvix/validator.yaml${NC}"
echo -e "  Genesis:    ${CYAN}/var/zebvix/genesis/genesis.yaml${NC}"
echo -e "  Logs:       ${CYAN}/var/zebvix/logs/${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Generate keypairs:  zebvix keytool generate ed25519"
echo "  2. Update validator.yaml with your generated keys"
echo "  3. Fill validators list in genesis.yaml"
echo "  4. Build genesis.blob: zebvix genesis --from-yaml /var/zebvix/genesis/genesis.yaml"
echo "  5. Start node:         systemctl enable --now zebvix-node"
echo "  6. Check logs:         journalctl -u zebvix-node -f"
echo ""
echo -e "${CYAN}Zebvix Technologies Pvt Ltd — ZBX Chain${NC}"
echo ""
