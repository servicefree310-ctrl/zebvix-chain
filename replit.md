# Overview

This project is a pnpm workspace monorepo utilizing TypeScript to build the Zebvix L1 blockchain. The core purpose is to create a performant, EVM-compatible blockchain with integrated DeFi capabilities (zSwap AMM), robust governance, and seamless cross-chain bridging. The project aims to establish Zebvix as a key player in the decentralized ecosystem by offering a secure, scalable, and user-friendly platform.

Key features include:
- A custom L1 blockchain (`zebvix-chain`) implemented in Rust with token ZBX (chain-id 7878), EVM-style addresses, and Bitcoin-like halving.
- A permissionless zSwap Automated Market Maker (AMM) integrated directly on-chain.
- A comprehensive dashboard for monitoring, interaction, and development.
- Mobile wallet connectivity with QR pairing.
- EVM execution layer (Cancun fork) for smart contract deployment and interaction.
- Cross-chain bridge module for interoperability with external networks like BNB Chain.

The project is structured to ensure high performance, security, and extensibility, leveraging modern tooling and architectural patterns.

# User Preferences

Communicate in Hinglish with the user.

# System Architecture

## Monorepo Structure
The project is organized as a pnpm workspace monorepo, with each package managing its own dependencies. Key packages include:
- `zebvix-chain/`: The core Rust implementation of the Zebvix L1 blockchain.
- `api-server/`: Express 5 based API server.
- Dashboard (`artifacts/sui-fork-dashboard/`): React-based frontend for chain interaction and monitoring.
- `mobile/zebvix-wallet/`: Flutter-based mobile wallet application.

## Core Technologies
- **Backend:** Node.js 24, TypeScript 5.9, Express 5, Rust for blockchain core.
- **Database:** PostgreSQL with Drizzle ORM for off-chain data, RocksDB for on-chain state.
- **Validation:** Zod (`zod/v4`), `drizzle-zod`.
- **API Codegen:** Orval (from OpenAPI spec).
- **Build System:** esbuild (CJS bundle).

## Zebvix L1 Blockchain (`zebvix-chain/`)
- **Consensus:** 2-node sync (P2P gossip, heartbeat, block sync), RocksDB-backed validator registry, Ed25519 votes with double-sign detection, 2/2 quorum for block verification, round-robin proposer.
- **Transactions:** `TxKind` enum supports `Transfer`, `ValidatorAdd`, `ValidatorRemove`, `Swap`, `Bridge`, and `Proposal` (Phase D governance).
- **Tokenomics:** 150M ZBX supply, Bitcoin-style halving.
- **AMM:** On-chain zSwap AMM with initial seed at $0.50/ZBX. Supports `SwapDirection` (ZbxToZusd, ZusdToZbx) with slippage protection.
- **Recent Transactions:** On-chain `RecentTxRecord` index (RocksDB-backed ring buffer) for fast retrieval of past transactions without scanning blocks.
- **Cryptography:** Switched from Ed25519 to secp256k1 (ECDSA) for ETH-compatible address derivation (`keccak256(uncompressed_pubkey[1..])[12..]`).
- **Bridge Module:** On-chain `bridge` module with `BridgeNetwork` and `BridgeAsset` registries, lock/release pattern for cross-chain transfers. Admin-extensible for new networks and assets.
- **Phase D — Forkless On-chain Governance:** `proposal` module with `ProposalKind` (FeatureFlag, ParamChange, ContractWhitelist, TextOnly). Wallets holding ≥ 1 000 ZBX may submit proposals (only fee consumed; principal refunded). Lifecycle: 14-day shadow-execution Testing phase → 76-day Voting phase (90 days total). 1 wallet = 1 vote (no balance weighting; voters only pay gas). Auto-activates iff yes/total ≥ 90% AND total ≥ 5; activation flips a feature flag, sets a u128 param, or whitelists a contract — no hard fork. Max 3 active (Testing|Voting) proposals per proposer. State persisted in `CF_META` under `prop/`, `prop_vote/`, `prop_active/`, `prop_count`, `ff/`, `ff_label/`. RPC: `zbx_proposalsList`, `zbx_proposalGet`, `zbx_proposerCheck`, `zbx_proposalHasVoted`, `zbx_proposalShadowExec` (strictly read-only, never mutates consensus state), `zbx_featureFlagsList`, `zbx_featureFlagGet`. CLI: `propose`, `vote`, `proposals-list`, `proposal-get`, `feature-flags-list`. Dashboard `/governance` page with eligibility check, proposals list, feature-flag sidebar, and shadow-exec preview. Status labels are capitalized end-to-end (`Testing`, `Voting`, `Approved`, `Rejected`, `Activated`).

