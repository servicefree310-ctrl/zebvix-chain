import { Router } from "express";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const chainBuilderRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Chain Builder API
//
// Lets a non-technical user fork the Zebvix base node into their own L1.
//
// What we generate (small, < 30 KB tarball):
//   <chain>/
//     install.sh                   one-shot installer for Ubuntu/Debian VPS
//     systemd/<chain>-node.service systemd unit
//     README.md                    operator runbook
//
// What the install.sh does on the VPS (matches the REAL CLI in
// zebvix-chain/src/main.rs which is subcommand-based: keygen / init / start):
//
//   1. apt deps + Rust toolchain (if missing)
//   2. wget /api/download/newchain → tar -xzf → cd zebvix-chain
//   3. sed-patch src/tokenomics.rs to bake in the user's CHAIN_ID,
//      TOTAL_SUPPLY_ZBX, FOUNDER_PREMINE_ZBX, BLOCK_TIME_SECS
//   4. cargo build --release
//   5. install /usr/local/bin/<chain>-node
//   6. <chain>-node keygen --out /etc/<chain>/validator.key
//   7. <chain>-node init --home /var/lib/<chain> --validator-key ...
//   8. systemctl enable + start the service (which runs `<chain>-node start ...`)
//   9. health check + print RPC endpoint
//
// We deliberately do NOT generate genesis.yaml / network.toml — the Zebvix
// node CLI is subcommand-based and does not consume those files. Customization
// happens via source-code patches + CLI flags, both of which install.sh
// handles automatically.
// ─────────────────────────────────────────────────────────────────────────────

interface ChainConfig {
  chainName: string;
  chainId: number;
  symbol: string;
  decimals: number;
  totalSupplyZbx: number;
  founderPremineZbx: number;
  blockTimeSecs: number;
  rpcPort: number;
  p2pPort: number;
  description?: string;
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;

function validate(cfg: any): { ok: true; value: ChainConfig } | { ok: false; error: string } {
  if (!cfg || typeof cfg !== "object") return { ok: false, error: "config object required" };

  const chainName = String(cfg.chainName || "").trim().toLowerCase();
  if (!SLUG_RE.test(chainName))
    return { ok: false, error: "chainName: lowercase letters/digits/dash, 2-31 chars" };

  const chainId = Number(cfg.chainId);
  if (!Number.isInteger(chainId) || chainId < 1 || chainId > 2_147_483_647)
    return { ok: false, error: "chainId: integer 1..2147483647" };

  const symbol = String(cfg.symbol || "").trim().toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(symbol))
    return { ok: false, error: "symbol: 2-8 uppercase letters" };

