# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

---

## Zebvix L1 Blockchain (zebvix-chain/)

Standalone Rust crate building Zebvix L1 — token ZBX, chain-id 7878, EVM-style 20-byte addresses, 150M supply with Bitcoin-style halving, founder = `0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc`. Includes permissionless zSwap AMM. Communicate in Hinglish with the user.

### Phase Status

- **A — 2-node sync** ✅ — P2P gossip, heartbeat, block sync.
- **B.1 — Validator registry** ✅ — On-chain RocksDB-backed validator set, admin-gated CLI, RPCs.
- **B.2 — Vote messages** ✅ — Domain-tagged Ed25519 votes, `VotePool` with double-sign detection, gossipsub `zebvix/7878/votes/v1` topic, `zbx_voteStats` RPC, **2/2 quorum on every block** verified on VPS.
- **B.3.1 — On-chain validator updates** ✅ — `TxKind` enum (`Transfer` / `ValidatorAdd` / `ValidatorRemove`); admin-signed governance txs; CLI now submits via RPC; **verified on VPS** that both nodes log `validator-add applied` for the same tx → registry replicates without manual mirroring.
- **B.3.1.5 — Genesis fix + RPC for validator-list** ✅ **VERIFIED on VPS** — Hardcoded `FOUNDER_PUBKEY_HEX` in `tokenomics.rs`; `cmd_init` now deterministically seeds genesis validator set with `{founder}` regardless of local `--validator-key`. CLI `validator-list` now defaults to RPC (`zbx_listValidators`) — no DB lock conflict; pass `--offline` only when node is stopped. Live VPS proof: split-brain diagnosed (Node-1 h=239 founder-genesis vs Node-2 h=2212 self-genesis), data dirs wiped+re-initd, both nodes converged to identical 2-validator set, `zbx_voteStats` shows true 2/2 prevote + precommit quorum on every block, logs print `✅ QUORUM` markers in real time.
- **B.3.2.1 — Round-robin proposer** ✅ **VERIFIED on VPS** — `who_proposes(height, validators) -> Address` in `consensus.rs`; `Producer::run()` re-reads validator set every tick and skips production unless `elected == me`. 3 unit tests pass. Backward compat: `--follower` flag still hard-overrides. **Live proof (Apr 22, 2026)**: Node-2 restarted without `--follower`, both nodes immediately began strict alternation — Node-1 (0xe381...) produced odd heights #123,125,127,129,131,133; Node-2 (0xbdfb...) produced even heights #124,126,128,130,132,134; 5-sec block interval honoured, validator-list converged on both nodes.
- **B.3.2.2 — State machine timeouts** ✅ **VERIFIED on VPS** — `who_proposes` extended with `round` parameter (`(h+r) % len`); `Producer::run()` rewritten as state machine with `PROPOSE_TIMEOUT_SECS=8s` and `TICK_INTERVAL_MS=500ms`. Round 0 honours `BLOCK_TIME_SECS=5s` pacing; recovery rounds (≥1) propose immediately. **Live proof (Apr 22, 2026)**: Node-1 killed mid-flight @ height 314 → Node-2 logged `⏰ propose timeout at h=315 r=0 → bumping to r=1`, then `block #315 produced round=1`, then `✓ height advanced to 316 (recovered after r=1 at h=315)`. Pattern repeated every odd height. Chain stayed LIVE solo for 25s. **Known limitation**: when Node-1 restarted, it produced its OWN #315 with different hash (no commit-safety yet) — soft fork. B.3.2.3 (2/3+ commit gate) will fix by rejecting blocks without quorum proof.
- **B.3.2.3 — 2/3+ commit gate** ⏸️ DEFERRED until 4-validator setup — would cause 2-validator chain to HALT on any single-node failure (correct BFT but bad demo UX). Design documented; will re-activate after multi-validator onboarding.
- **🐛 Known bug — sync-vs-produce race (Apr 22, 2026)**: Producer state machine doesn't gate on sync-status. When Node-2 catches up via p2p and reaches `who_proposes(h+1) == self`, it produces own block immediately instead of waiting for the already-existing block from peer at the same height. Result: instant fork at the catch-up boundary. **Fix**: add `is_syncing()` check in `Producer::run()` — skip production if `peer_tip > our_tip + SYNC_THRESHOLD` (e.g., 3 blocks). Plan to address as **B.3.2.5** after multi-validator onboarding completes.
- **Small improvements (Apr 22, 2026)** ✅ — Added `zbx_blockNumber` RPC (richer than eth_blockNumber: returns height + hex + hash + timestamp_ms + proposer); new CLI `show-validator --address <0x…>` (queries `zbx_getValidator` via RPC); new CLI `block-number` (chain tip details).
- **B.3.2.4 — `LastCommit` in BlockHeader** ⏳ — signed precommit set from prev block, validated on apply.

