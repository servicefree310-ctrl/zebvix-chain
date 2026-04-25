#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Zebvix L1 — Phase G (Phase 2 of 8) on-chain token metadata
#
# What this build adds (over the Phase 1 / Phase F validator binary)
# ------------------------------------------------------------------
#   1. zebvix-chain/src/transaction.rs:
#        * One new TxKind variant at consensus tag 19:
#            19 TokenSetMetadata { token_id, logo_url, website, description,
#                                  twitter, telegram, discord }
#        * variant_name + tag_index updated for the new arm.
#
#   2. zebvix-chain/src/tokenomics.rs:
#        * TOKEN_META_LOGO_MAX_LEN        = 256
#        * TOKEN_META_WEBSITE_MAX_LEN     = 256
#        * TOKEN_META_DESCRIPTION_MAX_LEN = 1024
#        * TOKEN_META_SOCIAL_MAX_LEN      = 64
#
#   3. zebvix-chain/src/state.rs:
#        * META_TOKEN_METADATA_PREFIX     = b"tokm/"
#        * TokenMetadata persisted record (token_id + 6 strings + height).
#        * Helpers: token_metadata_key, get/put_token_metadata.
#        * apply_tx branch:
#            - rejects (refund) when sender != token.creator
#            - rejects (refund) when any field exceeds its cap
#            - persists the record under META_TOKEN_METADATA_PREFIX/<token_id>
#            - stamps `updated_at_height` with the current block height
#
#   4. zebvix-chain/src/mempool.rs:
#        * Adds match arm for TxKind tag 19 in the mempool kind index.
#
#   5. zebvix-chain/src/rpc.rs:
#        * New read-only RPC: zbx_getTokenMetadata
#        * token_info_to_json now joins on-chain metadata as `metadata: {…}`
#          (or `null` when unset) so wallets/explorers get logo/socials
#          inline with the token info — no extra round-trip needed.
#        * Both kind_name closures (recentTxs + mempoolPending) extended
#          to render tag 19 as "TokenSetMetadata".
#
#   6. dashboard:
#        * /token-metadata page (creator-only edit form, length validation)
#        * sidebar entry, App route, lib/tokens.ts encoder/sender/RPC wrapper
#        * api-server proxy whitelist: zbx_getTokenMetadata
#
# Auth model: only the original `creator` of a token (recorded at
# TokenCreate time) may set or update metadata. Field caps are mirrored
# byte-for-byte between Rust (tokenomics.rs) and TypeScript (lib/tokens.ts)
# so the dashboard pre-validates and never sends a guaranteed-fail tx.
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
echo "-- zbx_getTokenMetadata for token 1 (HDT) --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_getTokenMetadata","params":[1]}' \
  | python3 -m json.tool || true

echo
echo "-- zbx_tokenInfo for token 1 (should now include metadata field) --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_tokenInfo","params":[1]}' \
  | python3 -m json.tool || true

echo
echo "-- zbx_listTokens (first 5; metadata enrichment baked in) --"
curl -s "http://127.0.0.1:${RPC_PORT}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_listTokens","params":[0,5]}' \
  | python3 -m json.tool || true

echo "===> [6/6] done."
echo "      TokenSetMetadata (TxKind 19) is now live on chain $(date)."
echo "      Dashboard page /token-metadata will resolve zbx_getTokenMetadata"
echo "      and let creators set logo / website / description / socials."
echo "      First action: open /token-metadata, pick a creator-owned token,"
echo "      paste a logo URL, hit 'Save metadata on-chain'."