  const decimals = Number(cfg.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    return { ok: false, error: "decimals: 0..36" };

  const totalSupplyZbx = Number(cfg.totalSupplyZbx);
  if (!Number.isInteger(totalSupplyZbx) || totalSupplyZbx < 1 || totalSupplyZbx > 1_000_000_000_000)
    return { ok: false, error: "totalSupplyZbx: integer 1..1_000_000_000_000 (whole tokens)" };

  const founderPremineZbx = Number(cfg.founderPremineZbx);
  if (!Number.isInteger(founderPremineZbx) || founderPremineZbx < 0 || founderPremineZbx > totalSupplyZbx)
    return { ok: false, error: "founderPremineZbx: integer 0..totalSupplyZbx" };

  const blockTimeSecs = Number(cfg.blockTimeSecs);
  if (!Number.isInteger(blockTimeSecs) || blockTimeSecs < 1 || blockTimeSecs > 60)
    return { ok: false, error: "blockTimeSecs: integer 1..60" };

  const rpcPort = Number(cfg.rpcPort);
  if (!Number.isInteger(rpcPort) || rpcPort < 1024 || rpcPort > 65_535)
    return { ok: false, error: "rpcPort: 1024..65535" };

  const p2pPort = Number(cfg.p2pPort);
  if (!Number.isInteger(p2pPort) || p2pPort < 1024 || p2pPort > 65_535)
    return { ok: false, error: "p2pPort: 1024..65535" };
  if (p2pPort === rpcPort)
    return { ok: false, error: "p2pPort and rpcPort must differ" };

  const description = String(cfg.description || "").slice(0, 280);

  return {
    ok: true,
    value: {
      chainName, chainId, symbol, decimals,
      totalSupplyZbx, founderPremineZbx, blockTimeSecs,
      rpcPort, p2pPort, description,
    },
  };
}

function escSh(s: string | number): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// Resolve the canonical public base URL the install.sh should use to fetch
// the Zebvix base source. Prefer an explicit env var (PUBLIC_API_BASE_URL or
// REPLIT_DEV_DOMAIN) over the Host header which can be spoofed via proxies.
function resolveBaseUrl(req: any): string {
  const env = process.env.PUBLIC_API_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  const replitDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (replitDomain) return `https://${replitDomain.replace(/\/+$/, "")}`;
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "http";
  const host = req.get("host") || "localhost";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function genSystemdUnit(c: ChainConfig): string {
  return `[Unit]
Description=${c.chainName} blockchain node — chain ID ${c.chainId} (${c.symbol})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${c.chainName}
Group=${c.chainName}
WorkingDirectory=/var/lib/${c.chainName}
Environment=RUST_LOG=info
ExecStart=/usr/local/bin/${c.chainName}-node start \\
  --home /var/lib/${c.chainName} \\
  --rpc 0.0.0.0:${c.rpcPort} \\
  --p2p-port ${c.p2pPort}
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
StandardOutput=append:/var/log/${c.chainName}/node.log
StandardError=append:/var/log/${c.chainName}/node.err

[Install]
WantedBy=multi-user.target
`;
}

function genInstallSh(c: ChainConfig, baseUrl: string): string {
  const NAME = c.chainName;
  const dl = `${baseUrl}/api/download/newchain`;
  // NOTE: We use sed -E with `|` as the delimiter to avoid escaping `/`.
  // The Rust source uses underscores in numeric literals — we keep them
  // out of the patched values so the grammar stays simple.
  return `#!/usr/bin/env bash
# ${NAME} — one-shot install on Ubuntu/Debian VPS
# Generated by Zebvix Chain Builder
#
# Forks the Zebvix base node into a custom L1:
#   chain ID    ${c.chainId}
#   symbol      ${c.symbol}
#   supply      ${c.totalSupplyZbx} ${c.symbol}
#   pre-mine    ${c.founderPremineZbx} ${c.symbol} (to validator)
#   block time  ${c.blockTimeSecs} s
#   RPC / P2P   ${c.rpcPort} / ${c.p2pPort}
#
# Re-run safely: the script is idempotent for everything except the cargo
# build step (which always rebuilds).

set -euo pipefail

CHAIN_NAME=${escSh(NAME)}
CHAIN_ID=${c.chainId}
SYMBOL=${escSh(c.symbol)}
TOTAL_SUPPLY_ZBX=${c.totalSupplyZbx}
FOUNDER_PREMINE_ZBX=${c.founderPremineZbx}
BLOCK_TIME_SECS=${c.blockTimeSecs}
RPC_PORT=${c.rpcPort}
P2P_PORT=${c.p2pPort}
ZEBVIX_SOURCE_URL=${escSh(dl)}

CFG_DIR="/etc/$CHAIN_NAME"
DATA_DIR="/var/lib/$CHAIN_NAME"
LOG_DIR="/var/log/$CHAIN_NAME"
SRC_DIR="/opt/$CHAIN_NAME-src"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root:  sudo bash install.sh" >&2
  exit 1
fi

step() { echo; echo "==> $*"; }

# 1. ─────────────────────────────────────────────────────────────────────────
step "Installing system dependencies"
apt-get update -y
apt-get install -y --no-install-recommends \\
  curl wget build-essential pkg-config libssl-dev libclang-dev \\
  cmake git ca-certificates jq tar gzip

# 2. ─────────────────────────────────────────────────────────────────────────
step "Creating service user and directories"
if ! id -u "$CHAIN_NAME" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$CHAIN_NAME"
fi
mkdir -p "$CFG_DIR" "$DATA_DIR" "$LOG_DIR" "$SRC_DIR"
chown -R "$CHAIN_NAME":"$CHAIN_NAME" "$DATA_DIR" "$LOG_DIR"

# 3. ─────────────────────────────────────────────────────────────────────────
step "Installing Rust toolchain (if missing)"
if ! command -v cargo >/dev/null 2>&1; then
  if [[ -d /root/.cargo ]]; then
    export PATH="/root/.cargo/bin:$PATH"
  fi
fi
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  export PATH="/root/.cargo/bin:$PATH"
fi

# 4. ─────────────────────────────────────────────────────────────────────────
step "Fetching Zebvix base node source"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
wget -q --show-progress -O chain.tgz "$ZEBVIX_SOURCE_URL"
tar -xzf chain.tgz
# Tarball extracts in-place: ./src, ./Cargo.toml, optional ./scripts.
# Stage it into $SRC_DIR so we don't rebuild from scratch on re-runs.
rm -rf "$SRC_DIR"
mkdir -p "$SRC_DIR"
cp -r ./* "$SRC_DIR"/
cd "$SRC_DIR"

# 5. ─────────────────────────────────────────────────────────────────────────
step "Patching chain parameters into src/tokenomics.rs"
TOK="src/tokenomics.rs"
if [[ ! -f "$TOK" ]]; then
  echo "ERROR: $TOK not found in source tarball" >&2
  exit 1
fi
# Patch the four user-facing constants. Use sed -E with | delimiters.
sed -i -E "s|^pub const CHAIN_ID: u64 = [0-9_]+;|pub const CHAIN_ID: u64 = \${CHAIN_ID};|" "$TOK"
sed -i -E "s|^pub const TOTAL_SUPPLY_ZBX: u128 = [0-9_]+u128;|pub const TOTAL_SUPPLY_ZBX: u128 = \${TOTAL_SUPPLY_ZBX}u128;|" "$TOK"
sed -i -E "s|^pub const FOUNDER_PREMINE_ZBX: u128 = [0-9_]+u128;|pub const FOUNDER_PREMINE_ZBX: u128 = \${FOUNDER_PREMINE_ZBX}u128;|" "$TOK"
sed -i -E "s|^pub const BLOCK_TIME_SECS: u64 = [0-9]+;|pub const BLOCK_TIME_SECS: u64 = \${BLOCK_TIME_SECS};|" "$TOK"
echo "  Patched values:"
grep -E "^pub const (CHAIN_ID|TOTAL_SUPPLY_ZBX|FOUNDER_PREMINE_ZBX|BLOCK_TIME_SECS)" "$TOK"

# 6. ─────────────────────────────────────────────────────────────────────────
step "Building $CHAIN_NAME-node binary (this takes 5-10 minutes on a 4 vCPU VPS)"
cargo build --release --bin zebvix-node
install -m 0755 target/release/zebvix-node /usr/local/bin/"$CHAIN_NAME"-node
echo "  Installed: /usr/local/bin/$CHAIN_NAME-node"
"/usr/local/bin/$CHAIN_NAME-node" --version || true

# 7. ─────────────────────────────────────────────────────────────────────────
step "Generating validator key"
KEYFILE="$CFG_DIR/validator.key"
if [[ ! -f "$KEYFILE" ]]; then
  sudo -u "$CHAIN_NAME" "/usr/local/bin/$CHAIN_NAME-node" keygen --out "$KEYFILE"
  chmod 600 "$KEYFILE"
  chown "$CHAIN_NAME":"$CHAIN_NAME" "$KEYFILE"
  echo "  ✓ New validator key written to $KEYFILE"
else
  echo "  ✓ Re-using existing key at $KEYFILE"
fi

# 8. ─────────────────────────────────────────────────────────────────────────
step "Initializing chain (genesis)"
if [[ ! -d "$DATA_DIR/data" ]]; then
  sudo -u "$CHAIN_NAME" "/usr/local/bin/$CHAIN_NAME-node" init \\
    --home "$DATA_DIR" \\
    --validator-key "$KEYFILE"
  echo "  ✓ Genesis initialized at $DATA_DIR"
else
  echo "  ✓ $DATA_DIR/data already exists — skipping init"
fi

# 9. ─────────────────────────────────────────────────────────────────────────
step "Installing systemd unit"
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
cp "$SCRIPT_DIR/systemd/$CHAIN_NAME-node.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$CHAIN_NAME-node"

# 10. ────────────────────────────────────────────────────────────────────────
step "Opening firewall ports (if ufw is active)"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$RPC_PORT/tcp" || true
  ufw allow "$P2P_PORT/tcp" || true
fi

# 11. ────────────────────────────────────────────────────────────────────────
step "Starting $CHAIN_NAME-node"
systemctl restart "$CHAIN_NAME-node"
sleep 4

# 12. ────────────────────────────────────────────────────────────────────────
step "Health check"
if systemctl is-active --quiet "$CHAIN_NAME-node"; then
  echo "  ✓ Service active"
  IP=$(hostname -I | awk '{print $1}')
  CHAIN_ID_HEX=$(printf '0x%x' "$CHAIN_ID")
  echo
  echo "  Chain name:    $CHAIN_NAME"
  echo "  Chain ID:      $CHAIN_ID  ($CHAIN_ID_HEX)  symbol $SYMBOL"
  echo "  RPC endpoint:  http://$IP:$RPC_PORT"
  echo "  P2P listen:    $IP:$P2P_PORT"
  echo
  echo "  Operate:"
  echo "    sudo systemctl status  $CHAIN_NAME-node"
  echo "    sudo journalctl -u $CHAIN_NAME-node -f"
  echo "    sudo systemctl restart $CHAIN_NAME-node"
  echo
  echo "  Test from your laptop:"
  echo "    curl -s http://$IP:$RPC_PORT \\\\"
  echo "      -H 'content-type: application/json' \\\\"
  echo "      -d '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"eth_chainId\\",\\"params\\":[]}'"
  echo
  echo "  Validator key: $KEYFILE  (KEEP THIS SAFE — your founder/premine wallet)"
  echo
  echo "Done. Your chain is live."
else
  echo "  ✗ Service failed to start. Check:  journalctl -u $CHAIN_NAME-node -n 200"
  exit 1
fi
`;
}

function genReadme(c: ChainConfig, baseUrl: string): string {
  const supplyFmt = c.totalSupplyZbx.toLocaleString("en-US");
  const premineFmt = c.founderPremineZbx.toLocaleString("en-US");
  return `# ${c.chainName.toUpperCase()} Chain — 15-minute Setup

Generated by **Zebvix Chain Builder**.

## Your chain at a glance

| Property         | Value                                     |
|------------------|-------------------------------------------|
| Chain name       | \`${c.chainName}\`                            |
| Chain ID         | \`${c.chainId}\` (\`0x${c.chainId.toString(16)}\`) |
| Symbol           | \`${c.symbol}\`                               |
| Decimals         | ${c.decimals}                                  |
| Total supply     | \`${supplyFmt}\` ${c.symbol}                   |
| Founder pre-mine | \`${premineFmt}\` ${c.symbol} (to validator at genesis) |
| Block time       | ${c.blockTimeSecs} s                           |
| RPC port         | ${c.rpcPort}                                   |
| P2P port         | ${c.p2pPort}                                   |
| Base source      | ${baseUrl}/api/download/newchain               |

## One-command install (Ubuntu 22.04+ / Debian)

\`\`\`bash
tar -xzf ${c.chainName}-setup.tar.gz
cd ${c.chainName}
sudo bash install.sh
\`\`\`

The installer:

1. Installs system deps (curl, build-essential, libssl-dev, libclang-dev, cmake, jq).
2. Installs Rust if missing.
3. Downloads the Zebvix base source from \`${baseUrl}/api/download/newchain\`.
4. Sed-patches \`src/tokenomics.rs\` with **your** chain ID / supply / pre-mine / block time.
5. \`cargo build --release --bin zebvix-node\` and installs \`/usr/local/bin/${c.chainName}-node\`.
6. Creates a dedicated \`${c.chainName}\` system user and FHS directories.
7. Generates a fresh validator key at \`/etc/${c.chainName}/validator.key\`.
8. Runs \`${c.chainName}-node init\` to write genesis at \`/var/lib/${c.chainName}\`.
9. Installs and enables the systemd unit; opens firewall ports if \`ufw\` is active.
10. Starts the service and runs a health check.

> **Time:** ≈ 15 minutes on a 4 vCPU / 8 GB RAM VPS — most of it is the Rust build.

## After install

\`\`\`bash
# Live logs
sudo journalctl -u ${c.chainName}-node -f

# Status
sudo systemctl status ${c.chainName}-node

# Restart
sudo systemctl restart ${c.chainName}-node

# Test RPC
curl -s http://localhost:${c.rpcPort} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# → {"jsonrpc":"2.0","id":1,"result":"0x${c.chainId.toString(16)}"}
\`\`\`

## File layout (after install)

\`\`\`
/usr/local/bin/${c.chainName}-node     binary (built from patched source)
/etc/${c.chainName}/validator.key      founder / validator key — KEEP SAFE
/var/lib/${c.chainName}/data           chain data (RocksDB)
/var/log/${c.chainName}/               journald-style log files
/etc/systemd/system/${c.chainName}-node.service
\`\`\`

## What's pre-mined

Because you set founder pre-mine to **${premineFmt} ${c.symbol}**, the
validator address (auto-generated during install) holds that balance at
block 0. Use \`${c.chainName}-node send\` to airdrop from this address to a
faucet, exchange, or end users:

\`\`\`bash
sudo -u ${c.chainName} ${c.chainName}-node send \\
  --from-key /etc/${c.chainName}/validator.key \\
  --to 0xYOUR_FAUCET_ADDRESS \\
  --amount 100000   # ${c.symbol}
\`\`\`

## License

MIT — your chain, your rules.
`;
}

chainBuilderRouter.post("/chain-builder/generate", async (req, res) => {
  const v = validate(req.body);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  const cfg = v.value;
  const baseUrl = resolveBaseUrl(req);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `chainbuild-${cfg.chainName}-`));
  const root = path.join(tmp, cfg.chainName);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "systemd"));

  try {
    fs.writeFileSync(path.join(root, "README.md"), genReadme(cfg, baseUrl));
    fs.writeFileSync(
      path.join(root, "systemd", `${cfg.chainName}-node.service`),
      genSystemdUnit(cfg),
    );
    const installPath = path.join(root, "install.sh");
    fs.writeFileSync(installPath, genInstallSh(cfg, baseUrl));
    fs.chmodSync(installPath, 0o755);

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${cfg.chainName}-setup.tar.gz"`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Chain-Name", cfg.chainName);
    res.setHeader("X-Chain-Id", String(cfg.chainId));

    const tar = spawn(
      "tar",
      ["-czf", "-", "-C", tmp, cfg.chainName],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    tar.stdout.pipe(res);
    tar.stderr.on("data", (d) => console.error("[chainbuild tar]", d.toString()));
    tar.on("error", (e) => {
      console.error("[chainbuild spawn]", e);
      if (!res.headersSent) res.status(500).end();
    });
    tar.on("exit", (code) => {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      if (code !== 0 && !res.writableEnded) res.end();
    });
  } catch (err: any) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (!res.headersSent) res.status(500).json({ error: String(err?.message || err) });
  }
});

chainBuilderRouter.post("/chain-builder/preview", (req, res) => {
  const v = validate(req.body);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  const cfg = v.value;
  const baseUrl = resolveBaseUrl(req);

  const install = genInstallSh(cfg, baseUrl);
  const readme = genReadme(cfg, baseUrl);
  const systemd = genSystemdUnit(cfg);

  const installHash = crypto.createHash("sha256").update(install).digest("hex");

  res.json({
    config: cfg,
    baseUrl,
    files: {
      "install.sh": install,
      "README.md": readme,
      [`systemd/${cfg.chainName}-node.service`]: systemd,
    },
    summary: {
      installHash,
      totalBytes: install.length + readme.length + systemd.length,
      estimatedBuildMinutes: 12,
    },
  });
});

export default chainBuilderRouter;