### Module layout

- `src/transaction.rs` — **canonical home of `TxKind`, `TxBody`, `SignedTx`** plus inherent helpers (`SignedTx::hash()`, `.sender_address()`, `.verify()`, `.to_bytes()`, `.from_bytes()`, `TxBody::transfer()`, `TxBody::sign()`, `TxKind::variant_name()`, `.tag_index()`). Wire format = bincode of these structs in field order — DO NOT reorder.
- `src/types.rs` — `Address`, `Hash`, `BlockHeader`, `Block`, `Validator`, hex serde helpers. Re-exports `TxKind`/`TxBody`/`SignedTx` from `transaction.rs` for backward compat (so `crate::types::SignedTx` keeps working everywhere).
- `src/crypto.rs` — `sign_tx`, `verify_tx`, `tx_hash`, `tx_signing_bytes` (low-level). `transaction.rs` wraps these as inherent methods.
- `src/mempool.rs`, `src/state.rs`, `src/rpc.rs`, `src/consensus.rs` — consume `SignedTx` via the existing `crate::types::*` import path; no churn needed.

### Phase B.10 — Advanced on-chain Buy/Sell (Apr 24, 2026) ✅ (Replit-side; VPS deploy pending)

Promotes the AMM swap from an admin-only CLI path to a first-class user transaction with on-chain slippage protection — the explicit "Buy ZBX / Sell ZBX" flow.

- **`transaction.rs`** — New `SwapDirection { ZbxToZusd, ZusdToZbx }` enum and `TxKind::Swap { direction, min_out }` variant **appended at the end** of `TxKind` (bincode tag = **8**, fully backward-compatible — older tx kinds keep tags 0–7). `variant_name()`, `tag_index()`, `is_value_bearing()` updated. `body.amount` carries the swap input (ZBX wei OR zUSD micro-units depending on direction); `body.to` MUST equal `body.from` (chain enforces).
- **`state.rs apply_tx`** — Kind-aware pre-debit: ZbxToZusd debits `amount + fee` from `balance`; ZusdToZbx debits **only** `fee` from `balance` and the swap arm itself debits `amount` from `from.zusd`. New `Swap` arm validates direction-specific balance, runs `pool.swap_*`, enforces consensus `min_out` (slippage revert refunds principal — only fee consumed, EVM-style "revert with gas"), settles fees + admin payout, credits output to sender. Local direction-aware `swap_refund` closure prevents the global `refund` from incorrectly minting ZBX on early-error ZusdToZbx paths.
- **`rpc.rs`** — Three new methods:
  - `zbx_swapQuote(direction, amount_in)` — read-only preview (clones pool — never mutates state). Returns `expected_out`, `fee_in`, `price_impact_bps`, `would_succeed`, `reason`, plus pre-computed `recommended_min_out_at_{0_5,1,3}pct`.
  - `zbx_recentSwaps(limit=20)` — filtered view of the recent-tx ring buffer (`kind_index == 8`). Returns trade history without re-scanning blocks.
  - `zbx_poolStats(window=200)` — pool reserves + spot price + fee accounting + recent-window swap count.
  - `kind_name` tables in `zbx_recentTxs` and `zbx_mempoolPending` updated to include `"Swap"` at index 8.
- **`api-server/src/routes/rpc.ts`** — Whitelisted `zbx_swapQuote`, `zbx_recentSwaps`, `zbx_poolStats`.
- **Dashboard — `web-wallet.ts`** — `encodeSwapBody({from, direction, amountIn, minOut, nonce, feeWei, chainId})` produces a 172-byte body matching bincode (`from(50)+to(50)+amount(16)+nonce(8)+fee(16)+chain_id(8)+kind_tag(4=8)+direction_tag(4)+min_out(16)`); signed = 268 bytes. New `sendSwap()` helper mirrors `sendTransfer`. `SwapDirection` type + `zusdToMicros` exported.
- **Dashboard — `/swap` page** — Full advanced UI: active-wallet card with live ZBX + zUSD balances, direction toggle (Buy / Sell), amount input with 25/50/75/MAX (with 0.01 ZBX gas reserve), debounced live `zbx_swapQuote` (350ms), slippage picker (0.5/1/3/5/custom %), price-impact warnings (amber ≥1%, red ≥5%), insufficient-balance + insufficient-gas validation (both directions need fee in ZBX), pool reserves card, "How it works" sidebar, `RecentSwapsPanel` (auto-polls every 5s, on-chain index badge). Wired into `App.tsx` (`<Route path="/swap" component={SwapPage} />`) and `LIVE_NAV` sidebar.
- **Status** — Replit-side build/test passes (TS clean, e2e Playwright passes all assertions). VPS deploy of new chain binary still pending — until then the live pool/quote/recent-swap RPCs return method-not-found and the panel shows "Loading pool…".

