#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Zebvix Chain — Supply RPC Patch Installer  (v0.1)
# ─────────────────────────────────────────────────────────────────────────────
#  Adds premine_wei, burned_wei, circulating_wei fields to the zbx_supply RPC.
#  Run on each Zebvix VPS node:
#
#    curl -fsSL https://7f6c353a-ec2a-4fe7-81e1-631c9fb77a3e-00-1a0ca41r86kcx.worf.replit.dev/api/downloads/install-zbx-supply-v0.1.sh | sudo bash
#
#  Override defaults via env vars:
#    CHAIN_DIR=/home/zebvix-chain    (path to chain repo)
#    NODE_SVCS="zebvix-node-1 zebvix-node-2"   (systemd unit names)
#    BASE_URL=https://...            (download host)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${BASE_URL:-https://7f6c353a-ec2a-4fe7-81e1-631c9fb77a3e-00-1a0ca41r86kcx.worf.replit.dev/api/downloads}"
TARBALL_URL="$BASE_URL/zbx-supply-fix.tar.gz"
CHAIN_DIR="${CHAIN_DIR:-/home/zebvix-chain}"
NODE_SVCS_STR="${NODE_SVCS:-zebvix-node-1 zebvix-node-2}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8080}"
WORKDIR="${WORKDIR:-/tmp/zbx-supply-install}"

read -r -a NODE_SVCS <<<"$NODE_SVCS_STR"

cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

cyan "==> Zebvix supply-RPC patch installer"
echo  "    chain dir : $CHAIN_DIR"
echo  "    services  : ${NODE_SVCS[*]}"
echo  "    download  : $TARBALL_URL"
echo

if [[ ! -d "$CHAIN_DIR" ]]; then
  red "ERROR: chain dir $CHAIN_DIR not found. Pass CHAIN_DIR=/your/path."
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  red "ERROR: cargo not found. Install Rust first:"
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
  echo "  source \$HOME/.cargo/env"
  exit 1
fi

cyan "==> 1/6  Downloading patch bundle"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"
curl -fsSL -o zbx-supply-fix.tar.gz "$TARBALL_URL"

# Sanity: must be gzip, not HTML
if ! file zbx-supply-fix.tar.gz | grep -q gzip; then
  red "ERROR: download is not a gzip archive. Server may have returned HTML."
  echo "First bytes:"
  head -c 200 zbx-supply-fix.tar.gz; echo
  exit 1
fi

cyan "==> 2/6  Extracting"
tar -xzf zbx-supply-fix.tar.gz
cd zbx-supply-fix

cyan "==> 3/6  Backing up old rpc.rs"
RPC_FILE="$CHAIN_DIR/src/rpc.rs"
cp -v "$RPC_FILE" "$RPC_FILE.bak.$(date +%s)"

cyan "==> 4/6  Installing patched rpc.rs and rebuilding (~3-5 min)"
cp -v rpc.rs "$RPC_FILE"
cd "$CHAIN_DIR"
cargo build --release --bin zebvix-node

BIN_OUT="$CHAIN_DIR/target/release/zebvix-node"
[[ -x "$BIN_OUT" ]] || { red "ERROR: build did not produce $BIN_OUT"; exit 1; }

cyan "==> 5/6  Installing binary + restarting nodes"
install -m 0755 "$BIN_OUT" /usr/local/bin/zebvix-node
for svc in "${NODE_SVCS[@]}"; do
  if systemctl list-unit-files | grep -q "^$svc"; then
    echo "    restarting $svc"
    systemctl restart "$svc"
  else
    echo "    (skip: $svc is not a systemd unit on this host)"
  fi
done

cyan "==> 6/6  Verifying new RPC fields"
sleep 4
RESP="$(curl -fsS -X POST "$RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_supply","params":[]}' || true)"
echo "$RESP" | head -c 800; echo
echo
if echo "$RESP" | grep -q 'circulating_wei'; then
  green "✅ SUCCESS — circulating_wei is live on the chain."
  echo   "   Dashboard will pick up the new fields on next refresh."
else
  red    "⚠️  Patch built and binary swapped, but circulating_wei not visible yet."
  echo   "   Check: systemctl status ${NODE_SVCS[*]}"
fi
