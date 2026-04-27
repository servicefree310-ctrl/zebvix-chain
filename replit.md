# Overview

This project is a pnpm workspace monorepo for the Zebvix L1 blockchain, developed using TypeScript and Rust. It aims to be a high-performance, secure, scalable, and user-friendly platform featuring a Cancun-EVM-bytecode-compatible execution layer (ZVM), an integrated DeFi AMM (zSwap), robust governance, and seamless cross-chain bridging. Key capabilities include a custom L1 blockchain, an on-chain permissionless zSwap AMM, a comprehensive dashboard, mobile wallet connectivity, and a ZVM for smart contracts with zero-config compatibility with existing Ethereum tooling.

# User Preferences

Communicate in Hinglish with the user.

# System Architecture

## Monorepo Structure
The project is organized as a pnpm workspace monorepo with key packages for the core blockchain, API server, React-based dashboard, Flutter mobile wallet, and a TypeScript SDK.

## Core Technologies
The project utilizes Node.js 24, TypeScript 5.9, Express 5, and Rust for backend development. Data persistence is handled by PostgreSQL (off-chain) with Drizzle ORM and RocksDB (on-chain). Zod is used for validation, Orval for API codegen, and esbuild for the build system.

## Zebvix L1 Blockchain
The `zebvix-chain` is a Rust-based L1 blockchain featuring a 2-node P2P gossip sync consensus, RocksDB-backed validator registry, and Ed25569 votes (secp256k1 for ETH-compatible addresses). It supports various transaction types including `Transfer`, `ValidatorAdd/Remove`, `Swap`, `Bridge`, `Proposal`, and `TokenPool` operations. Tokenomics include a 150M ZBX supply with Bitcoin-style halving. The on-chain zSwap AMM follows `x·y=k` with a 0.3% fee and supports permissionless Uniswap V2-style TOKEN/ZBX pools. The blockchain includes a bridge module for cross-chain operations and a forkless on-chain governance system supporting various proposal types.

## ZVM (Zebvix Virtual Machine) Integration
The ZVM is a native Rust implementation that is Cancun-EVM-bytecode compatible, offering full Cancun opcode coverage and mainnet-matching gas accounting. It uses `CfZvmDb` backed by a RocksDB column family for storage. The system supports real `ZvmReceipt` persistence and log management, cross-domain settlement where `eth_getBalance` and `eth_getTransactionCount` return `max(zvm, native)`, and monetary gas accounting with pre-flight checks and post-frame refunds. Standard Ethereum precompiles are dispatched, and custom Zebvix precompiles handle native side-effects. The JSON-RPC wire protocol adheres to `eth_*` namespace with `zbx_*` aliases.

## User Interface (Dashboard)
The dashboard provides a Mission Control for chain stats, a ZVM Explorer, Pool Explorer, Tokenomics, Smart Contracts, Cross-Chain Bridge, Multisig Wallet Tools, and enhanced Balance Lookup. It includes ZBX Wallet functionality with native transfers, MetaMask integration, transaction tracking, and an "Import Wallet" feature. An Etherscan-style Block Explorer and an RPC Playground are also available. Users can register Pay-IDs for `handle@zbx` aliases and utilize a Staking Dashboard for delegator operations. The dashboard features a typed transaction decoder and allows for permissionless creation of ERC-20-style tokens.

## Zebvix Sites — Web3 Site Builder
A separate product artifact (`artifacts/zsites`, base path `/sites/`) that lets anyone describe a business and get a publishable Web3 site. Stack: Clerk auth, Anthropic (`claude-sonnet-4-5`) AI generator, block-based editor with 13 block types (nav/hero/features/pricing/testimonials/faq/cta/text/image/gallery/lead_form/crypto_checkout/footer), 5 polished templates (SaaS/NFT/Agency/Restaurant/Portfolio), 1-click publish to subdomain (`/sites/p/:subdomain`), built-in crypto checkout (ZBX/zUSD/BNB on Zebvix L1, chainId 7777) verified on-chain via `zbx_getEvmReceipt` with `eth_getTransactionReceipt` fallback, lead capture, and per-site analytics with daily traffic charts. Backend routes mounted under `/api/sites/*` from `artifacts/api-server`; database tables: `sites`, `leads`, `site_payments`, `page_views`.

## BSC ↔ Zebvix Bridge
This bridge replaces a single-admin attestation MVP with an M-of-N validator multisig for Zebvix → BSC mints. On BSC, `WrappedZBX` (ERC20) and `ZebvixBridge` contracts manage minting and burning. Off-chain, a `bridge-relayer` service polls for bridge events and aggregates M-of-N EIP-712 signatures for mints, while a `bridge-signer` daemon independently verifies transactions before signing. The dashboard integrates a `BscSidePanel` and a unified bridge UI for both directions, supporting in-browser secp256k1 key signing. The `api-server` provides endpoints for bridge configuration and relayer status.

