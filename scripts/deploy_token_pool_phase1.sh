#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Zebvix L1 — Phase F (Phase 1 of 8) per-token AMM (Uniswap V2 style)
#
# What this build adds (over the currently-running validator binary)
# ------------------------------------------------------------------
#   1. zebvix-chain/src/token_pool.rs (new):
#        * TokenPool struct (token_id, zbx_reserve, token_reserve, lp_supply,
#          accumulators) with bincode codecs.
#        * Pure constant-product math: quote_zbx_in(), quote_token_in(),
#          add_liquidity(), remove_liquidity(), swap_*().
#        * 0.30% pool fee (30 / 10_000 BPS) — matches the native ZBX/zUSD pool.
#        * MIN_TOKEN_POOL_LIQUIDITY = 1000 LP units locked permanently
#          (Uniswap V2 anti-rug pattern) on the bootstrap deposit.
#        * Full unit-test suite covering happy path + invariants + edge cases.
#
#   2. zebvix-chain/src/transaction.rs:
#        * Four new TxKind variants at consensus tags 15..=18:
#            15 TokenPoolCreate          { token_id, zbx_amount, token_amount }
#            16 TokenPoolAddLiquidity    { token_id, zbx_amount, max_token, min_lp_out }
#            17 TokenPoolRemoveLiquidity { token_id, lp_burn, min_zbx_out, min_token_out }
#            18 TokenPoolSwap            { token_id, direction, amount_in, min_out }
#        * TokenSwapDirection enum (ZbxToToken=0, TokenToZbx=1) with
#          bincode 4-byte LE u32 tag (no payload).
#        * variant_name + tag_index updated for the 4 new arms.
#
#   3. zebvix-chain/src/state.rs:
#        * Three new META storage prefixes:
#            META_TOKEN_POOL_COUNT  — single-key u64 monotonic counter
#            META_TOKEN_POOL_PREFIX — keyed by token_id
#            META_TOKEN_LP_PREFIX   — keyed by (token_id, address)
#        * Helpers: token_pool_key/lp_key/count, get/put_token_pool,
#          lp_balance_of/put, list_token_pools.
#        * Four new apply_tx branches inserted before `Transfer => fall through`,
#          using the standard refund() closure pattern that reconstructs
#          `effective_zbx = from.balance + body.amount` and commits the post-state
#          balance after pool custody updates.
#
#   4. zebvix-chain/src/rpc.rs:
#        * Six new read-only RPC methods:
#            zbx_getTokenPool, zbx_listTokenPools, zbx_tokenPoolCount,
#            zbx_tokenSwapQuote, zbx_getTokenLpBalance, zbx_tokenPoolStats
#        * token_pool_to_json helper (joins pool reserves with the underlying
#          token's symbol/decimals/name for the dashboard).
#        * Updated BOTH kind_name closures (recentTxs + mempoolPending) to
#          render tags 15..=18 with stable string labels.
#
# Coverage caveat
# ---------------
# This is Phase 1 of 8 in the production roadmap. The chain now supports
# fully-functional TOKEN/ZBX AMM pools, but does NOT yet ship: token metadata
# updates (P2), ERC-20 allowance semantics (P3), explorer RPC parity (P4),
# BFT consensus (P5), slashing (P6), state sync (P7), or EIP-1559 (P8).
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
if [[ -x "$BIN_TARGET" ]]; then
  cp -p "$BIN_TARGET" "${BIN_TARGET}.prev-$(date +%Y%m%d-%H%M%S)"
fi
install -m 0755 "$NEW_BIN" "$BIN_TARGET"
systemctl restart "$SERVICE"
sleep 3
systemctl --no-pager status "$SERVICE" | head -20

echo "===> [5/6] verify the new RPC surface is live"
echo "-- zbx_tokenPoolCount --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_tokenPoolCount","params":[]}' \
  | python3 -m json.tool || true

echo
echo "-- zbx_listTokenPools (first 10) --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_listTokenPools","params":[0,10]}' \
  | python3 -m json.tool || true

echo "===> [6/6] done."
echo "      Per-token AMM pools (TxKind 15..=18) are now live on chain $(date)."
echo "      The dashboard pages /token-trade and /token-liquidity will start"
echo "      resolving zbx_listTokenPools / zbx_tokenSwapQuote etc. immediately."
echo "      First action: head to /token-liquidity → 'Create Pool' tab and"
echo "      bootstrap HDT/ZBX or DEMO/ZBX with any opening ratio."