## EVM Integration
- **EVM Execution Layer:** Native EVM implementation (Cancun fork) in Rust, gated behind `cargo --features evm`.
- **Opcode Support:** Full Cancun opcode set, including CREATE/CREATE2.
- **Gas Accounting:** Mainnet-matching gas constants, quadratic memory expansion, SSTORE refunds.
- **Storage:** `CfEvmDb` with in-memory account cache, atomic journal applies.
- **Precompiles:** Standard (ECRECOVER, SHA256, IDENTITY) and custom (bridge_out, payid_resolve, amm_swap, multisig_propose).
- **JSON-RPC:** Comprehensive `eth_*` namespace (15 methods) for EVM interaction.
- **Solidity Contracts:** Drafted Solidity 0.8.24 contracts (`ZBX20.sol`, `BridgeVault.sol`, `BridgeMultisig.sol`, `Multicall3.sol`, `ZbxStaking.sol`, `ZbxAMM.sol`, `ZbxTimelock.sol`) for the BNB-Chain side of the bridge and general utility.

## User Interface (Dashboard)
- **Mission Control:** Rewritten home page showing live block height, chain stats, KPIs, recent blocks, quick access grid, chain identity, and MetaMask connection.
- **EVM Explorer:** New page for interacting with the native EVM, including a unified Smart Search bar (auto-detects EVM address, 32-byte hash, block number/tag, and Pay-ID alias and routes to the right RPC, with cross-link buttons between results and a dual-source block fetch — `zbx_getBlockByNumber` for numeric heights and `eth_getBlockByNumber` for tags), net status, balance/transaction/code/block lookup tools, and a raw JSON-RPC dispatcher.
- **Pool Explorer:** Page dedicated to monitoring the zSwap AMM pool, displaying reserves, k-invariant, loan repayment progress, quote calculator, and recent swaps.
- **Tokenomics:** Live RPC pull of `zbx_supply` every 10s; distribution bar (6.66% founder premine + 13.33% foundation + mined + burned + remaining); Foundation Treasury & AMM Pool Seed cards; block reward + gas split + burn + Phase A/B halving mechanics. Points to `zebvix-chain/src/tokenomics.rs`.
- **Environment Setup:** Operator-facing build/run guide for VPS deployment. Hero with codebase/network/build-time facts; hardware (4 vCPU / 8 GB / 100 GB SSD / 100 Mbps) and OS (Ubuntu 22.04+/24.04, Debian 12, glibc Linux only — no Alpine/musl) recommendations; 9-step flow: (1) Rust stable via rustup, (2) native deps `build-essential pkg-config cmake libssl-dev libclang-dev clang llvm-dev libsnappy-dev liblz4-dev zlib1g-dev libzstd-dev` with per-package rationale, (3) source tarball pull from `/api/download/newchain` with backup-before-extract guard, (4) `cargo build --release` (or `--features evm` for native EVM), (5) symlink to `/usr/local/bin/zebvix-node`, (6) two-step init (`keygen --out` then `init --home --validator-key`) with founder vs follower note, (7) production systemd unit verbatim from `srv1266996` (`After=network.target`, `Restart=always`, `RestartSec=5`, journal-only stdout/err) + optional hardening labeled separately, (8) firewall split into validator-locked-down profile (`--rpc 127.0.0.1:8545` + ufw deny 8545) and public-RPC profile (`--rpc 0.0.0.0:8545` + nginx/TLS), (9) RPC sanity (`eth_chainId=0x1ec6`, `zbx_blockNumber`, `zbx_getStaking`, `zbx_supply`); day-2 update flow + troubleshooting (libclang, no blocks produced, RPC connection refused, disk fill). Replaced earlier Sui-fork template that incorrectly told operators to `git clone MystenLabs/sui` and `cargo build -p sui-node`.
- **Validator Setup:** Live `zbx_listValidators` + `zbx_getStaking` every 10s; hero stats (active vals/total bonded/current epoch/epoch reward 50 ZBX/quorum); active validator table with copyable addresses; network params (min self-bond 100 ZBX fixed, min delegation 10 ZBX, max commission 50%, max edit ±1%/epoch, epoch 17280 blocks ~24h, unbonding 7 epochs ~7d); 6-step setup guide (secp256k1 keygen → init w/ `--validator-key` flag → systemd → firewall/sync → two-tier registration: `StakeOp::CreateValidator` 5a + governor-only `ValidatorAdd` 5b → verify); reward economics with bootstrap-APY caveat; slashing primitives banner (`slash_double_sign` 5%, `slash_downtime` 0.10% — auto-enforcement ships later); RPC cheatsheet.
- **Staking constants & redelegate-inflation fix (Apr 2026):** `MIN_SELF_BOND_WEI` set to 100 ZBX (fixed token amount), `MIN_DELEGATION_WEI` set to 10 ZBX (fixed). Architect caught a pre-existing inflation vector in `StakingModule::redelegate` — old code did `self.stake(.., amount.max(MIN_DELEGATION_WEI))` which minted free stake when a sub-min position was redelegated. Refactored: `stake()` checks min then calls new private `deposit_unchecked()`, and `redelegate()` calls `deposit_unchecked()` directly with the exact moved amount. Regression test `redelegate_legacy_small_position_does_not_inflate` added.
- **USD-peg removed (Apr 2026):** Earlier design derived validator min from `MIN_SELF_BOND_USD_MICRO = $50` ÷ AMM pool spot price. Removed entirely — the chain's own AMM was the oracle (reflexive, shallow, flash-loan-manipulable: an attacker could pump spot price to lower the ZBX min and spawn cheap Sybil validators). Replaced with fixed-token `MIN_SELF_BOND_WEI = 100 ZBX`, matching industry standard (Ethereum 32 ETH, Solana ~5,000 SOL, Sui 30M SUI, Aptos 1M APT). Deleted `MIN_SELF_BOND_USD_MICRO` constant and `dynamic_min_self_bond_wei()` helper from `staking.rs`. `state.rs` calls `MIN_SELF_BOND_WEI` directly. `rpc.rs::zbx_getStaking` no longer emits `min_self_bond_usd_micro` or `min_self_bond_dynamic_wei`. Dashboard `validators.tsx` removed the "USD-pegged" row and updated the hint to explain the fixed-token design + industry comparison. Future USD-aware logic, if reintroduced, must use external TWAP oracle (Chainlink/Pyth) and remain `max(MIN_SELF_BOND_WEI, oracle_value)`. Requires VPS rebuild + node restart to activate.
- **Mobile Wallet UI:** Flutter application with onboarding (BIP39 mnemonic), wallet management, swap functionality, multisig, and QR-based desktop pairing.

## Deployment & Operations
- VPS topology defined for Node-1 (founder/proposer) and Node-2 (follower).
- CLI tools for chain interaction, including validator management, pool genesis, and bridge operations.

# External Dependencies

- **Monorepo:** pnpm workspaces
- **Blockchain Core:** Rust, `ed25519-dalek` (removed), `k256` (for secp256k1), RocksDB
- **Web Server:** Express 5
- **Database:** PostgreSQL, Drizzle ORM
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Cryptography (JS):** `@noble/curves/secp256k1`
- **Mobile Development:** Flutter, `flutter_secure_storage`
- **EVM (Rust):** `sha2` (optional feature), `tempfile` (dev-dependency)
- **Smart Contracts:** Solidity 0.8.24 (Hardhat/Foundry for compilation)
- **Client Libraries (Dashboard):** ethers.js (for EVM integration)