## Security Hardening
Security measures include block forgery defense, mempool DoS hardening (balance checks, nonce windows, fee-priority eviction), and RPC security with CORS defaults to localhost-only. Slashing mechanisms are in place for double-signing. A bridge kill-switch (`zbx_bridgePaused`) allows administrators to halt new BridgeIn/BridgeOut flows. Operational hygiene emphasizes validator key file security, daily RocksDB snapshots, and RPC binding restrictions.

### BFT Commit-Gate Pipeline (Phase B.3.2.5, April 2026 — side-table architecture, Phase 2 wired)
The BFT commit gate uses a **side-table** layout, NOT in-block fields. `Block` and `BlockHeader` byte layouts are unchanged from chain inception, so existing RocksDB databases boot without any migration or wipe. BFT commits are persisted at `CF_META` key `bft/c/<32-byte block_hash>` as `bincode::serialize(&Vec<Vote>)`, accessed via `State::put_bft_commit(&block_hash, blob)` and `State::get_bft_commit(&block_hash)`. The verifier `vote::verify_last_commit_for_parent(parent_hash, parent_height, last_commit_bytes, chain_id, validators)` enforces per-vote sanity (chain_id / height / type / target / sig), dedup, validator-set membership, the 2/3+ voting-power quorum, and the genesis-adjacent rule (parent_height==0 → must be empty). The gate is wired into `state::apply_block` after the proposer signature check: it reads `get_bft_commit(parent_hash)` and verifies it when `block.header.height >= ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT` (default `u64::MAX` = OFF — single-validator devnet behavior unchanged).

**Phase 2 wiring (commit persistence):** `main::try_persist_bft_commit_for(state, pool, height, target_hash)` runs from BOTH vote-handling paths (the local emit task that signs Prevote+Precommit on every tip-advance, and the p2p inbound vote handler) on every `AddVoteResult::Inserted { reached_quorum: true }` for a Precommit. It calls `pool.collect_precommits_for(...)` (deterministic via sort by validator address, aggregates across all rounds), bincodes the `Vec<Vote>`, and writes via `put_bft_commit`. Logged at INFO as `📜 BFT commit persisted h=N hash=0x... precommits=K bytes=B` — operators grep this to confirm the pipeline is live. The local emit task initializes `last_emitted = tip.saturating_sub(1)` so a node restart re-emits + re-persists the commit for the existing tip block on the very first tick (idempotent: `pool.add` returns `Duplicate` for re-signed votes, RocksDB put overwrites with the same deterministic bytes).

**Phase 3 ops procedure (flip the gate ON):** Once the Phase B.3.2.5 binary is deployed and `📜 BFT commit persisted` is appearing on every block, the operator computes `ACTIVATION = current_tip + 100` (≈8min buffer at 5s/block), runs `sudo systemctl edit zebvix` to add `Environment="ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT=NNNN"`, and restarts. After height passes ACTIVATION, every `apply_block` enforces that the parent's commit blob exists and verifies. Honest single-validator: trivially passes (1/1 quorum). Multi-validator: requires 2/3+ Precommit power on the parent.

**Honest risk profile:** 11 isolated unit tests in `vote.rs::tests` cover the verifier surface. **DB compatibility:** `EXPECTED_DB_FORMAT_VERSION = 1`; legacy DBs without the marker are auto-stamped v1 on first boot (logged at INFO) — no wipe required. With N=1 validator the gate adds no security improvement over PoA (the lone signer IS the quorum); the gate only hardens N≥4. See `HARDENING_TODO.md` C1 for the full status table.

### Phase B.3.2.6 — Tendermint-style FSM Module (April 2026, runtime integration deferred)
A pure-function consensus FSM ships at `zebvix-chain/src/fsm.rs` (~1200 lines including tests, 20 green tests). It models a single height as a sequence of rounds, each cycling Propose → Prevote → Precommit → Commit, with full lock-on-precommit + POL-release semantics, valid-block tracking for proposer convergence, view-change via timeouts (propose/prevote/precommit each have configurable durations) and via observing `f+1` votes at any round greater than the local round. Late precommit quorums from past rounds still commit the block. The module is intentionally **dead code** in this release: `lib.rs` exports it, `cargo check` compiles cleanly, but `Producer::run` is unchanged and the live VPS chain at h=50K+ continues to produce blocks via the legacy PoA path. The next session will gate the swap-in behind a new env flag `ZEBVIX_FSM_ENABLED` (default OFF) so existing operators are not auto-upgraded; with the flag ON under N=1 the FSM walks every step trivially (1/1 quorum is always met) and produces byte-identical blocks; with N≥2 it delivers real BFT safety + liveness. Tests run via standalone `rustc --test` because the workspace's full `cargo test --lib` rebuild of `librocksdb-sys` exceeds the dev-environment's per-command CPU budget.

