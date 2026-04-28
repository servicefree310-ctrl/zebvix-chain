#!/usr/bin/env bash
# Phase E / Phase 0 — Sui/Aptos/Solana-tier testnet bootstrap.
#
# Run this script on a VPS to bring up a Zebvix testnet node alongside
# (NOT replacing) a mainnet node. The two binaries are CRYPTOGRAPHICALLY
# ISOLATED — testnet uses CHAIN_ID=78787, mainnet uses CHAIN_ID=7878,
# so signed transactions cannot replay across networks.
#
# Surface allocation (avoids ALL collisions with mainnet on the same VPS):
#   Component        | Mainnet                       | Testnet
#   -----------------+-------------------------------+--------------------------------
#   Binary           | /usr/local/bin/zebvix-node    | /usr/local/bin/zebvix-node-testnet
#   RocksDB home     | /root/.zebvix                 | /root/.zebvix-testnet
#   Systemd service  | zebvix.service                | zebvix-testnet.service
#   RPC listen       | 0.0.0.0:8545                  | 0.0.0.0:18545
#   P2P listen       | 30333                         | 31333
#   Source tree      | /home/zebvix-chain            | /home/zebvix-chain  (SHARED)
#
# Both binaries are built from the same source tree — no risk of source
# divergence. The only difference is `--features zvm,testnet` at build time.
#
# Usage:
#   sudo bash scripts/testnet-deploy.sh                  # full deploy
#   sudo bash scripts/testnet-deploy.sh --build-only     # rebuild + install, skip systemd
#   sudo bash scripts/testnet-deploy.sh --service-only   # write systemd unit + restart, skip build
#   sudo bash scripts/testnet-deploy.sh --status         # show testnet service status + tip
#
# Environment overrides (rarely needed):
#   ZBX_TESTNET_RPC_PORT   default 18545
#   ZBX_TESTNET_P2P_PORT   default 31333
#   ZBX_TESTNET_HOME       default /root/.zebvix-testnet
#   ZBX_TESTNET_BIN        default /usr/local/bin/zebvix-node-testnet
#
# Exit codes:
#   0 — success (or status query returned cleanly)
#   1 — build / install / systemd failure
#   2 — usage / environment error

set -euo pipefail

# ── 0. Preflight ──────────────────────────────────────────────────────────
if [[ "${EUID}" -ne 0 ]]; then
    echo "❌ this script must be run as root (sudo)" >&2
    exit 2
fi

# ── 0b. cargo PATH discovery (sudo-safe) ──────────────────────────────────
# `sudo` strips most env vars including PATH, so a rust toolchain installed
# under the invoking user's home (e.g. ~ubuntu/.cargo/bin) is invisible by
# default — that's exactly what bit us on the first VPS run, where
# `sudo bash testnet-deploy.sh --build-only` died with `cargo: command not
# found` and the `||` fallback then created a systemd unit pointing at a
# binary that was never built. Fix: walk the standard install locations
# (root, $SUDO_USER, $HOME, system-wide) and prepend the first hit to PATH.
# Honours `CARGO` env var as an explicit override for non-standard installs.
if ! command -v cargo >/dev/null 2>&1; then
    _cargo_candidates=()
    [[ -n "${CARGO:-}" ]]      && _cargo_candidates+=("$(dirname "$CARGO")")
    [[ -n "${SUDO_USER:-}" ]]  && _cargo_candidates+=("/home/${SUDO_USER}/.cargo/bin")
    [[ -n "${HOME:-}" ]]       && _cargo_candidates+=("${HOME}/.cargo/bin")
    _cargo_candidates+=(
        "/root/.cargo/bin"
        "/usr/local/cargo/bin"
        "/usr/local/bin"
    )
    for _d in "${_cargo_candidates[@]}"; do
        if [[ -x "${_d}/cargo" ]]; then
            export PATH="${_d}:${PATH}"
            echo "  (cargo discovered at ${_d}/cargo — sudo PATH was incomplete)"
            break
        fi
    done
    unset _cargo_candidates _d
fi
if ! command -v cargo >/dev/null 2>&1; then
    echo "❌ cargo not found in PATH or any of: \$CARGO, \$SUDO_USER's ~/.cargo/bin," >&2
    echo "   \$HOME/.cargo/bin, /root/.cargo/bin, /usr/local/cargo/bin, /usr/local/bin." >&2
    echo "   Install rust (https://rustup.rs) or set CARGO=/path/to/cargo and re-run." >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"
if [[ ! -f "${SOURCE_DIR}/Cargo.toml" ]]; then
    echo "❌ ${SOURCE_DIR}/Cargo.toml not found — run this from inside a zebvix-chain checkout" >&2
    exit 2
fi

RPC_PORT="${ZBX_TESTNET_RPC_PORT:-18545}"
P2P_PORT="${ZBX_TESTNET_P2P_PORT:-31333}"
HOME_DIR="${ZBX_TESTNET_HOME:-/root/.zebvix-testnet}"
BIN_PATH="${ZBX_TESTNET_BIN:-/usr/local/bin/zebvix-node-testnet}"
SERVICE="zebvix-testnet"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"

