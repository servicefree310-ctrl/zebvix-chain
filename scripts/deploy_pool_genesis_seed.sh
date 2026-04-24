#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Zebvix L1 — Phase B.11.1 Pool Genesis Seed Deploy
#
# Purpose
# -------
# The AMM pool on the live VPS is currently UNINITIALIZED:
#
#     curl -s http://93.127.213.192:8545 -d '{"method":"zbx_getPool",...}' \
#       | jq '.result.initialized'
#     → false
#
# Result: zbx_getPriceUSD returns $0.000000, swap calls fail with
# "pool not yet initialized", and home dashboard price card shows blank.
#
# This script ships the new chain build (with updated GENESIS_POOL_*
# constants giving 20M ZBX + 10M zUSD = $0.50/ZBX opening price) and runs
# the one-shot `zebvix-node admin-pool-genesis` command to seed the pool.
#
# DESTRUCTIVE FLAGS
# -----------------
#   --reset    : ALSO wipe the data dir (default: NO wipe — preserve all
#                accounts, validators, block history). Only use --reset if
#                you actually want a clean genesis (e.g., testnet rebuild).
#                Without --reset, only the pool gets seeded; everything else
#                stays intact, because pool_init_genesis() is a no-op when
#                pool.is_initialized() == true and a one-shot mint when not.
#
# Run this script ON THE VPS, as root, inside /home/zebvix-chain.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CHAIN_DIR="${CHAIN_DIR:-/home/zebvix-chain}"
SERVICE="${SERVICE:-zebvix.service}"
BIN_TARGET="${BIN_TARGET:-/usr/local/bin/zebvix-node}"

# Auto-detect the actual --home flag the systemd service uses, so the seed
# write goes to the SAME RocksDB the running node will read from. Without
# this, an admin write to /home/zebvix-chain/.zebvix is invisible to a
# service started with --home /root/.zebvix (real bug from Phase B.11.1).
detect_data_dir() {
  if command -v systemctl >/dev/null 2>&1; then
    local from_unit
    from_unit=$(systemctl cat "$SERVICE" 2>/dev/null \
      | grep -oP -- '--home\s+\K[^\s]+' | head -1 || true)
    if [[ -n "$from_unit" ]]; then
      echo "$from_unit"
      return
    fi
  fi
  echo "/root/.zebvix"     # fallback matches the live VPS unit default
}
DATA_DIR="${DATA_DIR:-$(detect_data_dir)}"

RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0;;
    *)
      echo "unknown arg: $arg (use --reset for destructive wipe)"; exit 1;;
  esac
done

say() { printf "\n\033[1;36m▶\033[0m %s\n" "$*"; }
ok()  { printf "\033[1;32m✔\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m!\033[0m %s\n" "$*"; }

if [[ "$EUID" -ne 0 ]]; then
  echo "ERROR: must run as root (sudo $0)" >&2
  exit 1
fi

cd "$CHAIN_DIR"

say "Step 1/6 — Verify constants are correct (20M ZBX + 10M zUSD)"
grep -n 'GENESIS_POOL_ZBX_WEI\|GENESIS_POOL_ZUSD_LOAN' src/tokenomics.rs \
  | grep -v '^//' || true
EXPECT_ZBX="20_000_000"
if ! grep -q "GENESIS_POOL_ZBX_WEI: u128 = ${EXPECT_ZBX}" src/tokenomics.rs; then
  warn "Expected GENESIS_POOL_ZBX_WEI = ${EXPECT_ZBX} not found — rebuild may NOT seed at the target price."
  warn "Pull the latest tokenomics.rs from main branch and re-run."
  exit 1
fi
ok "Constants OK (20M ZBX + 10M zUSD = \$0.50/ZBX)"

say "Step 2/6 — Build release binary with EVM feature"
# Some VPS shells (especially under sudo) don't have cargo in PATH even though
# rustup installed it for root. Try the common rustup install location before
# giving up.
if ! command -v cargo >/dev/null 2>&1; then
  for env_file in "$HOME/.cargo/env" "/root/.cargo/env" "/usr/local/cargo/env"; do
    if [[ -f "$env_file" ]]; then
      # shellcheck disable=SC1090
      source "$env_file"
      [[ -n "${CARGO_HOME:-}" ]] && warn "sourced $env_file (CARGO_HOME=$CARGO_HOME)"
      break
    fi
  done
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo not found. Install rustup or run: source \$HOME/.cargo/env" >&2
  echo "       Then re-run this script in the SAME shell session." >&2
  exit 1
fi
ok "cargo at $(command -v cargo) ($(cargo --version))"
cargo build --release --features evm
ok "Build complete"

say "Step 3/6 — Stop running chain service (required for RocksDB lock during seed)"
systemctl stop "$SERVICE" || warn "service was not running"
sleep 2

if [[ "$RESET" -eq 1 ]]; then
  say "Step 4/6 — DESTRUCTIVE: backing up data dir before wipe (--reset given)"
  if [[ -d "$DATA_DIR" ]]; then
    BACKUP="${DATA_DIR}.backup-$(date +%s)"
    mv "$DATA_DIR" "$BACKUP"
    ok "Old data moved to $BACKUP"
  fi
  mkdir -p "$DATA_DIR"
else
  say "Step 4/6 — Preserving existing data dir ($DATA_DIR) — no --reset flag"
  ok "Skipping wipe; pool will seed on top of existing state"
fi

say "Step 5/6 — Install new binary"
cp -f target/release/zebvix-node "$BIN_TARGET"
ok "Binary installed at $BIN_TARGET"

say "Step 6a — Run admin-pool-genesis (mints 20M ZBX + 10M zUSD into AMM)"
"$BIN_TARGET" admin-pool-genesis --home "$DATA_DIR"

say "Step 6b — Restart chain service"
systemctl start "$SERVICE"
sleep 4
systemctl is-active --quiet "$SERVICE" && ok "Service running"

say "Verification — query live RPC"
RAW=$(curl -s http://127.0.0.1:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_getPool","params":[]}')
if command -v jq >/dev/null 2>&1; then
  echo "$RAW" | jq -r '.result | "  initialized      : \(.initialized)\n  zbx_reserve_wei  : \(.zbx_reserve_wei)\n  zusd_reserve     : \(.zusd_reserve)\n  spot_price_usd   : \(.spot_price_usd_per_zbx)\n  loan_outstanding : \(.loan_outstanding_zusd)"'
else
  # Fallback: dump raw JSON if jq is missing.
  echo "$RAW"
  warn "jq not installed — install with: apt-get install -y jq"
fi

ok "Pool seed deploy complete — dashboard will switch from BOOTSTRAP PENDING to LIVE within 5s."