**Architect-review safety hardening:** the first review pass returned a FAIL verdict with three critical findings, all addressed in the final shipped module: (1) **height binding** — every `FsmEvent` (except `Tick`) now carries an explicit `height: u64`, and `FsmState::step` silently drops events whose height ≠ `self.height` so misrouted vote-pool signals can never commit the wrong height's block; (2) **precommit-only-on-seen-proposal** — non-nil precommit fires only when `self.proposal == Some(quorum_target)`, otherwise nil, so a hash-only quorum from byzantine peers (or a buggy plumbing layer) cannot forge our signature on data we never validated; (3) **apply-acknowledged height advance** — `Step::Commit` no longer auto-advances on commit-timeout; the runtime must send a new `FsmEvent::BlockApplied { height, hash }` event after a successful state apply + side-table commit-blob persist, and only then does `enter_height` fire. Mismatched-hash acks are refused. A new `committing: Option<Hash>` field on `FsmState` tracks the in-flight commit and also blocks any nil-quorum round-bump while the apply is outstanding. Five new safety tests cover these paths (height-mismatch silent-drop, precommit-nil-on-unseen-hash, precommit-non-nil-after-proposal-seen, BlockApplied-wrong-hash-ignored, no-round-bump-while-committing).

### Dashboard Production Hardening
The dashboard (`artifacts/sui-fork-dashboard`) ships an opt-in **wallet vault** (`src/lib/wallet-vault.ts`) using AES-GCM 256 with PBKDF2-SHA-256 key derivation (200k iterations). When the vault is unlocked, the derived `CryptoKey` is held in module memory so subsequent wallet writes auto-re-encrypt the on-disk blob without re-prompting; sessionStorage acts as a per-tab plaintext mirror that survives reloads but evicts on tab close. UI lives in `src/components/wallet/VaultControls.tsx`. The chain-source explorer (`/api/chain/file`, `/api/chain/tree`) is gated behind `CHAIN_EXPLORER_PUBLIC=1` (default OFF in production) with async fs, depth caps, and path-traversal guards. The `/api/rpc` proxy no longer leaks `VPS_RPC_URL` in error responses and rejects oversized methods/non-array params. The frontend wraps routes in an `ErrorBoundary` keyed on location, configures React Query with `staleTime: 30s` + `refetchOnWindowFocus: false`, drops `console`/`debugger` from production builds via `esbuild.drop`, and uses a `usePagePolling` hook so chain pollers pause when the tab is hidden.

### Wallet Page Production Polish (April 2026)
The MetaMask tab and the entire `MetaMaskTab` component were removed from `/wallet` (the `src/lib/metamask.ts` helper has no remaining importers). The page now exposes four tabs — **Send / Receive / Manage / History**. The new **Receive** tab renders a 208px QR (`qrcode.react` `QRCodeSVG`) that encodes either the bare address or, when a positive amount is entered, an EIP-681 payment URI of the form `ethereum:<addr>@7878?value=<wei>`. The active-wallet card now shows a live USD valuation derived from `zbx_getPriceUSD` (polled every 15s and paused when the tab is hidden), a network heartbeat pill (`zbx_blockNumber` tip with a pulsing dot), and inline **Receive** + **Explorer** action buttons. The page subtitle was rewritten to remove the legacy "MetaMask flow for Solidity tx" copy.

## Censorship-Resistance Guarantees
Zebvix prevents administrative interference with user transfers for core transaction types, limiting control to `ValidatorAdd/Edit/Remove`, `GovernorChange`, and specific `Bridge` operations. The mempool does not have an admin filter or address blacklist.

# External Dependencies

- **Monorepo Management:** pnpm workspaces
- **Blockchain Core:** Rust, RocksDB, `k256`
- **Web Server:** Express 5
- **Database:** PostgreSQL, Drizzle ORM
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Cryptography (JS):** `@noble/hashes/sha3.js`, `@noble/curves/secp256k1`
- **Mobile Development:** Flutter, `flutter_secure_storage`, `web3dart`
- **Smart Contracts:** Solidity 0.8.24, OpenZeppelin
- **Client Libraries (Dashboard):** ethers.js