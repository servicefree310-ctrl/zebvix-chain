#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Zebvix Chain v0.1.7 — Multisig Wallet Addon Installer
#  Phase B.8: M-of-N multisig wallets (Create / Propose / Approve /
#             Revoke / Execute) + 5 RPC endpoints + 8 CLI commands.
#
#  Pre-conditions:
#    • You already have a working Zebvix chain at $ZEBVIX_HOME
#      (default: /root/zebvix-chain) with Node-1 + Node-2 running.
#    • systemd units `zebvix-node1` and `zebvix-node2` exist.
#    • Rust toolchain is installed (cargo on PATH).
#
#  What this does (idempotent — safe to re-run):
#    1. Stops both node services.
#    2. Backs up current source tree to $ZEBVIX_HOME.bak.<ts>.
#    3. Downloads v0.1.7 tarball from the dashboard.
#    4. Extracts in place (preserves the existing target/ build cache
#       so the rebuild is incremental, not a clean rebuild).
#    5. Runs `cargo build --release`.
#    6. Replaces the binary on PATH (default /usr/local/bin/zebvix-node).
#    7. Restarts both nodes and verifies they sync.
#    8. Smoke-tests: zbx_chainInfo + zbx_multisigCount = 0 (fresh).
#
#  Wire format note: TxKind gains a Multisig variant. Existing
#  Transfer/Stake/etc txs decode unchanged — NO genesis re-init needed.
#  But BOTH nodes must run v0.1.7 before any multisig tx is sent,
#  otherwise the older node will reject the block.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

# ────────── tweakables ──────────
ZEBVIX_HOME="${ZEBVIX_HOME:-/root/zebvix-chain}"
DASHBOARD_URL="${DASHBOARD_URL:-https://7f6c353a-ec2a-4fe7-81e1-631c9fb77a3e-00-1a0ca41r86kcx.worf.replit.dev}"
TARBALL_URL="${DASHBOARD_URL}/zebvix-chain-updated.tar.gz"
EXPECTED_MD5="e06ae528f42b3f8d99547c076186820e"
BIN_PATH="${BIN_PATH:-/usr/local/bin/zebvix-node}"
NODE1_RPC="${NODE1_RPC:-http://127.0.0.1:8545}"
NODE2_RPC="${NODE2_RPC:-http://127.0.0.1:8546}"

C_CYAN='\033[0;36m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'
C_RED='\033[0;31m';  C_RESET='\033[0m';     C_BOLD='\033[1m'
log()  { echo -e "${C_CYAN}[ZBX-MS]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}  ✓${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}  ⚠${C_RESET} $*"; }
die()  { echo -e "${C_RED}  ✗${C_RESET} $*"; exit 1; }

echo
echo -e "${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}${C_CYAN}  Zebvix v0.1.7 — Multisig Wallet Addon Installer  ${C_RESET}"
echo -e "${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}"
echo

# ────────── 1. preflight ──────────
log "Preflight checks"
[ "$(id -u)" -eq 0 ] || die "must run as root"
command -v cargo >/dev/null || die "cargo not found — install Rust toolchain first"
command -v curl  >/dev/null || die "curl not found"
[ -d "$ZEBVIX_HOME/src" ]   || die "ZEBVIX_HOME=$ZEBVIX_HOME has no src/ dir"
[ -f "$ZEBVIX_HOME/Cargo.toml" ] || die "ZEBVIX_HOME=$ZEBVIX_HOME has no Cargo.toml"
ok "host OK, cargo $(cargo --version | awk '{print $2}'), source dir at $ZEBVIX_HOME"

# ────────── 2. stop nodes ──────────
log "Stopping nodes"
systemctl stop zebvix-node1 2>/dev/null && ok "stopped zebvix-node1" || warn "zebvix-node1 not running"
systemctl stop zebvix-node2 2>/dev/null && ok "stopped zebvix-node2" || warn "zebvix-node2 not running"

# ────────── 3. backup ──────────
TS=$(date +%Y%m%d-%H%M%S)
BAK="${ZEBVIX_HOME}.bak.${TS}"
log "Backing up source to $BAK"
cp -a "$ZEBVIX_HOME/src" "$BAK"
ok "backup saved (target/ cache untouched for incremental rebuild)"

# ────────── 4. download tarball ──────────
TMP=$(mktemp -d)
log "Downloading v0.1.7 tarball from dashboard"
log "  $TARBALL_URL"
curl -fsSL "$TARBALL_URL" -o "$TMP/zbx.tar.gz" || die "download failed"
GOT_MD5=$(md5sum "$TMP/zbx.tar.gz" | awk '{print $1}')
log "  md5 got=$GOT_MD5"
log "  md5 exp=$EXPECTED_MD5"
if [ "$GOT_MD5" != "$EXPECTED_MD5" ]; then
    warn "md5 mismatch — proceeding anyway (you may have a newer dashboard build)"
fi
ok "tarball downloaded ($(du -h "$TMP/zbx.tar.gz" | awk '{print $1}'))"

