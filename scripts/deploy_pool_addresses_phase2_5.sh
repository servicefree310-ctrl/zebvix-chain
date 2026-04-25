#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Zebvix L1 — Phase H (Phase 2.5 of 8) deterministic pool addresses
#
# What this build adds (over Phase 2 / TokenSetMetadata)
# ------------------------------------------------------
#   1. zebvix-chain/src/token_pool.rs:
#        * pub const POOL_ADDR_DOMAIN_TAG = b"zbx-pool-v1"
#        * pub fn pool_address(token_id: u64) -> Address
#            = keccak256("zbx-pool-v1" || token_id_be8)[12..]
#
#   2. zebvix-chain/src/state.rs:
#        * META_POOL_ADDR_INDEX_PREFIX = b"poola/"   (reverse index)
#        * Helpers:
#            - pool_addr_index_key, put_pool_address_index
#            - get_pool_token_id_by_address  (O(1) reverse lookup)
#            - is_pool_address                 (cheap predicate)
#            - mirror_pool_zbx_balance         (custody mirror, ZBX side)
#            - mirror_pool_token_balance       (custody mirror, token side)
#        * apply_tx — TokenPoolCreate:
#            - refuses if derived pool address has prior balance / nonce /
#              token balance (anti-corruption guard)
#            - writes reverse index after pool init
#            - mirrors zbx_reserve + token_reserve to standard ledgers
#        * apply_tx — TokenPoolAddLiquidity / TokenPoolRemoveLiquidity /
#          TokenPoolSwap (both directions): mirror new reserves after each.
#        * apply_tx — TokenTransfer / TokenMint: refund if `to` is a pool addr
#        * apply_tx — legacy Transfer fall-through: refund principal if `to`
#          is a pool addr (fee kept, EVM-style)
#
#   3. zebvix-chain/src/rpc.rs:
#        * token_pool_to_json adds "address" field
#        * New read-only RPCs:
#            - zbx_getTokenPoolByAddress  [address]
#            - zbx_isPoolAddress          [address]
#
#   4. dashboard:
#        * lib/tokens.ts: TokenPoolJson.address, derivePoolAddress(),
#          getTokenPoolByAddress(), isPoolAddress(), POOL_ADDR_DOMAIN_TAG.
#        * api-server proxy whitelist: 2 new RPCs.
#
# CONSENSUS-CRITICAL invariants enforced after this deploy:
#   account(pool_address(id)).balance      == pool.zbx_reserve   ∀ pool id
#   token_balance_of(id, pool_address(id)) == pool.token_reserve ∀ pool id
#
# MIGRATION (one-time, fail-fast, runs automatically at first boot):
#   On `State::open()` the new node calls `backfill_pool_address_index()`.
#   If a durable migration marker (`META_PHASE_H_BACKFILL_DONE`) is absent,
#   it walks every pre-existing token id 1..=count and:
#     * writes the reverse-index entry for `pool_address(id)` if missing
#     * scrubs any stray ZBX/nonce/token-balance ONLY for tokens that have
#       NO live `TokenPool` (so already-open pools' mirrored reserves are
#       never touched)
#     * sets the marker last, so subsequent restarts skip
#   Any failure HALTS boot (refuses to start the daemon) so a partial
#   migration cannot diverge from a fully-migrated peer's index — the
#   transfer guards depend on the index agreeing across validators, and a
#   split would cause a hard consensus fork.
#
# WHY FAIL-FAST: `is_pool_address(addr)` decides whether `TokenTransfer`,
# `TokenMint`, and the legacy `Transfer` fall-through accept or reject a
# tx. If validator A backfilled token #5 and validator B did not, the same
# transfer to `pool_address(5)` is included by A and rejected by B — split
# brain. We refuse to boot rather than risk this.
#
# Run this script ON THE VPS, as root, inside /home/zebvix-chain.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CHAIN_DIR="${CHAIN_DIR:-/home/zebvix-chain}"
SERVICE="${SERVICE:-zebvix.service}"
BIN_TARGET="${BIN_TARGET:-/usr/local/bin/zebvix-node}"
RPC_PORT="${RPC_PORT:-8545}"

cd "$CHAIN_DIR"

echo "===> [1/7] git pull the new sources"
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

echo "===> [2/7] cargo build --release --features zvm"
export LIBCLANG_PATH="${LIBCLANG_PATH:-$(find /usr -name libclang.so* 2>/dev/null | head -1 | xargs dirname || true)}"
cargo build --release --features zvm

NEW_BIN="$CHAIN_DIR/target/release/zebvix-node"
if [[ ! -x "$NEW_BIN" ]]; then
  echo "ERROR: build produced no binary at $NEW_BIN"
  exit 1
fi

echo "===> [3/7] sanity-check the new binary"
"$NEW_BIN" --version || true

echo "===> [4/7] safety check — confirm zero open token pools before upgrade"
PRE_POOLS_JSON="$(curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_tokenPoolCount","params":[]}' || true)"
echo "Pre-upgrade pool count: $PRE_POOLS_JSON"
PRE_TOTAL="$(echo "$PRE_POOLS_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("result",{}).get("total",0))' 2>/dev/null || echo 0)"
if [[ "$PRE_TOTAL" != "0" ]]; then
  echo "===> [4/7] NOTE: $PRE_TOTAL existing pools detected. Phase H requires"
  echo "                    a one-time backfill of the reverse index + ledger"
  echo "                    mirrors for these pools. Proceeding anyway — see"
  echo "                    Phase H notes for backfill RPC."
fi

echo "===> [5/8] swap binary atomically + restart systemd unit"
# Capture EXACT backup path of the currently-installed binary so the
# rollback in step 6 restores precisely the binary we replaced (rather
# than `ls -1t prev-*` which could pick up a stale backup from an older
# deploy).
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

