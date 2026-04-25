#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Zebvix L1 — Phase C.2.1 ZVM tx-lookup RPC deploy
#
# Purpose
# -------
# Ship the on-chain wiring for `eth_getTransactionByHash` and
# `eth_getTransactionReceipt` so the dashboard's ZVM Explorer
# can resolve any native ZBX-tx hash within the rolling 1000-tx window
# directly via the standard Ethereum JSON-RPC methods.
#
# What this build adds (over the currently-running validator binary)
# ------------------------------------------------------------------
#   1. state.rs:
#        * META_RTX_HASH_PREFIX = b"rtx/h/"  — secondary CF_META index
#        * push_recent_tx() now writes hash→seq AND cascade-deletes the
#          mapping when the entry rolls out of the ring.
#        * find_tx_by_hash(): O(1) point lookup via the new index, with a
#          linear-scan fallback for any pre-index legacy entries.
#        * block_hash_at(height): used to populate `blockHash` in the
#          synthetic Ethereum-shape tx + receipt JSON.
#
#   2. zvm_rpc.rs:
#        * ZvmRpcCtx now carries an `Arc<State>` so handlers can call
#          find_tx_by_hash + block_hash_at directly.
#        * `eth_getTransactionByHash` / `zbx_getEvmTransaction` arm:
#          synthesizes the Geth-shape JSON (status=0x1 by construction
#          since failed txs are never indexed, gas=21000, type=0x0,
#          v/r/s=0).
#        * `eth_getTransactionReceipt` / `zbx_getEvmReceipt` arm:
#          synthesizes the Geth-shape receipt JSON (status=0x1, logs=[],
#          cumulativeGasUsed=21000, logsBloom=256-byte zeroes).
#
#   3. rpc.rs:
#        * Passes `state: ctx.state.clone()` into the new ZvmRpcCtx field.
#        * Adds `zbx_getEvmTransaction` to the curated alias forwarding list.
#
# Coverage caveat
# ---------------
# This release covers ONLY native ZBX tx (transfers, validator-add,
# staking, payid, multisig, etc.). ZVM (Solidity contract) tx are NOT
# yet pushed into the recent-tx ring buffer — they continue to return
# `null` for both methods. ZVM-tx coverage + real on-execution
# receipts (with per-tx gasUsed, contractAddress, logs[]) ship in
# Phase C.3 alongside the CF_LOGS producer wiring.
#
# Run this script ON THE VPS, as root, inside /home/zebvix-chain.
#
# DESTRUCTIVE FLAGS
# -----------------
# This script does NOT touch the data dir. The new META_RTX_HASH_PREFIX
# index is built lazily — push_recent_tx() writes new entries at every
# new block, and find_tx_by_hash() falls back to a linear scan for the
# (up to RECENT_TX_CAP=1000) txs that were committed BEFORE this binary
# was deployed. Within ~1000 blocks of normal traffic the slow-path
# fallback becomes irrelevant.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CHAIN_DIR="${CHAIN_DIR:-/home/zebvix-chain}"
SERVICE="${SERVICE:-zebvix.service}"
BIN_TARGET="${BIN_TARGET:-/usr/local/bin/zebvix-node}"
RPC_PORT="${RPC_PORT:-8545}"

cd "$CHAIN_DIR"

echo "===> [1/6] git pull (or rsync) the new sources"
if [[ -d .git ]]; then
  git fetch --all
  # Reset hard to origin/main only if the working tree is clean — preserve
  # any local uncommitted operator changes otherwise.
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
  echo "      Make sure you have rsynced the new src/ from the workspace before running."
fi

echo "===> [2/6] cargo build --release --features zvm (incremental)"
export LIBCLANG_PATH="${LIBCLANG_PATH:-$(find /usr -name libclang.so* 2>/dev/null | head -1 | xargs dirname || true)}"
cargo build --release --features zvm

NEW_BIN="$CHAIN_DIR/target/release/zebvix-node"
if [[ ! -x "$NEW_BIN" ]]; then
  echo "ERROR: build produced no binary at $NEW_BIN"
  exit 1
fi

echo "===> [3/6] sanity-check the new binary version banner"
"$NEW_BIN" --version || true

echo "===> [4/6] swap binary atomically + restart systemd unit"
# Backup the current binary so a rollback is one mv away.
if [[ -x "$BIN_TARGET" ]]; then
  cp -p "$BIN_TARGET" "${BIN_TARGET}.prev-$(date +%Y%m%d-%H%M%S)"
fi
install -m 0755 "$NEW_BIN" "$BIN_TARGET"
systemctl restart "$SERVICE"
sleep 3
systemctl --no-pager status "$SERVICE" | head -20

echo "===> [5/6] pick a recent tx hash from the ring and verify both RPCs"
# Grab the newest tx hash from the existing zbx_recentTxs index.
HASH=$(curl -s "http://127.0.0.1:${RPC_PORT}" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_recentTxs","params":[1]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result']['txs'][0]['hash'] if d.get('result',{}).get('txs') else '')" 2>/dev/null || echo "")

if [[ -z "$HASH" ]]; then
  echo "WARN: no txs in ring buffer yet — skipping RPC test."
  echo "      Submit any native tx (transfer, validator-edit, etc.) and re-test:"
  echo "      curl http://127.0.0.1:${RPC_PORT} -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionByHash\",\"params\":[\"<hash>\"]}'"
else
  echo "Testing eth_getTransactionByHash with hash $HASH"
  curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionByHash\",\"params\":[\"$HASH\"]}" \
    | python3 -m json.tool || true

  echo
  echo "Testing eth_getTransactionReceipt with hash $HASH"
  curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$HASH\"]}" \
    | python3 -m json.tool || true
fi

echo "===> [6/6] done. ZVM Explorer in the dashboard should now resolve"
echo "      any tx hash listed by zbx_recentTxs via the standard"
echo "      eth_getTransactionByHash + eth_getTransactionReceipt path,"
echo "      with the native ring-buffer scan kept only as a last-resort fallback."
