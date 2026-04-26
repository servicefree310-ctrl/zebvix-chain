#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Zebvix L1 — Phase H.1: typed `zbx_getTxByHash` RPC
#
# What this build adds (additive only — NO consensus / state changes)
# -------------------------------------------------------------------
#   1. zebvix-chain/src/state.rs:
#        * pub fn find_signed_tx_by_hash(hash) -> Option<(u64, SignedTx)>
#          - Resolves a 32-byte tx hash to the FULL `SignedTx` (not just the
#            flat `RecentTxRecord`). Uses the existing recent-tx ring buffer
#            to locate the height, then re-fetches the block and rescans
#            its `txs` for the matching hash.
#          - Read-only. No new keys written, no new indexes built. Boot is
#            unchanged.
#
#   2. zebvix-chain/src/rpc.rs:
#        * fn tx_kind_to_json(&TxKind, &State) -> Value
#          - Decodes all 20 `TxKind` variants into a kind-specific JSON
#            payload. For token-related kinds it resolves the token's
#            symbol/decimals/name from state so the dashboard can format
#            human-readable amounts in one round-trip.
#          - u128 fields are stringified to dodge JSON 2^53 cliff.
#        * NEW RPC: `zbx_getTxByHash [hash]`
#          - Returns { hash, height, from, to, amount, fee, nonce, chain_id,
#                      kind, kind_index, payload }
#          - `payload` carries the SEMANTIC fields (e.g. for
#            `TokenPoolCreate`: zbx_amount + token_amount + pool_address).
#          - Read-only, scoped to the recent-tx ring window (~1000 most
#            recent committed txs). Returns null for older hashes.
#
#   3. dashboard:
#        * lib/zbx-rpc.ts: ZbxTypedTx interface + getZbxTypedTx() helper.
#        * pages/block-explorer.tsx: TxDetail now also fetches the typed tx
#          and renders a per-kind payload section (TokenPoolCreate seed
#          amounts, TokenPoolSwap direction+amount_in, TokenTransfer
#          recipient+amount, etc). For non-Transfer kinds the misleading
#          "Value: 0 ZBX" row is suppressed.
#        * api-server proxy whitelist: 1 new RPC.
#
# WHY THIS EXISTS:
#   The eth-style `eth_getTransactionByHash` reports `value: 0` for ANY
#   non-Transfer kind because the eth-style mapping reads `body.amount`,
#   while `TokenPoolCreate` (and many other kinds) keep their semantic
#   amounts INSIDE the `TxKind` enum. The user's block-explorer therefore
#   showed `Value: 0 ZBX` for a real `TokenPoolCreate` that seeded
#   10 ZBX + 10 000 HDT. This RPC closes that gap by exposing the
#   typed payload directly, with no consensus impact.
#
# NO MIGRATION:
#   This deploy adds READ-ONLY plumbing only. There is no new index,
#   no new state-key, no new consensus rule. Boot does not run any
#   backfill. If the new binary fails to start, roll back; nothing in
#   the on-disk DB will have changed.
#
# Run this script ON THE VPS, as root, inside /home/zebvix-chain.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CHAIN_DIR="${CHAIN_DIR:-/home/zebvix-chain}"
SERVICE="${SERVICE:-zebvix.service}"
BIN_TARGET="${BIN_TARGET:-/usr/local/bin/zebvix-node}"
RPC_PORT="${RPC_PORT:-8545}"

cd "$CHAIN_DIR"

echo "===> [1/6] git pull the new sources"
if [[ -d .git ]]; then
  git fetch --all
  if [[ -z "$(git status --porcelain)" ]]; then
    git reset --hard origin/main
  else
    echo "WARNING: local changes present, doing a merge instead of reset"
    git merge --ff-only origin/main || {
      echo "ERROR: ff merge failed; resolve manually and re-run"
      exit 1
    }
  fi
else
  echo "NOTE: $CHAIN_DIR is not a git repo — skipping git pull."
fi