mode="full"
case "${1:-}" in
    --build-only)   mode="build"   ;;
    --service-only) mode="service" ;;
    --status)       mode="status"  ;;
    "")             mode="full"    ;;
    *)
        echo "❌ unknown flag: $1" >&2
        echo "    valid: --build-only | --service-only | --status | (no flag = full)" >&2
        exit 2
        ;;
esac

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪  Zebvix TESTNET deploy — Phase E / Phase 0"
echo "    source : ${SOURCE_DIR}"
echo "    binary : ${BIN_PATH}"
echo "    home   : ${HOME_DIR}"
echo "    rpc    : 0.0.0.0:${RPC_PORT}    p2p :${P2P_PORT}"
echo "    mode   : ${mode}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── --status fast path ────────────────────────────────────────────────────
if [[ "$mode" == "status" ]]; then
    echo ""
    systemctl status "$SERVICE" --no-pager | head -10 || true
    echo ""
    echo "── recent journal (last 30s) ──"
    journalctl -u "$SERVICE" --since "30 seconds ago" --no-pager | tail -20 || true
    echo ""
    echo "── tip via local RPC ──"
    curl -fsS -X POST "http://127.0.0.1:${RPC_PORT}" \
         -H 'Content-Type: application/json' \
         -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
         2>/dev/null | head -1 || echo "(RPC not responding)"
    exit 0
fi

# ── 1. Build (mode=build|full) ────────────────────────────────────────────
if [[ "$mode" == "build" || "$mode" == "full" ]]; then
    echo ""
    echo "▶ building testnet binary (cargo build --release --features zvm,testnet)..."
    echo "  this re-uses target/ from any prior mainnet build (incremental, ~30s warm)"
    cd "$SOURCE_DIR"
    cargo build --release --features zvm,testnet
    SRC_BIN="${SOURCE_DIR}/target/release/zebvix-node"
    if [[ ! -x "$SRC_BIN" ]]; then
        echo "❌ build succeeded but ${SRC_BIN} not found" >&2
        exit 1
    fi
    echo ""
    echo "▶ atomic install to ${BIN_PATH} (handles ETXTBSY when binary is already running)..."
    install -m 755 "$SRC_BIN" "$BIN_PATH"
    echo "  installed sha256: $(sha256sum "$BIN_PATH" | awk '{print $1}')"
fi

# ── 2. Systemd unit (mode=service|full) ───────────────────────────────────
if [[ "$mode" == "service" || "$mode" == "full" ]]; then
    echo ""
    echo "▶ writing systemd unit ${SERVICE_FILE}..."
    mkdir -p "$HOME_DIR"
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Zebvix L1 Blockchain Node — TESTNET (Phase E)
Documentation=https://github.com/zebvix-org/zebvix-chain
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${BIN_PATH} start --rpc 0.0.0.0:${RPC_PORT} --p2p-port ${P2P_PORT} --home ${HOME_DIR}
Restart=always
RestartSec=5
LimitNOFILE=65536
# Keep testnet logs separate from mainnet for grep-ability
SyslogIdentifier=${SERVICE}
StandardOutput=journal
StandardError=journal
# Phase H — RPC concurrency cap (H1). Testnet uses lower default than mainnet
# so a runaway test load script doesn't starve the consensus task.
Environment=ZEBVIX_RPC_MAX_INFLIGHT=128
# Loud network identifier in any process listing
Environment=ZEBVIX_NETWORK=testnet

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable "$SERVICE" >/dev/null
    echo ""
    echo "▶ starting / restarting service..."
    systemctl restart "$SERVICE"
    sleep 3
    systemctl status "$SERVICE" --no-pager | head -8
    echo ""
    echo "▶ verifying TESTNET banner in journal..."
    if journalctl -u "$SERVICE" --since "10 seconds ago" --no-pager | grep -qE "TESTNET|chain_id=78787"; then
        echo "  ✓ TESTNET banner confirmed"
    else
        echo "  ⚠  TESTNET banner not found in last 10s of journal — check 'journalctl -u ${SERVICE} -e'"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ testnet deploy complete"
echo ""
echo "    Verify health:    sudo bash ${SCRIPT_DIR}/testnet-deploy.sh --status"
echo "    Tail logs:        sudo journalctl -u ${SERVICE} -f"
echo "    RPC test:         curl -X POST http://127.0.0.1:${RPC_PORT} \\"
echo "                          -H 'Content-Type: application/json' \\"
echo "                          -d '{\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"params\":[],\"id\":1}'"
echo "                      → expect 0x133e3 (78787 decimal)"
echo ""
echo "    ⚠  TESTNET TOKENS HAVE ZERO ECONOMIC VALUE."
echo "    ⚠  Mainnet at port 8545 (chain_id=7878) is UNTOUCHED."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
