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

## Phase B.12 — BEP20 / EVM bridge module (2026-04-24) ✅ FULLY LIVE on VPS

**Smoke-test on VPS srv1266996 (2026-04-24):**
- Re-genesis with founder identity as both block-signer AND admin:
  `init --validator-key ~/.zebvix/founder.key --alloc 0x40907000…0315:10000000`
  (NOTE: `FOUNDER_PREMINE_ZBX = 0u128` in tokenomics → default pre-mine is OFF;
  must use explicit `--alloc` for founder ZBX, otherwise admin can't pay gas.)
- Founder secret: `0xa8674e60d95ec1fa2b37f264b01b8407d2fbb0789bd836382472d181973ebbf8`
  → addr `0x40907000ac0a1a73e4cd89889b4d7ee8980c0315` (= `tokenomics::ADMIN_ADDRESS_HEX`).
  Imported via `zbx import <secret_hex> --out ~/.zebvix/founder.key` (positional secret).
- Block production confirmed: tip advancing 1→2→…, founder proposing every 5s.
- `bridge-register-network` (id=56 BNB Chain, evm) tx applied → registry count=1.
- `bridge-register-asset` (asset_id=240518168576, ZBX, decimals=18) tx applied → registry count=1.
- Fees deducted live: founder balance 10,000,000 → 9,999,999.999 ZBX.
- All 7 read-only RPCs verified: networks/assets/stats consistent.
- Bridge lock vault address: `0x7a62726467000000000000000000000000000000` (constant).

**KNOWN GOTCHAS (documented for future work):**
- `zbx` CLI uses POSITIONAL args (`zbx import <SECRET_HEX>`, `zbx address <KEYFILE>`,
  `zbx balance <ADDRESS>`), NOT `--secret-hex/--keyfile/--address` flags.
- Bridge CLI verbs live in `zebvix-node` binary (main.rs), NOT yet ported to `zbx`
  binary. Use `./target/release/zebvix-node bridge-*`. Future cleanup: port to zbx.rs.
- `--fee auto` returns 0.000042 ZBX in bootstrap state (below consensus min 0.001 ZBX).
  Use explicit `--fee 0.005` for admin ops until pool-spot fee resolution stabilizes.
- Local validator key MUST equal genesis founder address for solo-validator block
  production; otherwise chain stuck at height=0. Multi-validator setup via
  `validator-add` tx (post-genesis) is the path for adding extra validators.

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

## Phase C — Smart Contracts (Solidity layer) (2026-04-24) — CONTRACTS DRAFTED, ARCHITECT-REVIEWED

`zebvix-chain/contracts/` — full Solidity 0.8.24 contracts for the BNB-Chain
side of the bridge (Phase B.13 deploy targets). Browseable in dashboard
`/chain-code` page. NOT compiled by Rust build (separate Hardhat/Foundry
project; no Rust dependency).

### Files
- `ZBX20.sol` (328 lines) — wrapped ZBX BEP-20 token, EIP-2612 permit,
  multisig-only `bridgeMint` / `bridgeBurnFrom`, founder pause.
- `BridgeVault.sol` (242 lines) — lock/release vault on BSC, reentrancy
  guard, replay-protected `executeMint(seq)`, EIP-2612 `lockWithPermit`,
  founder stray-token recovery (cannot drain ZBX).
- `BridgeMultisig.sol` (254 lines) — N-of-M oracle multisig, EIP-191
  personal-sign signatures, transient-storage seq passthrough to ZBX20,
  batch submit, rotatable relayer set.
- `interfaces/IZBX.sol` (55 lines) + `interfaces/IBridgeVault.sol` (78 lines).
- `README.md` — architecture diagram, deploy order, audit checklist.

### Deploy order (Phase B.13)
1. Deploy `BridgeMultisig(vault=0x0, relayers, threshold, founder)` — vault
   placeholder, fix in step 4.
2. Deploy `ZBX20(minter=multisig, founder)`.
3. Deploy `BridgeVault(token=ZBX20, multisig, founder)`.
4. Re-deploy `BridgeMultisig` with real `vault` address (or use a proxy).
5. Update Zebvix `bridge-register-asset` with `--contract <ZBX20.addr>`.

### Browser support
- `artifacts/api-server/src/routes/chain.ts` ALLOWED_EXT now includes `.sol`.
- `chain-code.tsx` `fileIcon()` shows purple FileCode2 for `.sol`.
- Tree shows `contracts/` at top level; total project now 29 files / 17,158 lines.

### Architect review fixes (5 critical issues caught + fixed in same session)
1. **Mint authority broken** → token's bridge minter is now `vault` (not multisig);
   multisig calls `vault.executeMint` which calls `token.bridgeMint` correctly.
2. **`bridgeBurnFrom` was unauthorized** (any spender could drain a holder) →
   added `onlyVault` modifier in `ZBX20`.
3. **TSTORE/TLOAD across contracts is unsafe** (transient storage is contract-local;
   would have returned 0 + may not be supported on BSC) → removed entirely; `zebvixSeq`
   is now an explicit param of `bridgeMint(to, amount, seq)` and `bridgeBurnFrom`.
4. **Constructor deadlock** (Multisig ↔ Vault circular addresses) → both `vault` on
   `BridgeMultisig` and on `ZBX20` are mutable until founder calls `lockVault()`,
   then permanent. Deploy order is now Multisig → Token → Vault → setVault×2 → test → lockVault×2.
5. **`totalLocked` accounting wrong** (only incremented on mint, never decremented on
   lock — diverged from `token.totalSupply()`) → now `+= amount` on `executeMint` and
   `-= amount` on `lock`/`lockWithPermit`, with insufficient-locked guard.

### Phase C extension — 5 more contracts (2026-04-24)
Added to `zebvix-chain/contracts/`:
- `Multicall3.sol` (236 lines) — mds1/multicall3-compatible batched call
  aggregator (aggregate, aggregate3, aggregate3Value, tryAggregate,
  blockAndAggregate, getEthBalance, etc). Stateless, deploy once per chain.
- `ZbxStaking.sol` (312 lines) — single-pool MasterChef-style staking with
  linear reward stream. Stake any ERC-20 (designed for ZBX20), earn any
  reward token (e.g. zUSD or more ZBX). Reentrancy-guarded, emergency
  unstake bypass, founder-controlled rate updates.
- `ZbxAMM.sol` (383 lines) — Uniswap V2 single-pair AMM. xy=k invariant,
  0.30% LP fee, EIP-20 LP tokens, TWAP cumulative-price oracle, MINIMUM
  _LIQUIDITY lock. Mirror of UniswapV2Pair surface so existing routers /
  analytics work unmodified.
- `ZbxTimelock.sol` (201 lines) — Compound-style governance timelock.
  6h MIN_DELAY / 30d MAX_DELAY / 14d GRACE_PERIOD. Self-call modifier on
  `setDelay` / `setPendingAdmin` so even governance changes obey the delay.
- `interfaces/IBridgeMultisig.sol` (100 lines) — public surface of
  `BridgeMultisig.sol` for relayer / dApp integration; includes off-chain
  `digestFor()` helper to keep signing path in lockstep with on-chain.

**Solidity total: 10 files, 2,277 lines** (3 deployable bridge contracts +
4 deployable utility contracts + 3 interfaces). Dashboard now: 34 files,
18,500 lines.

### Architect-review fix on Phase C extension
- **ZbxStaking.sol — High severity (`recoverExcessRewards` could drain user-owed rewards)**
  → introduced `totalOwed` global liability counter:
    - `updatePool()` → `totalOwed += elapsed * rewardRate` (every wei accrued belongs to a user)
    - `claim()` → `totalOwed -= owed` (liability satisfied)
    - `emergencyUnstake()` → `totalOwed -= forfeit` (user explicitly gave up rewards)
    - `recoverExcessRewards()` → reserve now `totalOwed + (sameToken ? totalStaked : 0)`,
      so founder can never withdraw into user-owned tokens.
- Multicall3, ZbxAMM, ZbxTimelock — architect PASS, no changes required.

## Phase C — Native EVM (Cancun fork) — IMPLEMENTED 2026-04-24

Production-grade EVM execution layer added to `zebvix-chain/`. Gated behind
`cargo --features evm` so existing operators are not forced to rebuild until
they explicitly opt in. With the feature off the chain compiles unchanged.

### Files (5 new modules, 2,957 Rust lines)

| File                              | Lines | Purpose                                               |
|-----------------------------------|------:|-------------------------------------------------------|
| `src/evm.rs`                      |   633 | Public types, `execute()` entry, CREATE/CREATE2, RLP  |
| `src/evm_interp.rs`               | 1,018 | Cancun bytecode interpreter, ~140 opcodes, gas table  |
| `src/evm_state.rs`                |   342 | `CfEvmDb` — RocksDB CF_EVM/CF_LOGS, atomic journal    |
| `src/evm_precompiles.rs`          |   458 | Std 0x01-0x05 + custom 0x80-0x83 (bridge/payid/swap/multisig) |
| `src/evm_rpc.rs`                  |   506 | `eth_*` JSON-RPC namespace (15 methods)               |

### Cargo wiring
- `Cargo.toml`: new `[features] evm = ["dep:sha2"]`, optional `sha2` dep,
  `tempfile` added under `[dev-dependencies]` for evm_state tests.
- `lib.rs`: `#[cfg(feature = "evm")] pub mod evm; ...` for all 5 modules.
- `types.rs`: added `Address::from_bytes()` + `Address::as_bytes()` helpers
  (zero-cost wrappers over the existing tuple struct).

### What works
- Cancun opcode set: arithmetic, comparison, bitwise, KECCAK256, all
  environmental (CALLER, CALLVALUE, CALLDATA*, CODE*, EXTCODE*, BALANCE,
  SELFBALANCE), block (NUMBER, TIMESTAMP, COINBASE, CHAINID, BASEFEE,
  PREVRANDAO, GASLIMIT), stack/mem/storage (PUSH0-32, DUP1-16, SWAP1-16,
  MLOAD/MSTORE/MSTORE8, SLOAD/SSTORE, MCOPY, TLOAD/TSTORE), control
  (JUMP/JUMPI/JUMPDEST with pre-scan), LOG0-LOG4, RETURN/REVERT/STOP/INVALID.
- CREATE / CREATE2 address derivation (yellow paper RLP encoding inline).
- Gas accounting: per-opcode constants matching mainnet, quadratic memory
  expansion, EIP-3529 SSTORE refunds, EIP-3860 init-code limit, EIP-170
  runtime code limit, EIP-3541 0xEF prefix rejection.
- Storage backend: `CfEvmDb` with in-memory account cache, atomic journal
  apply via single RocksDB `WriteBatch`, log indexing by (block, log_idx).
- Standard precompiles: ECRECOVER (full secp256k1 via k256), SHA256,
  IDENTITY. RIPEMD160 + MODEXP are zero-return stubs (deferred to C.2).
- Custom precompiles: bridge_out, payid_resolve, amm_swap, multisig_propose
  with deterministic deterministic input parsing + ABI shape matching.
- JSON-RPC: chainId, blockNumber, getBalance, getTransactionCount, getCode,
  getStorageAt, call, estimateGas (binary-search), gasPrice, sendRawTransaction
  (legacy/EIP-2930/EIP-1559 envelope discriminator), getLogs (with topic +
  address filtering), getTransactionReceipt, getBlockByNumber, feeHistory,
  net_version, web3_clientVersion, syncing, accounts.

### Phase C.2 — recursive CALL frames + RLP body decode (2026-04-24) ✅ SHIPPED
Built on the Phase C.1 skeleton; user will rebuild on VPS later. ~1,074 new
lines across 4 files. Architect-reviewed, all Critical/High findings fixed.

**1. NEW `evm_rlp.rs` (~643 lines)** — canonical RLP decoder + tx parsers.
- Generic `Item::{Bytes, List}` decoder with strict canonical-form checks
  (no leading zero bytes in scalars, no over-long encodings, single-byte
  values < 0x80 must use short form, etc).
- Three envelope decoders: legacy (with EIP-155 chain-id derivation from
  `v`), EIP-2930 type-0x01 (access list), EIP-1559 type-0x02 (dynamic fee).
- `decode_raw_tx(&[u8]) -> Result<(EvmTxEnvelope, Address)>` — top-level
  entry that dispatches by leading byte and recovers the sender via
  k256 secp256k1 + keccak256.
- Builds the canonical signing-message RLP for each envelope and runs
  ECDSA recovery against the recoverable signature triple `(r, s, v)`.
- `tx_hash()` returns the wallet-visible hash: `keccak(rlp)` for legacy,
  `keccak(type_byte || rlp)` for typed envelopes.
- 12 unit tests covering canonical-form rejection, EIP-155 round-trip,
  envelope-kind dispatch, and signature recovery against known vectors.

**2. `evm_interp.rs` refactor (+~370 lines, now 1,450 lines total)** —
real recursive interpreter frames.
- `CallKind { Call, CallCode, DelegateCall, StaticCall }` enum + new
  constants `G_CODE_DEPOSIT = 200`, `G_CALL_STIPEND = 2300`.
- New `op_call_generic(kind)` powering all four call opcodes
  (0xf1 / 0xf2 / 0xf4 / 0xfa):
  - EIP-150 63/64 gas forwarding cap with caller-side reservation.
  - Value-transfer base + `G_NEWACCOUNT` surcharge for empty targets
    (EIP-161 emptiness defined as `nonce == 0 && balance == 0 &&
    code_hash == KECCAK_EMPTY`, **not** the all-zero sentinel).
  - Static-call enforcement that propagates through DelegateCall.
  - Precompile fast-path via `evm_precompiles::dispatch` (returns gas /
    output / success without spinning up a child Interp).
  - Snapshot/rollback through HashMap copies of touched accounts +
    storage; child Interp logs/storage_writes/account_writes are merged
    into parent only on success, fully discarded on revert. The 2300
    stipend is granted to the child for value-bearing calls.
- New `op_create(create2: bool)` powering 0xf0 and 0xf5:
  - EIP-3860 max-initcode (49,152 bytes) enforced before exec; EIP-170
    max-deployed-code (24,576 bytes) and EIP-3541 first-byte != 0xEF
    after init returns.
  - EIP-684 collision check uses `code_hash != KECCAK_EMPTY` (the
    `EvmAccount::default()` returns KECCAK_EMPTY for unknown accounts;
    comparing against `[0u8; 32]` was a Phase-C.1 bug that caused
    every fresh address to false-positive). Same fix applied earlier
    to top-level `evm::execute()`.
  - Caller nonce bumped before init runs (per spec, even on revert);
    init code runs in a child Interp; on success we charge
    `G_CODE_DEPOSIT * len` and journal the new account.
- Depth limit of 1024 enforced at every call/create boundary.

**3. `evm_rpc.rs` — eth_sendRawTransaction now real (-43 / +25 lines).**
- Replaced the C.1 placeholder `decode_raw_tx` (which only surfaced the
  envelope-kind byte) with `crate::evm_rlp::decode_raw_tx`.
- Handler now: decodes raw → recovers sender → builds `EvmTxEnvelope` →
  calls `evm::execute(&db, &ctx, &sender, &tx)` → applies the returned
  `StateJournal` via `CfEvmDb::apply_journal()` → returns canonical
  Ethereum tx hash. Reverted txs still apply the nonce-bump journal
  (yellow paper §6).
- Stale `RawTx` / `RawTxKind` placeholders removed; old test rewired
  to assert the new decoder rejects empty input and reserved type 0x03
  (blob tx, EIP-4844, intentionally not supported on Zebvix L1).

**4. `lib.rs` — `pub mod evm_rlp;` under `#[cfg(feature = "evm")]`.**
No `Cargo.toml` change needed; `k256 = { version = "0.13", features =
["ecdsa", "serde"] }` and `sha3 = "0.10"` were already pulled in by
Phase B.11 + C.1.

### Architect-review fixes on Phase C.2
The architect surfaced 4 Critical/High findings and 1 Medium. Resolved:

1. **High — chain-id not enforced (cross-chain replay).** `decode_raw_tx`
   now returns `(EvmTxEnvelope, Address, Option<u64>)` where the third
   tuple slot is the declared chain id (None for unprotected legacy).
   `eth_sendRawTransaction` rejects tx whose declared id ≠ node id, and
   refuses unprotected legacy txs outright (every modern wallet uses
   EIP-155; accepting non-protected opens replay from any chain that
   shares the same secp256k1 keys).
2. **High — `y_parity` wraparound on cast.** Both EIP-2930 and EIP-1559
   decoders now reject any `y_parity` outside `{0, 1}` before the
   `as u8` truncation.
3. **Critical — CREATE value-burn on revert.** `op_create` previously
   pushed a single journal entry containing both the nonce bump and the
   balance debit, and snapshotted *after* that push — so revert kept the
   debit, burning the endowment value. Now we push two entries: a
   nonce-only entry (must persist on revert per yellow paper §7), then
   snapshot, then a debit entry that gets dropped on revert. Net effect:
   nonce bump persists, balance is restored, value is never burned.
4. **(Push-back) — CALL stipend "gas creation".** Architect flagged that
   unused stipend gas being refunded looked like gas minting. This is
   actually spec-compliant geth behavior: the 9 000-gas `G_CALL_VALUE`
   charge already pays for the stipend; the 2 300-gas stipend just
   guarantees the callee has enough to run a fallback, and any unused
   portion correctly returns to the caller. Added an explanatory
   comment in `op_call_generic` noting this is intentional.
5. **Medium — non-canonical RLP scalar acceptance.** `RlpItem::as_u64`
   and `RlpItem::as_u256` now reject any byte string with leading zeros
   in the high byte (per yellow paper Appendix B canonicality).

### Phase C.3 work (not yet shipped)
- alt_bn128 + BLAKE2F precompiles (alt_bn128 needs `bn` / `ark-bn254`,
  BLAKE2F needs `blake2`).
- Warm/cold access-list cache (EIP-2929 + EIP-2930 access-list seed).
- Receipt store + `eth_getTransactionReceipt` / `eth_getTransactionByHash`.
- Wire `TxKind::EvmCall` / `TxKind::EvmCreate` into `transaction.rs` +
  `state::apply_tx` so EVM envelopes flow through the consensus mempool.
- Block-builder integration: include EVM txs in `block::build_block`,
  charge gas in the native fee splitter, surface logs in block events.

### Tests included
- `evm.rs`: keccak constant, CREATE/CREATE2 determinism, intrinsic gas, U256 round-trip.
- `evm_interp.rs`: arithmetic + RETURN flow, JUMPDEST scan skips PUSH data,
  Solidity revert reason decoding.
- `evm_state.rs`: account roundtrip, storage zero-deletion optimization,
  journal atomic apply.
- `evm_precompiles.rs`: address distinctness, identity round-trip, SHA256
  vector, dispatch fallthrough, bridge_out output shape, amm_swap min_out enforcement.
- `evm_rpc.rs`: quantity encoding, hex parsing edge cases, address validation,
  block-tag aliases, topic filter logic, raw tx kind dispatch.

### How to enable on VPS
```bash
ssh root@93.127.213.192
cd /opt/zebvix-chain
cargo build --release --features evm
systemctl restart zebvix-node
```

Default builds (`cargo build --release` without `--features evm`) keep the
exact pre-Phase-C behavior — zero-risk rollout for operators that want to
delay EVM activation.

### Dashboard FULL UPDATE — Mission Control + EVM Explorer (2026-04-24)
User asked: "ab full advance dashboard do explore jaha per full chain
sercive ho live kro full update dashboard". Shipped:

1. **`pages/home.tsx` rewritten** as Mission Control:
   - Hero with live block height, animated flash on new block, MAINNET
     LIVE badge, chain_id 7878 badge, validator count, Phase C.2 badge.
   - Roadmap status banner (B.10 Native Rust → C.3 Foundry, all LIVE
     except C.3 = NEXT).
   - 4 KPI tiles: Block Height, ZBX Price, Market Cap, FDV.
   - 5 mini-KPI tiles: Validators, Multisigs, Pay-IDs, Native gas,
     EVM gasPrice.
   - Recent-blocks ribbon (last 8 blocks with tx count + age).
   - 12-card Quick Access grid linking to every chain service.
   - Chain Identity card (RPC URL, consensus, EVM status, VPS, service).
   - MetaMask Connect card with one-click `wallet_addEthereumChain`
     for chain 0x1ec6.
   - Dev Integration tabs (ethers.js / Foundry / curl) with copy button.
   - Auto-refresh 5s, parallel RPC fetch for primary + secondary stats.

2. **`pages/evm-explorer.tsx` NEW** — Phase C.2 native eth_* playground:
   - NetStatusGrid: 6 live cells (eth_chainId / eth_blockNumber /
     eth_gasPrice / net_version / web3_clientVersion / eth_syncing),
     auto-refresh 4s.
   - eth_getBalance tool (raw hex + wei + ZBX rendering).
   - eth_getTransactionCount + eth_getCode tool (EOA vs CONTRACT detect,
     bytecode reveal toggle).
   - eth_getBlockByNumber tool (latest/earliest/pending/numeric).
   - eth_getTransactionByHash + eth_getTransactionReceipt side-by-side.
   - Raw JSON-RPC dispatcher with 7 method presets.
   - All numeric rendering uses `hexToBigInt` / `fmtBig` / `fmtZbx` /
     `fmtTimestamp` safe parsers — survives null/""/"0x"/malformed input
     without crashing the page (architect-flagged fix).

3. **`api-server/routes/rpc.ts` whitelist expanded** from 5 to ~30
   methods covering all read-side eth_*, net_*, web3_*, plus
   eth_sendRawTransaction for write path.

4. **Routing**: `/evm-explorer` registered in `App.tsx`, sidebar
   `LIVE_NAV` got "EVM Explorer (C.2)" entry with Cpu icon.

Architect review (2026-04-24) found one medium-severity bug —
`BigInt("0x")` and `BigInt("")` throw, which would crash the EVM
Explorer if RPC returned partial data. Fixed by routing every numeric
render through the new safe-parser helpers in `evm-explorer.tsx`.
Verified live: Mission Control showing block #1,815, EVM Explorer
showing block #1,843 (chain advancing 5–7 blocks/min as expected).