### Phase B.9 — On-chain Recent-Tx Index (Apr 24, 2026) ✅

Eliminates the need for dashboards/wallets to scan thousands of blocks just to display the last N transactions.

- **`state.rs`** — New `RecentTxRecord` struct (seq, height, ts, hash, from, to, amount, fee, nonce, kind_index). RocksDB-backed ring buffer in `CF_META` under `rtx/<seq_be8>` keys with monotonic counter `rtx_seq`. Capacity `RECENT_TX_CAP = 1000` (rolling — oldest is auto-evicted on insert past cap). Methods: `State::recent_txs(limit)`, `State::recent_tx_total()`, internal `push_recent_tx()`. `apply_block` automatically pushes one record per applied tx (failure logs but does NOT abort block apply — index is best-effort metadata, not consensus state).
- **`rpc.rs`** — New `zbx_recentTxs(limit=15, max=1000)` returns `{ returned, stored, total_indexed, max_cap, txs[] }`. O(N) point lookups, sub-millisecond response.
- **`api-server/src/routes/rpc.ts`** — Whitelisted `zbx_recentTxs`.
- **Dashboard `RecentTxsPanel`** — Now fast-path tries `zbx_recentTxs` first (auto-polls every 3s when on index path); falls back to legacy block-scan only if RPC unavailable. Header label distinguishes "on-chain index" vs "scanned X blocks". Existing scan logic kept as resilience fallback.

### Known follow-ups

- **B.3.1.5 VPS re-init COMPLETE (Apr 22, 2026)**: backups taken (`/root/zebvix-backups/preB315-*`), `.zebvix` and `.zebvix2` data dirs wiped, both re-init'd with deterministic genesis. Node-2's `validator.key` was inside `.zebvix2/` and got wiped — restored from backup tarball (same pubkey `0xde996e74...` so the earlier `validator-add` tx still matches). Both nodes now on identical chain, genuine 2/2 quorum.

### VPS topology

- Host: `root@srv1266996` (`hstgr.cloud`)
- Source: `/home/zebvix-chain/`
- Node-1 (founder/proposer): home `/root/.zebvix`, RPC `127.0.0.1:8545`, P2P `30333`, validator key `/home/zebvix-chain/validator.key`, systemd unit `zebvix.service`
- Node-2 (follower): home `/home/zebvix-chain/.zebvix2`, RPC `127.0.0.1:8546`, P2P `30334`, validator key `/home/zebvix-chain/.zebvix2/validator.key`, runs via `nohup` → `/var/log/zebvix2.log`
- CLI flag is `--rpc` (NOT `--rpc-addr`)
- Founder/admin address: `0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc`
- Founder pubkey: `0xaa9f6c1f047126b58bdfe62d7adc2ad04ec36d83b9391d313022fbd50cb5d097`
- Node-2 address: `0xbdfbec5d0fbed5fe902520fcca793c0157ea0d48`
- Node-2 pubkey: `0xde996e74285312a38885abd1da3aa27b9e7549f11dd67c485d1671b29832fe75`
- `MIN_TX_FEE_WEI` ≈ 0.00105 ZBX. Validator-tx default fee is `0.002` (above min).
- Deploy flow: build tar in `artifacts/sui-fork-dashboard/public/zebvix-chain-source.tar.gz`, `wget` from public Replit URL, `cargo build --release`, `cp` binary to `/usr/local/bin/`, `systemctl restart zebvix`.

### Mobile wallet + QR pairing (Apr 23, 2026) ✅

- **Pairing relay** — `artifacts/api-server/src/routes/pair.ts` — store-and-forward
  `/api/pair/{init,state,connect,request,poll,respond,result,disconnect}` with
  in-memory sessions + 15min TTL. No keys ever touch the relay.