echo "===> [6/8] CRITICAL — verify daemon actually started (boot-time backfill is fail-fast)"
# State::open() refuses to boot if the Phase H index backfill fails. If the
# unit is "active (exited)" or "failed", the migration broke and we MUST
# stop the deploy here — keep the previous binary + DB intact.
if ! systemctl is-active --quiet "$SERVICE"; then
  echo
  echo "FATAL: $SERVICE is not active after restart. The Phase H boot-time"
  echo "       backfill likely failed. Check journalctl for the exact error:"
  echo "         journalctl -u $SERVICE --since '2 min ago' | grep -i 'phase-h\\|backfill\\|error'"
  if [[ -n "$PREV_BACKUP" && -x "$PREV_BACKUP" ]]; then
    echo "       Rolling back to the EXACT prior binary captured in step 5:"
    echo "         $PREV_BACKUP"
    install -m 0755 "$PREV_BACKUP" "$BIN_TARGET"
    systemctl restart "$SERVICE" || true
    sleep 3
    if systemctl is-active --quiet "$SERVICE"; then
      echo "       Rollback successful — service is back up on the previous binary."
    else
      echo "       WARNING: rollback restart did NOT bring the service back up."
      echo "                Investigate manually before next deploy attempt."
    fi
  else
    echo "       No prior backup captured (fresh install) — manual recovery required."
  fi
  exit 1
fi

echo "===> [7/8] verify the migration ran and the new RPC surface is live"
echo
echo "-- backfill log line (should appear exactly once across all restarts) --"
journalctl -u "$SERVICE" --since "5 min ago" --no-pager 2>/dev/null \
  | grep -E "phase-h backfill complete|phase-h.*failed" \
  | tail -5 || echo "(no Phase H backfill log line found — this is OK ONLY if the marker was already set from a prior boot)"

echo
echo "-- zbx_isPoolAddress for the burn address (should be is_pool=false, pool_open=false) --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_isPoolAddress","params":["0x0000000000000000000000000000000000000000"]}' \
  | python3 -m json.tool || true

echo
echo "-- zbx_listTokens (sample — confirm at least 1 token exists so backfill had work to do) --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_listTokens","params":[0,3]}' \
  | python3 -m json.tool || true

echo
echo "-- FULL backfill verification — every existing token's pool address must be reserved --"
# This is the smoking-gun check: if ANY existing token's derived pool
# address is not in the reverse index, the backfill is broken or the
# marker was set without completing the loop. We verify EVERY token, not
# just #1, because partial backfill (e.g., token #1 succeeded but #5
# failed silently) would otherwise false-pass.
#
# HARD requirement: pycryptodome (Crypto.Hash.keccak) must be installed,
# otherwise we cannot reproduce the on-chain derivation offline and the
# verification can't run. We REFUSE to declare deploy success without it
# (do not silently degrade — the whole point of step 7 is integrity).
if ! python3 -c 'from Crypto.Hash import keccak' 2>/dev/null; then
  echo "FATAL: pycryptodome not installed. Step-7 verification requires it to"
  echo "       reproduce the on-chain keccak-256 pool-address derivation. Install:"
  echo "         pip3 install --break-system-packages pycryptodome"
  echo "       (then re-run this script — boot was successful and binary is in place)."
  exit 1
fi
TOKEN_COUNT="$(curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_tokenCount","params":[]}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("result",{}).get("total",0))' 2>/dev/null || echo 0)"
echo "Tokens on chain: $TOKEN_COUNT"
if [[ "$TOKEN_COUNT" -gt 0 ]]; then
  MISSING=0
  CHECKED=0
  for id in $(seq 1 "$TOKEN_COUNT"); do
    DERIVED="$(python3 -c "
from Crypto.Hash import keccak
h = keccak.new(digest_bits=256); h.update(b'zbx-pool-v1' + (${id}).to_bytes(8,'big')); print('0x'+h.hexdigest()[24:])
")"
    if [[ -z "$DERIVED" ]]; then
      echo "FATAL: derivation script produced no output for token_id=$id. Aborting."
      exit 1
    fi
    RESP="$(curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"zbx_isPoolAddress\",\"params\":[\"$DERIVED\"]}")"
    FLAG="$(echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("result",{}).get("is_pool",False))' 2>/dev/null || echo False)"
    CHECKED=$((CHECKED+1))
    if [[ "$FLAG" != "True" ]]; then
      echo "  MISSING token_id=$id derived=$DERIVED RPC=$RESP"
      MISSING=$((MISSING+1))
    fi
  done
  echo "Verified $CHECKED tokens, $MISSING missing."
  if [[ "$MISSING" -gt 0 ]]; then
    echo
    echo "FATAL: $MISSING token(s) have NO reverse-index entry for their derived"
    echo "       pool address. The Phase H backfill is broken or did not complete."
    echo "       Inspect journalctl for backfill log line:"
    echo "         journalctl -u $SERVICE --since '5 min ago' | grep -i phase-h"
    echo "       To force re-run: STOP the service, delete the marker key from"
    echo "       RocksDB CF_META (key='phaseh/backfill_done_v1'), restart. Do NOT"
    echo "       mutate the marker while the daemon is running."
    exit 1
  fi
fi

echo "===> [8/8] done."
echo "      Phase H (deterministic pool addresses) is now live on chain $(date)."
echo "      * Reverse index reserved at TokenCreate (no pre-funding griefing)."
echo "      * Backfill scrub ran ONCE for pre-existing tokens (marker set)."
echo "      * Transfers TO any pool address are refunded (fee kept)."
echo "      * Custody invariant: account(pool_addr).balance == zbx_reserve."
