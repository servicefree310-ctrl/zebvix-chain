import React, { useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { Check, Copy, Terminal, Server, Zap, Shield } from "lucide-react";

const SETUP_SCRIPT = `#!/bin/bash
# ============================================================
#  Zebvix Technologies Pvt Ltd
#  Zebvix (ZBX) Blockchain — Automated Setup Script
#  Run this on: Ubuntu 22.04 LTS
#  Usage: chmod +x zebvix-setup.sh && sudo ./zebvix-setup.sh
# ============================================================

set -e

RED='\\033[0;31m'
GREEN='\\033[0;32m'
CYAN='\\033[0;36m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

log()  { echo -e "\${CYAN}[ZEBVIX]\${NC} $1"; }
ok()   { echo -e "\${GREEN}[OK]\${NC} $1"; }
warn() { echo -e "\${YELLOW}[WARN]\${NC} $1"; }
fail() { echo -e "\${RED}[FAIL]\${NC} $1"; exit 1; }

echo ""
echo -e "\${CYAN}================================================\${NC}"
echo -e "\${CYAN}  Zebvix Technologies Pvt Ltd                   \${NC}"
echo -e "\${CYAN}  ZBX Blockchain Node — Setup Script v1.0       \${NC}"
echo -e "\${CYAN}================================================\${NC}"
echo ""

# 1. System check
log "Checking operating system..."
if ! grep -q "Ubuntu" /etc/os-release; then
    fail "This script requires Ubuntu 22.04 LTS."
fi
ok "Ubuntu detected."

# 2. Update system
log "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq
ok "System updated."

# 3. Install dependencies
log "Installing build dependencies..."
apt-get install -y -qq build-essential libssl-dev pkg-config clang \\
    cmake curl git jq wget unzip libclang-dev libpq-dev
ok "Dependencies installed."

# 4. Install Rust
log "Installing Rust 1.75.0..."
if command -v rustup &> /dev/null; then
    rustup update stable
else
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.75.0
    source "$HOME/.cargo/env"
fi
rustup default 1.75.0
ok "Rust \$(rustc --version) ready."

# 5. Create user & directories
log "Creating zebvix user and data directories..."
id "zebvix" &>/dev/null || useradd -r -m -s /bin/bash zebvix
mkdir -p /var/zebvix/{db,genesis,consensus_db,logs}
chown -R zebvix:zebvix /var/zebvix
ok "Directories ready at /var/zebvix/"

# 6. Clone Sui (Zebvix base)
log "Cloning Sui repository..."
REPO_DIR="/opt/zebvix"
if [ -d "$REPO_DIR" ]; then
    warn "Directory exists. Pulling latest..."
    cd "$REPO_DIR" && git pull
else
    git clone --depth=1 --branch mainnet-v1.20.0 \\
        https://github.com/MystenLabs/sui.git "$REPO_DIR"
fi
cd "$REPO_DIR"
ok "Cloned to $REPO_DIR"

# 7. Rename binary: sui-node -> zebvix-node
log "Renaming binary to zebvix-node..."
sed -i 's/^name = "sui-node"/name = "zebvix-node"/' \\
    "$REPO_DIR/crates/sui-node/Cargo.toml"
ok "Binary renamed."

# 8. Update token symbol: SUI -> ZBX
log "Updating token symbol SUI -> ZBX..."
GAS_COIN="$REPO_DIR/crates/sui-types/src/gas_coin.rs"
if [ -f "$GAS_COIN" ]; then
    sed -i 's/SUI_SYMBOL = "SUI"/SUI_SYMBOL = "ZBX"/' "$GAS_COIN"
    sed -i 's/SUI_NAME = "Sui"/SUI_NAME = "Zebvix"/' "$GAS_COIN"
    ok "Token: ZBX"
else
    warn "gas_coin.rs not found — update manually."
fi

# 9. Update config dir: .sui -> .zebvix
log "Updating config directory to .zebvix..."
CONFIG="$REPO_DIR/crates/sui-config/src/lib.rs"
[ -f "$CONFIG" ] && sed -i 's/".sui"/.zebvix"/g' "$CONFIG" && ok "Config dir updated." || warn "Manual update needed."

# 10. Build zebvix-node (20-40 min)
log "Building zebvix-node — please wait (20-40 minutes)..."
source "$HOME/.cargo/env"
cargo build --release -p zebvix-node 2>&1 | tee /var/zebvix/logs/build.log
[ -f "$REPO_DIR/target/release/zebvix-node" ] || fail "Build failed. Check /var/zebvix/logs/build.log"
cp "$REPO_DIR/target/release/zebvix-node" /usr/local/bin/zebvix-node
chmod +x /usr/local/bin/zebvix-node
ok "Binary at /usr/local/bin/zebvix-node"

# 11. Write genesis.yaml
log "Writing genesis.yaml template..."
cat > /var/zebvix/genesis/genesis.yaml << 'GENESIS'
chain_id: "zebvix-mainnet-1"
epoch_duration_ms: 86400000
protocol_version: 1
reference_gas_price: 1000
initial_stake_subsidy_amount: 1000000000000000
min_validator_count: 4
max_validator_count: 100
validators: []
GENESIS
ok "genesis.yaml ready."

# 12. Write validator.yaml
log "Writing validator.yaml template..."
cat > /var/zebvix/validator.yaml << 'VALIDATOR'
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
VALIDATOR
ok "validator.yaml ready."

# 13. systemd service
log "Creating zebvix-node systemd service..."
cat > /etc/systemd/system/zebvix-node.service << 'SERVICE'
[Unit]
Description=Zebvix Node — Zebvix Technologies Pvt Ltd
After=network.target

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
SERVICE
systemctl daemon-reload
ok "systemd service registered."

# 14. Firewall
log "Configuring firewall rules..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp comment "SSH"
    ufw allow 8080/tcp comment "Zebvix P2P"
    ufw allow 9000/tcp comment "Zebvix RPC"
    ufw allow 9184/tcp comment "Metrics"
    ok "Firewall rules added."
else
    warn "UFW not found — configure manually."
fi

# Done!
echo ""
echo -e "\${GREEN}================================================\${NC}"
echo -e "\${GREEN}  SETUP COMPLETE — Zebvix (ZBX) Node Ready!     \${NC}"
echo -e "\${GREEN}================================================\${NC}"
echo ""
echo "  Binary:     /usr/local/bin/zebvix-node"
echo "  Config:     /var/zebvix/validator.yaml"
echo "  Genesis:    /var/zebvix/genesis/genesis.yaml"
echo ""
echo "NEXT STEPS:"
echo "  1. zebvix keytool generate ed25519  (generate 4 keypairs)"
echo "  2. Edit /var/zebvix/validator.yaml with your keys"
echo "  3. Add validators to genesis.yaml"
echo "  4. zebvix genesis --from-yaml /var/zebvix/genesis/genesis.yaml"
echo "  5. systemctl enable --now zebvix-node"
echo "  6. journalctl -u zebvix-node -f"
echo ""`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-md bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Copy Script"}
    </button>
  );
}

