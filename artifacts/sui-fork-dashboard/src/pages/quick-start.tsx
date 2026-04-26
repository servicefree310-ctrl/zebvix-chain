import React, { useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Check, Copy, Terminal, Server, Zap, Shield, Download,
  PlayCircle, Cpu, HardDrive, Wifi, ChevronRight, Activity,
} from "lucide-react";

const SETUP_SCRIPT = `#!/bin/bash
# ============================================================
#  Zebvix Technologies Pvt Ltd
#  Zebvix L1 (ZBX) Node — Automated Setup
#  Target: Ubuntu 22.04 LTS  ·  64-bit  ·  Root access
#  Usage:  chmod +x zebvix-setup.sh && sudo ./zebvix-setup.sh
# ============================================================

set -e

CYAN='\\033[0;36m'; GREEN='\\033[0;32m'; YELLOW='\\033[1;33m'
RED='\\033[0;31m'; NC='\\033[0m'
log()  { echo -e "\${CYAN}[ZEBVIX]\${NC} $1"; }
ok()   { echo -e "\${GREEN}[OK]\${NC} $1"; }
warn() { echo -e "\${YELLOW}[WARN]\${NC} $1"; }
fail() { echo -e "\${RED}[FAIL]\${NC} $1"; exit 1; }

echo ""
echo -e "\${CYAN}================================================\${NC}"
echo -e "\${CYAN}  Zebvix L1 — Production Node Bootstrap        \${NC}"
echo -e "\${CYAN}================================================\${NC}"
echo ""

# 1. OS check
log "Checking operating system..."
grep -q "Ubuntu" /etc/os-release || fail "This script requires Ubuntu 22.04 LTS."
ok "Ubuntu detected."

# 2. Install build deps
log "Installing build dependencies..."
apt-get update -qq
apt-get install -y -qq build-essential pkg-config libssl-dev clang \\
  cmake curl wget jq unzip libclang-dev git ufw
ok "Dependencies installed."

# 3. Install Rust toolchain
log "Installing Rust 1.83 stable..."
if ! command -v rustup &>/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.83.0
  source "$HOME/.cargo/env"
fi
rustup default 1.83.0
ok "Rust $(rustc --version) ready."

# 4. Service user + data dirs
log "Creating zebvix service user..."
id zebvix &>/dev/null || useradd -r -m -s /bin/bash zebvix
mkdir -p /var/zebvix/{db,logs,config}
chown -R zebvix:zebvix /var/zebvix
ok "Data dirs at /var/zebvix/"

# 5. Download Zebvix chain source tarball
log "Downloading Zebvix chain source..."
SRC_DIR="/opt/zebvix-chain"
TARBALL="/tmp/zebvix-chain.tar.gz"
DASHBOARD_HOST="\${ZEBVIX_DASHBOARD:-https://dashboard.zebvix.io}"
wget -q -O "$TARBALL" "$DASHBOARD_HOST/api/download/newchain" \\
  || fail "Download failed — check ZEBVIX_DASHBOARD env."
mkdir -p "$SRC_DIR"
tar -xzf "$TARBALL" -C "$SRC_DIR"
ok "Source extracted to $SRC_DIR"

# 6. Build the binary
log "Building zebvix-node (release profile, ~3-5 minutes)..."
cd "$SRC_DIR"
source "$HOME/.cargo/env"
cargo build --release --features zvm 2>&1 | tee /var/zebvix/logs/build.log
[ -f "$SRC_DIR/target/release/zebvix-node" ] || fail "Build failed — see /var/zebvix/logs/build.log"
install -m 755 "$SRC_DIR/target/release/zebvix-node" /usr/local/bin/zebvix-node
ok "Binary at /usr/local/bin/zebvix-node"

# 7. systemd unit
log "Registering systemd service..."
cat > /etc/systemd/system/zebvix.service <<'UNIT'
[Unit]
Description=Zebvix L1 Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=zebvix
WorkingDirectory=/var/zebvix
ExecStart=/usr/local/bin/zebvix-node --data-dir /var/zebvix/db --rpc-bind 0.0.0.0:8545
Restart=always
RestartSec=5
LimitNOFILE=1000000
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zebvix

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
ok "systemd service installed."

# 8. Firewall
log "Applying firewall rules..."
ufw allow 22/tcp   comment 'SSH'      &>/dev/null || true
ufw allow 8545/tcp comment 'JSON-RPC' &>/dev/null || true
ufw allow 30303    comment 'P2P'      &>/dev/null || true
ok "Firewall rules added (run 'ufw enable' to activate)."

# 9. Start
log "Enabling and starting zebvix.service..."
systemctl enable zebvix.service
systemctl start  zebvix.service
ok "Node started."

echo ""
echo -e "\${GREEN}================================================\${NC}"
echo -e "\${GREEN}  Zebvix node is now running                    \${NC}"
echo -e "\${GREEN}================================================\${NC}"
echo ""
echo "  Binary  : /usr/local/bin/zebvix-node"
echo "  Data    : /var/zebvix/db"
echo "  Logs    : journalctl -u zebvix -f"
echo "  RPC     : http://<server-ip>:8545"
echo ""
echo "Verify:   curl http://localhost:8545 -H 'Content-Type: application/json' \\\\"
echo "            -d '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"eth_blockNumber\\",\\"params\\":[]}'"
echo ""`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };
  return (
    <button
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-mono text-primary hover:bg-primary/20 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy script"}
    </button>
  );
}