- **Dashboard page** — `/connect-wallet` (sidebar: *Connect Mobile Wallet*) —
  generates ephemeral session, renders QR (`zbxconnect:` + base64url JSON),
  polls connection state, lets the user push **transfer / swap / multisig_approve / message**
  sign requests to the paired phone and shows the returned tx hash + signature.
- **Flutter wallet** — `mobile/zebvix-wallet/` — full app:
  - Onboarding: BIP39 mnemonic create / import, encrypted at rest via
    `flutter_secure_storage`.
  - Wallet tab: balance hero (liquid + staked + locked + zUSD), send / receive
    with QR.
  - Swap tab: ZBX ↔ zUSD via on-chain AMM pool tx.
  - Multisig tab: M-of-N create, lookup existing, approve pending proposals.
  - Connect tab: scans the dashboard QR, listens for sign requests, shows an
    approval bottom-sheet, signs (secp256k1 ECDSA over keccak256 of canonical
    JSON) and sends the result back via the relay.
  - Settings: RPC endpoint switcher (default `https://93.127.213.192:8545`),
    relay base URL, biometric toggle, sign-out.
- **Build flow** (Replit cannot render Flutter): user runs
  `flutter create --project-name zebvix_wallet --platforms=android,ios,web .`
  inside `mobile/zebvix-wallet/` then `flutter pub get && flutter run`.
- **Pending**: real BLS / chain-spec verification of the canonical-json signing
  format vs `zebvix-chain` `tx.rs`; fiat on-ramp (Buy/Sell currently routes
  through swap pool only).

## Phase B.11 — secp256k1 / ETH-compatible address cutover (2026-04-24)

**Goal:** one ETH private key (e.g. MetaMask) → same 20-byte address on both
Ethereum and Zebvix. Removes the friction of users having to manage two
separate keypairs.

**What changed (BREAKING — VPS chain re-genesis required, no backward compat):**

- Crypto curve: **Ed25519 → secp256k1 (ECDSA)**.
  - Rust: `ed25519-dalek` removed, `k256 = "0.13"` added.
  - JS dashboard: `@noble/curves/ed25519` → `@noble/curves/secp256k1`.
- Address derivation: now ETH-standard
  `keccak256(uncompressed_pubkey[1..])[12..]` (was: `keccak256(ed_pubkey)[12..]`).
- Wire format: `SignedTx.pubkey` and `Vote.pubkey` grew **32B → 33B** (compressed
  SEC1, `0x02|0x03 || X`). Signature stays 64-byte compact (`r || s`, low-S
  normalized via RFC6979 deterministic k — both `k256` and noble agree).
  - Transfer signed length: 248 → **249 bytes** (152 + 33 + 64).
  - Swap signed length: 268 → **269 bytes** (172 + 33 + 64).
- New deterministic founder (dev only — rotate to real ETH key on production):
  - secret    = `keccak256("zebvix-genesis-founder-v1")` =
    `0xa8674e60d95ec1fa2b37f264b01b8407d2fbb0789bd836382472d181973ebbf8`
  - pubC (33) = `0x035a3d7a0a8ce0607fa8a2ac3f36d4239ad9f582ca044a125d262f42eff3bcf9d3`
  - address   = `0x40907000ac0a1a73e4cd89889b4d7ee8980c0315`  (= new
    `tokenomics::ADMIN_ADDRESS_HEX` = founder = admin = governor at genesis)
  - This sk hex can be pasted directly into MetaMask to control the genesis admin.

**Files touched (chain):** `Cargo.toml`, `src/crypto.rs` (full rewrite, includes
embedded ETH test vector for sk=`0x46…46` → `0x9d8a…5a4f` — Vitalik's standard
addr), `src/types.rs` (added `pub mod hex_array_33`), `src/transaction.rs`,
`src/staking.rs`, `src/vote.rs`, `src/consensus.rs`, `src/main.rs`,
`src/bin/zbx.rs`, `src/tokenomics.rs`.

**Files touched (dashboard):** `artifacts/sui-fork-dashboard/src/lib/web-wallet.ts`
— `publicKeyFromSeed` returns 33B compressed; new
`uncompressedPublicKeyFromSeed`; `addressFromPublic` decompresses via
`secp256k1.Point.fromBytes(pub).toBytes(false)` then keccak; signing uses
`secp256k1.sign(sha256(body), seed, { lowS: true })` (Rust k256's
`SigningKey::sign` pre-hashes with SHA-256 internally — JS must match).