export default function QuickStart() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">
          Quick Start Script
        </h1>
        <p className="text-lg text-muted-foreground">
          One bash script to set up the complete Zebvix (ZBX) node on a fresh Ubuntu 22.04 server — no manual steps needed.
        </p>
      </div>

      {/* What it does */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Terminal, label: "Installs Rust 1.75", desc: "& all build deps" },
          { icon: Zap, label: "Clones & Renames", desc: "sui-node → zebvix-node" },
          { icon: Server, label: "Builds Binary", desc: "~20-40 minutes" },
          { icon: Shield, label: "Configs & Service", desc: "systemd + firewall" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="p-4 rounded-lg bg-card border border-border text-center">
            <Icon className="h-6 w-6 text-primary mx-auto mb-2" />
            <div className="text-sm font-semibold text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
          </div>
        ))}
      </div>

      {/* Server requirement */}
      <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-sm">
        <div className="flex items-start gap-2">
          <span className="text-yellow-400 mt-0.5">⚠</span>
          <div>
            <span className="font-semibold text-yellow-400">Server Requirements:</span>
            <span className="text-muted-foreground ml-1">
              Ubuntu 22.04 LTS &nbsp;·&nbsp; 32 GB RAM &nbsp;·&nbsp; 8+ CPU cores &nbsp;·&nbsp; 500 GB NVMe SSD &nbsp;·&nbsp; Root access
            </span>
          </div>
        </div>
      </div>

      {/* Step 1 — Upload script */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Step 1 — Copy &amp; Upload Script</h2>
        <p className="text-sm text-muted-foreground">Copy the full script below. On your server, create the file and paste it.</p>
        <CodeBlock language="bash" code={`# On your Ubuntu server — create the file
nano zebvix-setup.sh
# Paste the script, then save: Ctrl+O  Enter  Ctrl+X`} />
      </div>

      {/* The actual script */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Full Setup Script</h2>
          <CopyButton text={SETUP_SCRIPT} />
        </div>
        <div className="relative">
          <CodeBlock language="bash" code={SETUP_SCRIPT} />
        </div>
      </div>

      {/* Step 2 — Run */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Step 2 — Run the Script</h2>
        <CodeBlock language="bash" code={`chmod +x zebvix-setup.sh
sudo ./zebvix-setup.sh`} />
        <p className="text-xs text-muted-foreground">
          The build step (cargo build) will take 20-40 minutes depending on your server CPU. Watch progress in terminal.
        </p>
      </div>

      {/* Step 3 — After setup */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Step 3 — After Setup Completes</h2>
        <CodeBlock language="bash" code={`# Generate your 4 keypairs
/usr/local/bin/zebvix-node keytool generate ed25519

# Edit your keys into validator config
nano /var/zebvix/validator.yaml

# Add validators to genesis config
nano /var/zebvix/genesis/genesis.yaml

# Build genesis blob
/usr/local/bin/zebvix-node genesis --from-yaml /var/zebvix/genesis/genesis.yaml

# Start the node
systemctl enable --now zebvix-node

# Watch live logs
journalctl -u zebvix-node -f`} />
      </div>

      {/* Files created */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Files Created by Script</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Path</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["/usr/local/bin/zebvix-node", "Compiled node binary"],
                ["/var/zebvix/validator.yaml", "Validator config (fill your keys)"],
                ["/var/zebvix/genesis/genesis.yaml", "Genesis template (add validators)"],
                ["/var/zebvix/db/", "Blockchain state database"],
                ["/var/zebvix/consensus_db/", "Consensus data"],
                ["/var/zebvix/logs/build.log", "Build output log"],
                ["/etc/systemd/system/zebvix-node.service", "systemd service file"],
              ].map(([path, desc]) => (
                <tr key={path} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-primary">{path}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
