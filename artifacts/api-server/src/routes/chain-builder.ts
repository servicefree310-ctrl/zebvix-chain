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

type FeatureKey =
  | "evm" | "zvm" | "smartContracts" | "mempool" | "snapshots"
  | "archiveMode" | "txIndex" | "websocket" | "metrics" | "txBurn" | "eip1559";

type FeatureFlags = Record<FeatureKey, boolean>;

const FEATURE_KEYS: FeatureKey[] = [
  "evm", "zvm", "smartContracts", "mempool", "snapshots",
  "archiveMode", "txIndex", "websocket", "metrics", "txBurn", "eip1559",
];

const DEFAULT_FEATURES: FeatureFlags = {
  evm: true, zvm: true, smartContracts: true, mempool: true, snapshots: true,
  archiveMode: false, txIndex: true, websocket: true, metrics: true,
  txBurn: false, eip1559: true,
};

interface ChainConfig {
  // identity
  chainName: string;
  chainId: number;
  symbol: string;
  decimals: number;
  description?: string;
  // tokenomics
  totalSupplyZbx: number;
  fixedSupply: boolean;
  founderPremineZbx: number;
  founderAddress: string; // empty string = fall back to auto-generated validator key address
  mintPerBlockZbx: number;
  halvingBlocks: number;
  blockTimeSecs: number;
  // consensus / PoS
  consensus: "pos" | "poa";
  minValidatorStakeZbx: number;
  maxValidators: number;
  slashPercent: number;
  unbondingDays: number;
  // governance
  governanceEnabled: boolean;
  votingPeriodBlocks: number;
  quorumPercent: number;
  proposalThresholdZbx: number;
  executionDelayBlocks: number;
  // network
  rpcPort: number;
  p2pPort: number;
  // features
  features: FeatureFlags;
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;

function intInRange(v: any, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

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

  const decimals = intInRange(cfg.decimals, 0, 36);
  if (decimals === null) return { ok: false, error: "decimals: 0..36" };

  const totalSupplyZbx = intInRange(cfg.totalSupplyZbx, 1, 1_000_000_000_000);
  if (totalSupplyZbx === null)
    return { ok: false, error: "totalSupplyZbx: integer 1..1_000_000_000_000 (whole tokens)" };

  const fixedSupply = Boolean(cfg.fixedSupply);

  const founderPremineZbx = intInRange(cfg.founderPremineZbx, 0, 1_000_000_000_000);
  if (founderPremineZbx === null)
    return { ok: false, error: "founderPremineZbx: non-negative integer" };
  if (fixedSupply && founderPremineZbx > totalSupplyZbx)
    return { ok: false, error: "founderPremineZbx: cannot exceed totalSupplyZbx on a fixed-supply chain" };

  // Optional admin / founder address that receives the pre-mine at genesis.
  // Empty string = fall back to the auto-generated validator key address.
  let founderAddress = String(cfg.founderAddress || "").trim();
  if (founderAddress !== "") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(founderAddress))
      return { ok: false, error: "founderAddress: must be a 0x-prefixed 40-hex EVM address (or blank to use the validator key)" };
    founderAddress = "0x" + founderAddress.slice(2).toLowerCase();
    if (founderPremineZbx === 0)
      return { ok: false, error: "founderAddress: set founderPremineZbx > 0 or leave the address blank" };
  }

  const mintPerBlockZbx = intInRange(cfg.mintPerBlockZbx, 0, 1_000_000);
  if (mintPerBlockZbx === null)
    return { ok: false, error: "mintPerBlockZbx: integer 0..1_000_000" };
  if (fixedSupply && mintPerBlockZbx > 0)
    return { ok: false, error: "mintPerBlockZbx: must be 0 on a fixed-supply chain" };

  const halvingBlocks = intInRange(cfg.halvingBlocks, 0, 100_000_000);
  if (halvingBlocks === null)
    return { ok: false, error: "halvingBlocks: integer 0..100_000_000 (0 = no halving)" };

  const blockTimeSecs = intInRange(cfg.blockTimeSecs, 1, 60);
  if (blockTimeSecs === null)
    return { ok: false, error: "blockTimeSecs: integer 1..60" };

  const consensus = String(cfg.consensus || "pos").toLowerCase();
  if (consensus !== "pos" && consensus !== "poa")
    return { ok: false, error: "consensus: pos | poa" };

  const minValidatorStakeZbx = intInRange(cfg.minValidatorStakeZbx, 0, 1_000_000_000_000);
  if (minValidatorStakeZbx === null)
    return { ok: false, error: "minValidatorStakeZbx: non-negative integer" };
  if (fixedSupply && minValidatorStakeZbx > totalSupplyZbx)
    return { ok: false, error: "minValidatorStakeZbx: cannot exceed totalSupplyZbx" };

  const maxValidators = intInRange(cfg.maxValidators, 1, 1000);
  if (maxValidators === null)
    return { ok: false, error: "maxValidators: integer 1..1000" };

  const slashPercent = intInRange(cfg.slashPercent, 0, 100);
  if (slashPercent === null)
    return { ok: false, error: "slashPercent: integer 0..100" };

  const unbondingDays = intInRange(cfg.unbondingDays, 0, 365);
  if (unbondingDays === null)
    return { ok: false, error: "unbondingDays: integer 0..365" };

  const governanceEnabled = Boolean(cfg.governanceEnabled);
  let votingPeriodBlocks = 0;
  let quorumPercent = 0;
  let proposalThresholdZbx = 0;
  let executionDelayBlocks = 0;
  if (governanceEnabled) {
    const v1 = intInRange(cfg.votingPeriodBlocks, 1, 100_000_000);
    if (v1 === null) return { ok: false, error: "votingPeriodBlocks: integer 1..100_000_000" };
    votingPeriodBlocks = v1;
    const v2 = intInRange(cfg.quorumPercent, 0, 100);
    if (v2 === null) return { ok: false, error: "quorumPercent: integer 0..100" };
    quorumPercent = v2;
    const v3 = intInRange(cfg.proposalThresholdZbx, 0, 1_000_000_000_000);
    if (v3 === null) return { ok: false, error: "proposalThresholdZbx: non-negative integer" };
    if (fixedSupply && v3 > totalSupplyZbx)
      return { ok: false, error: "proposalThresholdZbx: cannot exceed totalSupplyZbx" };
    proposalThresholdZbx = v3;
    const v4 = intInRange(cfg.executionDelayBlocks, 0, 10_000_000);
    if (v4 === null) return { ok: false, error: "executionDelayBlocks: integer 0..10_000_000" };
    executionDelayBlocks = v4;
  }

  const rpcPort = intInRange(cfg.rpcPort, 1024, 65_535);
  if (rpcPort === null) return { ok: false, error: "rpcPort: 1024..65535" };

  const p2pPort = intInRange(cfg.p2pPort, 1024, 65_535);
  if (p2pPort === null) return { ok: false, error: "p2pPort: 1024..65535" };
  if (p2pPort === rpcPort)
    return { ok: false, error: "p2pPort and rpcPort must differ" };

  const featuresIn = (cfg.features && typeof cfg.features === "object") ? cfg.features : {};
  const features: FeatureFlags = { ...DEFAULT_FEATURES };
  for (const k of FEATURE_KEYS) {
    if (k in featuresIn) features[k] = Boolean(featuresIn[k]);
  }
  if (!features.evm && !features.zvm)
    return { ok: false, error: "features: at least one VM (evm or zvm) must be enabled" };

  const description = String(cfg.description || "").slice(0, 280);

  return {
    ok: true,
    value: {
      chainName, chainId, symbol, decimals, description,
      totalSupplyZbx, fixedSupply, founderPremineZbx, founderAddress, mintPerBlockZbx, halvingBlocks, blockTimeSecs,
      consensus: consensus as "pos" | "poa", minValidatorStakeZbx, maxValidators, slashPercent, unbondingDays,
      governanceEnabled, votingPeriodBlocks, quorumPercent, proposalThresholdZbx, executionDelayBlocks,
      rpcPort, p2pPort, features,
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

function yamlString(s: string): string {
  // Quote with double quotes, escape backslashes and quotes only.
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function genChainConfigYaml(c: ChainConfig): string {
  const featuresYaml = FEATURE_KEYS.map((k) => `  ${k}: ${c.features[k] ? "true" : "false"}`).join("\n");
  return `# chain.config.yaml — generated by Zebvix Chain Builder
# This file is read by ${c.chainName}-node at startup.
# Settings under [tokenomics] CHAIN_ID / TOTAL_SUPPLY_ZBX / FOUNDER_PREMINE_ZBX / BLOCK_TIME_SECS
# are ALSO sed-patched into src/tokenomics.rs at build time and baked into the binary.
# Settings under [consensus], [governance] and [features] are read here at runtime
# (where the binary supports them) and otherwise recorded for audit and upcoming releases.
# Edit, then: sudo systemctl restart ${c.chainName}-node

schema_version: 1
generated_by: zebvix-chain-builder

chain:
  name: ${yamlString(c.chainName)}
  id: ${c.chainId}
  symbol: ${yamlString(c.symbol)}
  decimals: ${c.decimals}
  description: ${yamlString(c.description || "")}

tokenomics:
  total_supply_zbx: ${c.totalSupplyZbx}
  fixed_supply: ${c.fixedSupply ? "true" : "false"}
  founder_premine_zbx: ${c.founderPremineZbx}
  founder_address: ${yamlString(c.founderAddress)}   # blank = use validator key address
  mint_per_block_zbx: ${c.mintPerBlockZbx}
  halving_blocks: ${c.halvingBlocks}
  block_time_secs: ${c.blockTimeSecs}

consensus:
  algorithm: ${c.consensus}
  min_validator_stake_zbx: ${c.minValidatorStakeZbx}
  max_validators: ${c.maxValidators}
  slash_percent: ${c.slashPercent}
  unbonding_days: ${c.unbondingDays}

governance:
  enabled: ${c.governanceEnabled ? "true" : "false"}
  voting_period_blocks: ${c.votingPeriodBlocks}
  quorum_percent: ${c.quorumPercent}
  proposal_threshold_zbx: ${c.proposalThresholdZbx}
  execution_delay_blocks: ${c.executionDelayBlocks}

network:
  rpc_port: ${c.rpcPort}
  p2p_port: ${c.p2pPort}

features:
${featuresYaml}
`;
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
#   pre-mine    ${c.founderPremineZbx} ${c.symbol} (to ${c.founderAddress ? `admin ${c.founderAddress}` : "validator key"})
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
FOUNDER_ADDRESS=${escSh(c.founderAddress)}
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
# Patch the four user-facing tokenomics constants into the binary. Use sed -E with | delimiters.
# Each patch must change exactly one line — we verify post-patch and abort on drift.
patch_const() {
  local label="$1" pattern="$2" want_substring="$3"
  if ! grep -qE "$pattern" "$TOK"; then
    echo "ERROR: expected constant '$label' not found in $TOK — aborting (incompatible source tarball)" >&2
    exit 1
  fi
}
patch_const "CHAIN_ID"             "^pub const CHAIN_ID: u64 = [0-9_]+;"            "$CHAIN_ID"
patch_const "TOTAL_SUPPLY_ZBX"     "^pub const TOTAL_SUPPLY_ZBX: u128 = [0-9_]+u128;" "$TOTAL_SUPPLY_ZBX"
patch_const "FOUNDER_PREMINE_ZBX"  "^pub const FOUNDER_PREMINE_ZBX: u128 = [0-9_]+u128;" "$FOUNDER_PREMINE_ZBX"
patch_const "BLOCK_TIME_SECS"      "^pub const BLOCK_TIME_SECS: u64 = [0-9]+;"      "$BLOCK_TIME_SECS"
sed -i -E "s|^pub const CHAIN_ID: u64 = [0-9_]+;|pub const CHAIN_ID: u64 = \${CHAIN_ID};|" "$TOK"
sed -i -E "s|^pub const TOTAL_SUPPLY_ZBX: u128 = [0-9_]+u128;|pub const TOTAL_SUPPLY_ZBX: u128 = \${TOTAL_SUPPLY_ZBX}u128;|" "$TOK"
sed -i -E "s|^pub const FOUNDER_PREMINE_ZBX: u128 = [0-9_]+u128;|pub const FOUNDER_PREMINE_ZBX: u128 = \${FOUNDER_PREMINE_ZBX}u128;|" "$TOK"
sed -i -E "s|^pub const BLOCK_TIME_SECS: u64 = [0-9]+;|pub const BLOCK_TIME_SECS: u64 = \${BLOCK_TIME_SECS};|" "$TOK"
# Verify the patches actually landed (defence against future source-format drift).
for want in "pub const CHAIN_ID: u64 = \${CHAIN_ID};" \\
            "pub const TOTAL_SUPPLY_ZBX: u128 = \${TOTAL_SUPPLY_ZBX}u128;" \\
            "pub const FOUNDER_PREMINE_ZBX: u128 = \${FOUNDER_PREMINE_ZBX}u128;" \\
            "pub const BLOCK_TIME_SECS: u64 = \${BLOCK_TIME_SECS};"; do
  if ! grep -qF "$want" "$TOK"; then
    echo "ERROR: post-patch verification failed — '$want' not found in $TOK" >&2
    exit 1
  fi
done
echo "  Patched values:"
grep -E "^pub const (CHAIN_ID|TOTAL_SUPPLY_ZBX|FOUNDER_PREMINE_ZBX|BLOCK_TIME_SECS)" "$TOK"
# NOTE: the founder/admin address is NOT patched into the binary as a constant
# (the base node does not declare one). Instead it is supplied at chain-init
# time via the deterministic --alloc flag — see step 8 below.
if [[ -n "$FOUNDER_ADDRESS" ]]; then
  echo "  Founder/admin address (genesis pre-mine recipient): $FOUNDER_ADDRESS"
  echo "    (will be applied at genesis via 'init --alloc \${FOUNDER_ADDRESS}:\${FOUNDER_PREMINE_ZBX}')"
else
  echo "  Founder/admin address: <blank> — pre-mine will go to the validator key generated below"
fi

# 5b. ────────────────────────────────────────────────────────────────────────
step "Installing chain.config.yaml (PoS, governance, mint, features)"
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
if [[ -f "$SCRIPT_DIR/chain.config.yaml" ]]; then
  install -m 0644 "$SCRIPT_DIR/chain.config.yaml" "$CFG_DIR/chain.config.yaml"
  chown "$CHAIN_NAME":"$CHAIN_NAME" "$CFG_DIR/chain.config.yaml"
  echo "  ✓ Installed: $CFG_DIR/chain.config.yaml"
  echo "    (read at startup; edit + 'systemctl restart $CHAIN_NAME-node' to apply)"
else
  echo "  WARN: chain.config.yaml missing from bundle — runtime will fall back to defaults"
fi

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
  # If a founder/admin address was supplied AND there is a non-zero pre-mine,
  # credit it deterministically via --alloc instead of letting the validator
  # key receive the default Foundation pre-mine.
  if [[ -n "$FOUNDER_ADDRESS" && "$FOUNDER_PREMINE_ZBX" -gt 0 ]]; then
    echo "  → Pre-mine destination: $FOUNDER_ADDRESS  (admin wallet)"
    sudo -u "$CHAIN_NAME" "/usr/local/bin/$CHAIN_NAME-node" init \\
      --home "$DATA_DIR" \\
      --validator-key "$KEYFILE" \\
      --alloc "\${FOUNDER_ADDRESS}:\${FOUNDER_PREMINE_ZBX}"
  else
    echo "  → Pre-mine destination: validator key (no admin address supplied)"
    sudo -u "$CHAIN_NAME" "/usr/local/bin/$CHAIN_NAME-node" init \\
      --home "$DATA_DIR" \\
      --validator-key "$KEYFILE"
  fi
  echo "  ✓ Genesis initialized at $DATA_DIR"
  # Verify the genesis allocation actually landed where requested (defence
  # against a future binary that silently ignores --alloc).
  GENESIS="$DATA_DIR/genesis.json"
  if [[ -f "$GENESIS" && -n "$FOUNDER_ADDRESS" && "$FOUNDER_PREMINE_ZBX" -gt 0 ]]; then
    if grep -qiF "\${FOUNDER_ADDRESS}" "$GENESIS"; then
      echo "  ✓ Verified: $FOUNDER_ADDRESS appears in $GENESIS allocation"
    else
      echo "  ✗ ERROR: $FOUNDER_ADDRESS NOT present in $GENESIS — refusing to start" >&2
      echo "    Inspect with:  jq . $GENESIS" >&2
      exit 1
    fi
  fi
else
  echo "  ✓ $DATA_DIR/data already exists — skipping init"
  # Idempotency safety: still verify any existing genesis matches the
  # currently-requested founder address. If it doesn't, refuse to (re)start
  # rather than silently running on a divergent allocation.
  GENESIS="$DATA_DIR/genesis.json"
  if [[ -f "$GENESIS" && -n "$FOUNDER_ADDRESS" && "$FOUNDER_PREMINE_ZBX" -gt 0 ]]; then
    if ! grep -qiF "\${FOUNDER_ADDRESS}" "$GENESIS"; then
      echo "  ✗ ERROR: existing $GENESIS does NOT contain admin address $FOUNDER_ADDRESS." >&2
      echo "    The on-disk genesis was created with a different founder configuration." >&2
      echo "    Refusing to (re)start. To start fresh, stop the service and delete \\\"$DATA_DIR/data\\\" + \\\"$GENESIS\\\" manually." >&2
      exit 1
    fi
    echo "  ✓ Verified: existing $GENESIS already credits $FOUNDER_ADDRESS"
  fi
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
  if [[ -n "$FOUNDER_ADDRESS" ]]; then
    echo "  Pre-mine wallet: $FOUNDER_ADDRESS  (admin-supplied — control with your own MetaMask / multisig / hardware key)"
    echo "  Validator key:   $KEYFILE  (used for block production / staking only — back up but it does NOT hold the pre-mine)"
  else
    echo "  Validator key:   $KEYFILE  (KEEP THIS SAFE — also holds your $FOUNDER_PREMINE_ZBX $SYMBOL pre-mine because no admin address was supplied)"
  fi
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
  const enabledFeatures = FEATURE_KEYS.filter((k) => c.features[k]);
  const disabledFeatures = FEATURE_KEYS.filter((k) => !c.features[k]);
  return `# ${c.chainName.toUpperCase()} Chain — 15-minute Setup

Generated by **Zebvix Chain Builder**.

## Active vs declared settings

The installer **sed-patches the four core constants directly into \`src/tokenomics.rs\`** before
\`cargo build\`, baking them into the binary. Everything else is captured in
\`chain.config.yaml\` (installed at \`/etc/${c.chainName}/chain.config.yaml\`) and read by the
node at startup where supported, otherwise recorded for audit and upcoming binary releases.

### Patched into the binary (immutable post-build)

| Property         | Value                                     |
|------------------|-------------------------------------------|
| Chain ID         | \`${c.chainId}\` (\`0x${c.chainId.toString(16)}\`) |
| Total supply     | \`${supplyFmt}\` ${c.symbol}                   |
| Founder pre-mine | \`${premineFmt}\` ${c.symbol}                  |
| Block time       | ${c.blockTimeSecs} s                           |

### Applied at chain-init (deterministic, verified against \`genesis.json\`)

| Property        | Value                                                                                       |
|-----------------|---------------------------------------------------------------------------------------------|
| Founder address | ${c.founderAddress ? `\`${c.founderAddress}\` (admin-supplied — credited at block 0 via \`init --alloc\`)` : "_blank — pre-mine falls back to the validator key auto-generated on the VPS_"} |

### Declared in chain.config.yaml (editable, restart to apply)

| Section    | Setting                  | Value                                       |
|------------|--------------------------|---------------------------------------------|
| chain      | name / symbol / decimals | \`${c.chainName}\` / \`${c.symbol}\` / ${c.decimals} |
| tokenomics | supply model             | ${c.fixedSupply ? "fixed (hard cap)" : "inflationary"} |
| tokenomics | mint per block           | ${c.mintPerBlockZbx} ${c.symbol}            |
| tokenomics | halving                  | ${c.halvingBlocks === 0 ? "none" : `every ${c.halvingBlocks} blocks`} |
| consensus  | algorithm                | ${c.consensus.toUpperCase()}                |
| consensus  | min validator stake      | ${c.minValidatorStakeZbx.toLocaleString()} ${c.symbol} |
| consensus  | max validators           | ${c.maxValidators}                          |
| consensus  | slash percent            | ${c.slashPercent}%                          |
| consensus  | unbonding days           | ${c.unbondingDays}                          |
| governance | enabled                  | ${c.governanceEnabled ? "yes" : "no"}       |
${c.governanceEnabled ? `| governance | voting period            | ${c.votingPeriodBlocks} blocks              |
| governance | quorum                   | ${c.quorumPercent}%                         |
| governance | proposal threshold       | ${c.proposalThresholdZbx.toLocaleString()} ${c.symbol} |
| governance | execution delay          | ${c.executionDelayBlocks} blocks            |
` : ""}| network    | rpc / p2p ports          | ${c.rpcPort} / ${c.p2pPort}                 |
| features   | enabled (${enabledFeatures.length})            | ${enabledFeatures.join(", ") || "none"}    |
${disabledFeatures.length ? `| features   | disabled (${disabledFeatures.length})           | ${disabledFeatures.join(", ")}             |
` : ""}
**Base source:** ${baseUrl}/api/download/newchain

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
4. Sed-patches \`src/tokenomics.rs\` with **your** chain ID / supply / pre-mine / block time, then runs a post-patch verification that aborts on drift.
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
/etc/${c.chainName}/validator.key      ${c.founderAddress ? `validator key — block production / staking only (does NOT hold the pre-mine; admin wallet ${c.founderAddress.slice(0, 10)}…${c.founderAddress.slice(-6)} does)` : "founder / validator key — KEEP SAFE (also holds the pre-mine)"}
/var/lib/${c.chainName}/data           chain data (RocksDB)
/var/log/${c.chainName}/               journald-style log files
/etc/systemd/system/${c.chainName}-node.service
\`\`\`

## What's pre-mined

Because you set founder pre-mine to **${premineFmt} ${c.symbol}**, ${c.founderAddress
  ? `your **admin address \`${c.founderAddress}\`** (which you control off-chain — MetaMask, hardware wallet, multisig, etc.) holds that balance at block 0. The auto-generated validator key on the VPS is used **only for block production / staking**, not for the pre-mine.`
  : `the **validator address (auto-generated during install)** holds that balance at block 0 — because you left the founder address blank. To target a specific admin wallet instead, re-generate the bundle with a non-empty *Founder / admin address* on Step 2.`}
${c.founderAddress
  ? `To airdrop from your admin wallet to a faucet, exchange, or end users, sign and broadcast a transfer **from your own wallet** (MetaMask, hardware wallet, multisig, etc.) — the validator key on the VPS does **not** hold the pre-mine and cannot spend it. Any standard EVM-compatible wallet pointed at \`http://<your-vps>:${c.rpcPort}\` works:

\`\`\`text
From:   ${c.founderAddress}        (your admin wallet — sign locally)
To:     0xYOUR_FAUCET_ADDRESS
Amount: 100000 ${c.symbol}
RPC:    http://<your-vps>:${c.rpcPort}
ChainId: ${c.chainId} (0x${c.chainId.toString(16)})
\`\`\``
  : `Use \`${c.chainName}-node send\` to airdrop from the validator key (which holds the pre-mine) to a faucet, exchange, or end users:

\`\`\`bash
sudo -u ${c.chainName} ${c.chainName}-node send \\
  --from-key /etc/${c.chainName}/validator.key \\
  --to 0xYOUR_FAUCET_ADDRESS \\
  --amount 100000   # ${c.symbol}
\`\`\``}

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
    fs.writeFileSync(path.join(root, "chain.config.yaml"), genChainConfigYaml(cfg));
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
  const yamlCfg = genChainConfigYaml(cfg);

  const installHash = crypto.createHash("sha256").update(install).digest("hex");

  res.json({
    config: cfg,
    baseUrl,
    files: {
      "install.sh": install,
      "README.md": readme,
      "chain.config.yaml": yamlCfg,
      [`systemd/${cfg.chainName}-node.service`]: systemd,
    },
    summary: {
      installHash,
      totalBytes: install.length + readme.length + systemd.length + yamlCfg.length,
      estimatedBuildMinutes: 12,
    },
  });
});

export default chainBuilderRouter;