**Verification done locally (the Rust crate could not be `cargo build`-ed in
this env — libclang issue — but is structurally consistent and must be built
on the VPS):**
- ETH test vector: sk=`0x4646…4646` → `0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f` ✓
- Founder seed deterministically derives `0x40907000…0315` matching tokenomics.rs ✓
- TS dashboard: `tsc --noEmit` clean ✓
- Sign+verify roundtrip + RFC6979 determinism + low-S confirmed ✓

**VPS deploy: COMPLETED 2026-04-24 on srv1266996 (93.127.213.192).**
Live verification:
- `eth_chainId` → `0x1ec6` (= 7878) ✓
- `zbx_chainInfo` → `{chain_id:7878, name:"Zebvix", token:"ZBX", block_time_secs:5}` ✓
- `zbx_getValidator(0x40907000…0315)` → pubkey `0x035a3d7a…bcf9d3` (33B, `0x03` compressed prefix confirms secp256k1) ✓
- Node-1 producer running, P2P listening on `/ip4/93.127.213.192/tcp/30333` ✓
- RPC on `0.0.0.0:8545`, peer_id `12D3KooWF6xTRn7idjv1hiJz5eP9eb4Dd8Zg6fDiZuULvyeGT8MV`

Compile fixes applied during VPS build (all merged into live tarball at
`attached_assets/downloads/zebvix-chain-b11.tar.gz`, served by
`/api/download/newchain`):
- `[u8; 33]` needs explicit `#[serde(with = "crate::types::hex_array_33")]` —
  added to `TxKind::ValidatorAdd::pubkey` + `StakeOp::CreateValidator::pubkey`.
- `ValidatorState` cannot derive `Default` (`[u8;33]` lacks it) — manual
  `impl Default` with all-zero pubkey.
- `mempool::snapshot()` match needed `TxKind::Swap { .. } => 8` arm.
- 3 `return err/ok(...)` calls in `rpc::handle()` needed `axum::Json(...)` wrap.
- `state.rs` swap zUSD-insufficient branch: capture `from.zusd` into local
  before `swap_refund(&mut from, format!(...))` (E0502 borrow checker).
- Removed unused `ToEncodedPoint` import in `crypto.rs`.

**Next:** import founder secret
(`0xa8674e60d95ec1fa2b37f264b01b8407d2fbb0789bd836382472d181973ebbf8`) into
MetaMask → switch network to chain_id 7878 RPC `http://93.127.213.192:8545`
→ admin/governor controls (validator-add, pool genesis, swap, payid registry)
all signable from the same ETH key.

## Phase B.12 — BEP20 / EVM bridge module (2026-04-24) ✅ (Replit-side; VPS deploy pending)

**Goal:** make Zebvix bridge-able to BNB Chain (BEP20), Ethereum, Polygon and
arbitrary external networks via an admin-extensible on-chain registry +
lock/release pattern. No off-chain hard-coding — admin can add new networks
and assets purely via signed CLI/RPC tx.

**Design (single-trusted-oracle, lock/release):**
- New on-chain `bridge` module with two registries (`BridgeNetwork`,
  `BridgeAsset`), one events log (`BridgeOutEvent`), and one used-claim set
  (replay protection for inbound).
- `asset_id = (network_id as u64) << 32 | local_seq` — 64-bit deterministic id.
- Outbound (`BridgeOut`): user signs tx, chain debits `from.{zbx|zusd}`, credits
  the system **lock vault** at address `0x7a62726467…0000` (constant
  `BRIDGE_LOCK_ADDRESS_HEX`), and emits a `BridgeOutEvent` indexed by
  `b/e/<seq>` for the off-chain relayer to mint on the destination chain.
- Inbound (`BridgeIn`): admin/oracle signs tx with `(asset_id,
  source_tx_hash[32], recipient, amount)`. Chain checks `b/c/<asset_id>/<hash>`
  is unused (replay protection), debits the lock vault, credits recipient,
  marks the claim used. The admin's own gas fee is refunded inside the same
  apply, so the oracle is fee-neutral.
- Single trusted oracle: only `tokenomics::ADMIN_ADDRESS_HEX` may
  Register/SetActive/BridgeIn. Multi-sig oracle is a future upgrade (phase B.13).

**On-chain TxKind extension (consensus-breaking — re-genesis required):**
- Added `TxKind::Bridge(BridgeOp)` at end of enum (tag_index=9, variant_name
  `"bridge"`); preserves bincode discriminants for prior 0–8 variants so old
  signed-tx decoding stays byte-identical.
