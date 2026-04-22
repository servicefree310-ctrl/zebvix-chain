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
- **B.3.2+ — Tendermint state machine** ⏳ next — replace single-validator PoA producer with vote-driven commit (round-robin proposer, propose/prevote/precommit/commit timeouts, 2/3+ commit gate, `LastCommit` in header).

### Known follow-ups

- **Genesis validator divergence**: `cmd_init` seeds the local node's validator key into its own genesis registry. Multi-node setups end up with each node having a different genesis registry. Workaround today: the `validator-add` tx replicates correctly via apply, so the *post-genesis* set converges. Proper fix (queued): hardcode founder pubkey constant in `state.rs`, have `cmd_init` always seed founder regardless of `--validator-key` (which then only governs the local signing identity).
- **CLI vs running-node lock**: `validator-list --home <path>` opens RocksDB read-write and conflicts with the running node. Use logs (`validator-add applied`) for verification, or add a future `zbx_validators` RPC method.

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