const STEPS = [
  { icon: Download, label: "Fetch source",   desc: "Tarball pulled from your dashboard" },
  { icon: Terminal, label: "Install Rust",   desc: "Toolchain + system build deps" },
  { icon: Server,   label: "Compile binary", desc: "cargo build --release ~3-5 min" },
  { icon: Shield,   label: "Run as service", desc: "systemd + firewall + auto-restart" },
];

const SPECS = [
  { icon: Cpu,       label: "CPU",     val: "8+ cores" },
  { icon: HardDrive, label: "Storage", val: "500 GB NVMe" },
  { icon: Server,    label: "RAM",     val: "32 GB" },
  { icon: Wifi,      label: "Network", val: "1 Gbps" },
];

export default function QuickStart() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <header>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-[10px] font-bold uppercase tracking-widest mb-3">
          <PlayCircle className="h-3 w-3" />
          One-Command Bootstrap
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-3">
          Quick-Start Your Zebvix Node
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-3xl">
          A single bash script downloads the Zebvix chain source, builds the binary, registers a systemd service, and brings the JSON-RPC endpoint live — typically in under ten minutes on a fresh Ubuntu 22.04 server.
        </p>
      </header>

      {/* Step pills */}
      <section aria-labelledby="steps">
        <h2 id="steps" className="sr-only">Setup steps</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STEPS.map(({ icon: Icon, label, desc }, i) => (
            <div
              key={label}
              className="relative rounded-xl border border-border/60 bg-gradient-to-br from-card/60 to-card/20 backdrop-blur p-4 text-center"
            >
              <span className="absolute top-2 right-2 text-[10px] font-mono text-muted-foreground/60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="mx-auto mb-2 h-9 w-9 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="text-sm font-semibold text-foreground">{label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Server specs */}
      <section className="rounded-xl border border-border/60 bg-card/40 backdrop-blur p-5">
        <header className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Recommended server
          </h2>
          <span className="text-[10px] font-mono text-muted-foreground/60">Ubuntu 22.04 LTS</span>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SPECS.map(({ icon: Icon, label, val }) => (
            <div key={label} className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="h-8 w-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="text-sm font-semibold text-foreground">{val}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Step 1 — copy script */}
      <section className="space-y-3">
        <SectionHeader index={1} title="Copy the bootstrap script" />
        <CodeBlock language="bash" code={`# On your Ubuntu 22.04 server:
nano zebvix-setup.sh
# Paste the script below, then save:  Ctrl+O  Enter  Ctrl+X`} />
      </section>

      {/* Full script */}
      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <SectionHeader index={2} title="The full setup script" inline />
          <CopyButton text={SETUP_SCRIPT} />
        </div>
        <CodeBlock language="bash" code={SETUP_SCRIPT} />
      </section>

      {/* Step 3 — run */}
      <section className="space-y-3">
        <SectionHeader index={3} title="Run it" />
        <CodeBlock language="bash" code={`chmod +x zebvix-setup.sh
sudo ./zebvix-setup.sh
# The build step takes ~3-5 minutes. Watch the output for "Zebvix node is now running".`} />
      </section>

      {/* Step 4 — verify */}
      <section className="space-y-3">
        <SectionHeader index={4} title="Verify the JSON-RPC endpoint" />
        <CodeBlock language="bash" code={`# From any machine that can reach your server:
curl -s http://<server-ip>:8545 \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# Expected response (block number is hex, increases over time):
#   {"jsonrpc":"2.0","id":1,"result":"0x7c00"}`} />
      </section>

      {/* What you get */}
      <section className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-5">
        <header className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">
            What you get
          </h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          {[
            ["Binary",        "/usr/local/bin/zebvix-node"],
            ["Data dir",      "/var/zebvix/db"],
            ["Service",       "systemctl status zebvix"],
            ["Live logs",     "journalctl -u zebvix -f"],
            ["JSON-RPC",      "http://<server-ip>:8545"],
            ["Chain ID",      "7878 (Cancun-compatible)"],
            ["P2P port",      "30303 (TCP)"],
            ["MetaMask",      "Add network with chain id 7878"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/15 bg-background/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="text-xs font-mono text-foreground/90 truncate">{v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Next links */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { href: "/setup",      title: "Environment Setup",   desc: "Customize ports, peers, and pruning." },
          { href: "/validators", title: "Add a Validator",     desc: "Register your node into consensus." },
          { href: "/production", title: "Production Hardening",desc: "Security, monitoring, and backups." },
        ].map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/60 p-4 flex items-start justify-between gap-3 transition-colors"
          >
            <div>
              <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{c.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.desc}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
          </a>
        ))}
      </section>
    </div>
  );
}

function SectionHeader({
  index, title, inline,
}: { index: number; title: string; inline?: boolean }) {
  return (
    <h2 className={`flex items-center gap-3 text-lg font-semibold text-foreground ${inline ? "" : "mb-1"}`}>
      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-bold">
        {index}
      </span>
      <span>{title}</span>
    </h2>
  );
}