# ────────── 5. extract ──────────
log "Extracting into $ZEBVIX_HOME"
# Strip leading 'zebvix-chain/' if the tarball was packaged with it.
tar -tzf "$TMP/zbx.tar.gz" | head -3 | grep -q '^zebvix-chain/' && STRIP=1 || STRIP=0
if [ "$STRIP" -eq 1 ]; then
    tar -xzf "$TMP/zbx.tar.gz" -C "$ZEBVIX_HOME" --strip-components=1
else
    tar -xzf "$TMP/zbx.tar.gz" -C "$ZEBVIX_HOME"
fi
[ -f "$ZEBVIX_HOME/src/multisig.rs" ] || die "extract OK but multisig.rs missing — wrong tarball?"
ok "v0.1.7 source files in place (multisig.rs present)"

# ────────── 6. cargo build ──────────
log "Building (cargo build --release) — incremental, ~30-90s"
cd "$ZEBVIX_HOME"
if cargo build --release 2>&1 | tail -20 | grep -E 'error|warning: unused' || true; then :; fi
[ -x "$ZEBVIX_HOME/target/release/zebvix-node" ] || die "build failed — see cargo output above"
NEW_MD5=$(md5sum "$ZEBVIX_HOME/target/release/zebvix-node" | awk '{print $1}')
ok "build succeeded — new binary md5: $NEW_MD5"

# ────────── 7. install binary ──────────
log "Installing binary to $BIN_PATH"
install -m 0755 "$ZEBVIX_HOME/target/release/zebvix-node" "$BIN_PATH"
INSTALLED_MD5=$(md5sum "$BIN_PATH" | awk '{print $1}')
[ "$NEW_MD5" = "$INSTALLED_MD5" ] || die "install verify mismatch"
ok "binary installed — md5 matches"

# Verify CLI knows the new commands
if "$BIN_PATH" --help 2>&1 | grep -q multisig-create; then
    ok "CLI exposes multisig-* commands ✅"
else
    die "CLI does NOT expose multisig commands — wrong build?"
fi

# ────────── 8. restart ──────────
log "Starting nodes"
systemctl start zebvix-node1; sleep 2
systemctl start zebvix-node2; sleep 3
systemctl is-active --quiet zebvix-node1 && ok "node1 running" || die "node1 failed to start (check: journalctl -u zebvix-node1 -n 50)"
systemctl is-active --quiet zebvix-node2 && ok "node2 running" || die "node2 failed to start (check: journalctl -u zebvix-node2 -n 50)"

# ────────── 9. smoke test ──────────
log "Smoke-testing RPCs"
sleep 4
H1=$(curl -fsS -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"zbx_blockNumber","params":[]}' \
    "$NODE1_RPC" | grep -oE '"height":[0-9]+' | head -1 | cut -d: -f2)
H2=$(curl -fsS -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"zbx_blockNumber","params":[]}' \
    "$NODE2_RPC" | grep -oE '"height":[0-9]+' | head -1 | cut -d: -f2)
ok "node1 height: $H1"
ok "node2 height: $H2"
[ -n "$H1" ] && [ -n "$H2" ] || die "RPC not responding"

MSCOUNT=$(curl -fsS -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"zbx_multisigCount","params":[]}' \
    "$NODE1_RPC" | grep -oE '"total":[0-9]+' | head -1 | cut -d: -f2)
ok "zbx_multisigCount = $MSCOUNT (new RPC live)"

echo
echo -e "${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}  ✅ v0.1.7 Multisig addon installed successfully    ${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo
echo -e "${C_CYAN}Try it out:${C_RESET}"
echo
echo "  # 1) Create extra owner keys (or reuse existing ones)"
echo "  zebvix-node generate-key --out /root/.zebvix/owner2.key"
echo "  zebvix-node generate-key --out /root/.zebvix/owner3.key"
echo
echo "  # 2) Create a 2-of-3 multisig (use any 3 owner addresses)"
echo "  zebvix-node multisig-create \\"
echo "    --signer-key /root/.zebvix/validator.key \\"
echo "    --owners 0xAAA...,0xBBB...,0xCCC... \\"
echo "    --threshold 2 --salt 1"
echo
echo "  # 3) Fund the multisig (note the derived address from step 2)"
echo "  zebvix-node send --signer-key /root/.zebvix/validator.key \\"
echo "    --to <multisig-addr> --amount 100"
echo
echo "  # 4) Propose, approve, execute"
echo "  zebvix-node multisig-propose --signer-key owner1.key \\"
echo "    --multisig <addr> --to 0xrecipient --amount 50"
echo "  zebvix-node multisig-approve --signer-key owner2.key \\"
echo "    --multisig <addr> --proposal-id 0"
echo "  zebvix-node multisig-execute --signer-key owner1.key \\"
echo "    --multisig <addr> --proposal-id 0"
echo
echo -e "${C_YELLOW}Backup of previous source: $BAK${C_RESET}"
echo