echo "===> [2/6] cargo build --release --features zvm"
export LIBCLANG_PATH="${LIBCLANG_PATH:-$(find /usr -name libclang.so* 2>/dev/null | head -1 | xargs dirname || true)}"
cargo build --release --features zvm

NEW_BIN="$CHAIN_DIR/target/release/zebvix-node"
if [[ ! -x "$NEW_BIN" ]]; then
  echo "ERROR: build produced no binary at $NEW_BIN"
  exit 1
fi

echo "===> [3/6] sanity-check the new binary"
"$NEW_BIN" --version || true

echo "===> [4/6] swap binary atomically + restart systemd unit"
PREV_BACKUP=""
if [[ -x "$BIN_TARGET" ]]; then
  PREV_BACKUP="${BIN_TARGET}.prev-$(date +%Y%m%d-%H%M%S)"
  cp -p "$BIN_TARGET" "$PREV_BACKUP"
  echo "Backed up current binary to: $PREV_BACKUP"
fi
install -m 0755 "$NEW_BIN" "$BIN_TARGET"
systemctl restart "$SERVICE"
sleep 4
systemctl --no-pager status "$SERVICE" | head -20

echo "===> [5/6] verify daemon actually started (purely-additive deploy, but still fail-fast)"
if ! systemctl is-active --quiet "$SERVICE"; then
  echo
  echo "FATAL: $SERVICE is not active after restart. Check journalctl:"
  echo "         journalctl -u $SERVICE --since '2 min ago' | tail -50"
  if [[ -n "$PREV_BACKUP" && -x "$PREV_BACKUP" ]]; then
    echo "       Rolling back to the prior binary captured in step 4:"
    echo "         $PREV_BACKUP"
    install -m 0755 "$PREV_BACKUP" "$BIN_TARGET"
    systemctl restart "$SERVICE" || true
    sleep 3
    if systemctl is-active --quiet "$SERVICE"; then
      echo "       Rollback successful — service is back up on the previous binary."
    else
      echo "       WARNING: rollback restart did NOT bring the service back up."
    fi
  fi
  exit 1
fi

echo "===> [6/6] probe the new RPC against a known-good TokenPoolCreate hash"
echo
echo "-- list 5 most-recent txs (sample) --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_recentTxs","params":[5]}' \
  | python3 -m json.tool || true

echo
echo "-- pick the first TokenPoolCreate-kind hash from recentTxs and decode it --"
SAMPLE_HASH="$(curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_recentTxs","params":[200]}' \
  | python3 -c '
import sys, json
d = json.load(sys.stdin).get("result", {})
for t in d.get("txs", []):
    if t.get("kind") == "TokenPoolCreate":
        print(t.get("hash", ""))
        sys.exit(0)
' 2>/dev/null || true)"

if [[ -n "$SAMPLE_HASH" ]]; then
  echo "Found TokenPoolCreate hash: $SAMPLE_HASH"
  echo "-- zbx_getTxByHash decode (expect payload.zbx_amount + payload.token_amount, NOT amount=0) --"
  curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"zbx_getTxByHash\",\"params\":[\"${SAMPLE_HASH}\"]}" \
    | python3 -m json.tool || true
else
  echo "(no TokenPoolCreate kind found in last 200 txs — probing with the burn-hash"
  echo " instead, which should return null cleanly without crashing)"
  curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"zbx_getTxByHash","params":["0x0000000000000000000000000000000000000000000000000000000000000000"]}' \
    | python3 -m json.tool || true
fi

echo
echo "-- negative test: malformed hash should return -32602 --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_getTxByHash","params":["0xnotahex"]}' \
  | python3 -m json.tool || true

echo
echo "===> done."
echo "     Phase H.1 (typed zbx_getTxByHash RPC) is now live on chain $(date)."
echo "     The dashboard block-explorer Tx detail page will now show semantic"
echo "     amounts for non-Transfer kinds (TokenPoolCreate seed amounts,"
echo "     TokenPoolSwap direction+amount_in, TokenTransfer recipient+amount,"
echo "     etc) instead of the misleading 'Value: 0 ZBX' eth-style row."
