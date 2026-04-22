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
- **B.3.2.3 — 2/3+ commit gate** ⏳ next — block reject if quorum miss (chain HALT — correct BFT).
- **B.3.2.4 — `LastCommit` in BlockHeader** ⏳ — signed precommit set from prev block, validated on apply.

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