- `BridgeOp` enum variants: `RegisterNetwork`, `SetNetworkActive`,
  `RegisterAsset`, `SetAssetActive`, `BridgeOut`, `BridgeIn`.

**Storage layout (`CF_META`):**
- `b/n/<network_id_be>` → `BridgeNetwork`
- `b/a/<asset_id_be>`   → `BridgeAsset`
- `b/c/<asset_id_be>/<source_tx_hash>` → `[1]` (claim used marker)
- `b/e/<event_seq_be>`  → `BridgeOutEvent`
- `b/m/seq`             → next event seq (u64 BE)
- `b/m/lz`, `b/m/lu`    → locked ZBX wei (u128 BE) / locked zUSD (u128 BE)
- `b/m/cu`              → claims-used counter
- `b/m/aid/<network_id_be>` → next local-seq for that network (u32 BE)

**RPCs (7 read-only):** `zbx_listBridgeNetworks`, `zbx_getBridgeNetwork`,
`zbx_listBridgeAssets` (optional `network_id` filter), `zbx_getBridgeAsset`,
`zbx_recentBridgeOutEvents` (capped 100), `zbx_isBridgeClaimUsed`,
`zbx_bridgeStats` (totals + lock vault address).

**CLI (8 verbs):** `bridge-register-network`, `bridge-set-network-active`,
`bridge-register-asset`, `bridge-out`, `bridge-in`, `bridge-networks`,
`bridge-assets`, `bridge-stats`. Outbound/inbound auto-scale amount based on
asset's `native` (ZBX→18 dec wei, zUSD→6 dec micro-units) via a one-shot
`zbx_getBridgeAsset` lookup.

**Files touched (chain):**
- NEW: `src/bridge.rs` (~430 lines: types, validators, helpers, unit tests).
- `src/lib.rs` — `pub mod bridge`.
- `src/transaction.rs` — `TxKind::Bridge(BridgeOp)` variant; tag_index=9.
- `src/mempool.rs` — match arm `Bridge(_) => 9`.
- `src/tokenomics.rs` — `BRIDGE_LOCK_ADDRESS_HEX`.
- `src/state.rs` — storage helper methods + apply_tx Bridge arm (~250 lines)
  handling all 6 ops (admin gating, zUSD pre-debit refund pattern, lock vault
  accounting, replay protection).
- `src/rpc.rs` — 7 bridge endpoints.
- `src/main.rs` — 8 `Cmd::Bridge*` variants + dispatch arms + 8 async
  `cmd_bridge_*` functions, plus parsers (`parse_network_kind`,
  `parse_native_asset`, `parse_zusd_amount`, `parse_source_tx_hash`).

**Verification (Replit-side):**
- Local cargo check could not run (libclang issue, same as B.11) — relies on
  VPS build. Code is structurally consistent with prior modules (multisig,
  swap, payid all use identical `prefix_iterator_cf` + `bincode` patterns).
- Tarball at `/api/download/newchain` (113 KB) confirmed to include
  `bridge.rs`, modified `state.rs`, `tokenomics.rs`.

**VPS deploy commands (next session, on srv1266996):**
```bash
# 1. fetch new tarball
cd ~ && rm -rf zebvix-chain-old && mv zebvix-chain zebvix-chain-old || true
curl -sL "https://<replit-domain>/api/download/newchain" -o newchain.tgz
tar xzf newchain.tgz && cd zebvix-chain
# 2. rebuild
cargo build --release
# 3. re-genesis (consensus-breaking — TxKind extended)
sudo systemctl stop zebvix-node-1
rm -rf ~/.zebvix/data ~/.zebvix/genesis.json
./target/release/zebvix-node init --chain-id 7878 \
  --founder-secret 0xa8674e60d95ec1fa2b37f264b01b8407d2fbb0789bd836382472d181973ebbf8
sudo systemctl start zebvix-node-1
# 4. smoke-test bridge
./target/release/zbx bridge-stats --rpc-url http://127.0.0.1:8545
./target/release/zbx bridge-register-network \
  --signer-key ~/.zebvix/founder.key --id 56 --name "BNB Chain" \
  --kind evm --rpc-url http://127.0.0.1:8545 --fee auto
./target/release/zbx bridge-register-asset \
  --signer-key ~/.zebvix/founder.key --network-id 56 --native zbx \
  --contract 0x0000000000000000000000000000000000000000 --decimals 18 \
  --rpc-url http://127.0.0.1:8545 --fee auto
./target/release/zbx bridge-networks --rpc-url http://127.0.0.1:8545
```
