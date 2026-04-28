# Overview

This project is a pnpm workspace monorepo for the Zebvix L1 blockchain, developed using TypeScript and Rust. It aims to be a high-performance, secure, scalable, and user-friendly platform featuring a Cancun-EVM-bytecode-compatible execution layer (ZVM), an integrated DeFi AMM (zSwap), robust governance, and seamless cross-chain bridging. Key capabilities include a custom L1 blockchain, an on-chain permissionless zSwap AMM, a comprehensive dashboard, mobile wallet connectivity, and a ZVM for smart contracts with zero-config compatibility with existing Ethereum tooling. The project also includes a Web3 site builder.

# User Preferences

Communicate in Hinglish with the user.

# System Architecture

## Monorepo Structure
The project is organized as a pnpm workspace monorepo with key packages for the core blockchain, API server, React-based dashboard, Flutter mobile wallet, and a TypeScript SDK.

## Core Technologies
The project utilizes Node.js, TypeScript, Express, and Rust for backend development. Data persistence is handled by PostgreSQL (off-chain) with Drizzle ORM and RocksDB (on-chain). Zod is used for validation, Orval for API codegen, and esbuild for the build system.

## Zebvix L1 Blockchain
The `zebvix-chain` is a Rust-based L1 blockchain featuring a 2-node P2P gossip sync consensus, RocksDB-backed validator registry, and Ed25569 votes (secp256k1 for ETH-compatible addresses). It supports various transaction types, including `Transfer`, `ValidatorAdd/Remove`, `Swap`, `Bridge`, `Proposal`, and `TokenPool` operations. Tokenomics include a 150M ZBX supply with Bitcoin-style halving. The on-chain zSwap AMM follows `x·y=k` with a 0.3% fee and supports permissionless Uniswap V2-style TOKEN/ZBX pools. The blockchain includes a bridge module for cross-chain operations and a forkless on-chain governance system supporting various proposal types.

## ZVM (Zebvix Virtual Machine) Integration
The ZVM is a native Rust implementation that is Cancun-EVM-bytecode compatible, offering full Cancun opcode coverage and mainnet-matching gas accounting. It uses `CfZvmDb` backed by a RocksDB column family for storage. The system supports real `ZvmReceipt` persistence and log management, cross-domain settlement, and monetary gas accounting. Standard Ethereum precompiles are dispatched, and custom Zebvix precompiles handle native side-effects. The JSON-RPC wire protocol adheres to `eth_*` namespace with `zbx_*` aliases.

## User Interface (Dashboard)
The dashboard provides a Mission Control for chain stats, a ZVM Explorer, Pool Explorer, Tokenomics, Smart Contracts, Cross-Chain Bridge, Multisig Wallet Tools, and enhanced Balance Lookup. It includes ZBX Wallet functionality with native transfers, MetaMask integration, transaction tracking, and an "Import Wallet" feature. An Etherscan-style Block Explorer and an RPC Playground are also available. Users can register Pay-IDs for `handle@zbx` aliases and utilize a Staking Dashboard. The dashboard features a typed transaction decoder and allows for permissionless creation of ERC-20-style tokens. The dashboard has implemented an opt-in wallet vault using AES-GCM 256 for secure storage, with UI in `src/components/wallet/VaultControls.tsx`. Frontend routes are wrapped in an `ErrorBoundary`, React Query is configured for efficiency, and `console`/`debugger` are dropped from production builds.

## Zebvix Sites — Web3 Site Builder
This separate product allows users to generate publishable Web3 sites with a block-based editor, 5 polished templates, 1-click publishing to subdomains, built-in crypto checkout (ZBX/zUSD/BNB on Zebvix L1), lead capture, and per-site analytics.

## BSC ↔ Zebvix Bridge
This bridge utilizes an M-of-N validator multisig for Zebvix → BSC mints. `WrappedZBX` (ERC20) and `ZebvixBridge` contracts manage operations on BSC. An off-chain `bridge-relayer` service polls for events and aggregates EIP-712 signatures, while a `bridge-signer` daemon verifies transactions. The dashboard integrates a `BscSidePanel` and a unified bridge UI.

## Security Hardening
Security measures include block forgery defense, mempool DoS hardening, and RPC security with CORS defaults to localhost-only. Slashing mechanisms are in place for double-signing, and a bridge kill-switch (`zbx_bridgePaused`) allows administrators to halt flows. Operational hygiene emphasizes validator key file security, daily RocksDB snapshots, and RPC binding restrictions. The BFT commit gate uses a side-table architecture for commit persistence and verification. A Tendermint-style FSM module is integrated for consensus, with safeguards against misrouted votes and invalid proposals. In-process RPC concurrency limits prevent saturation of the Tokio runtime. Compile-time gated tokenomics with `CHAIN_ID` enforcement prevent transaction replay across networks.

## Roadmap Tier Index
The project roadmap is organized into three tiers:
- **Tier 1 — Consensus correctness**: Chain-breaking, height-gated changes like BFT activation, Keccak256 signing migration, and M-of-N bridge multisig.
- **Tier 2 — Production maturity**: Additive items like multi-validator decentralization, slashing enforcement, state-sync, Prometheus exporter, backup & DR, block explorer feature parity, EIP-1559 fee market, documentation consolidation, and RPC pagination/rate limiting.
- **Tier 3 — Performance & polish**: Deferred items such as Block-STM parallel execution and gossipsub peer scoring.

## Dashboard Copy Audit (April 2026)
A full premium-language audit was performed across all 53 dashboard pages in `artifacts/sui-fork-dashboard/src/pages/`. Outcomes:
- All Hindi/Hinglish prose was converted to advanced premium English. The only intentional Devanagari kept is the "हिन्दी" label inside the language picker in `customization.tsx:25`.
- On AMM/pool surfaces (`dex.tsx`, `pool-explorer.tsx`, `swap.tsx`, `token-create.tsx`, `fabric-layer.tsx`, `zvm-explorer.tsx`), centralisation-implying terms ("admin", "single trusted oracle") were reframed as "governor", "protocol-treasury", "M-of-N multisig (roadmap)" so the copy reflects the actual permissionless / multisig-governed design.
- `FounderAdminCap` was re-labelled to `FounderGovernanceCap` in user-facing changelog text; the on-chain identifier in source code remains unchanged.
- Chain-internal RPC method names and field names (`zbx_getAdmin`, `lifetime_admin_paid_zusd`, `admin_address`) and HTTP `/admin` ops endpoints were intentionally left untouched.
- Positive permissionless / "no admin" claims were preserved.
This audit was UI/copy-only — no Drizzle schema, migration, or database changes.

## Operations — Live Testnet Validator Add (Phase E.1)
A safe, idempotent script `zebvix-chain/scripts/testnet-add-validator.sh` upgrades the live testnet (chain_id 78787) from 1 → 2 validators on the same VPS WITHOUT halting the chain. Safety relies on `consensus.rs::Producer::run` re-reading `state.validators()` on every tick, so a node whose address is not yet in the on-chain set sits dormant automatically until `validator-add` is mined, then auto-promotes on the next round (no restart, no halt window). Default topology: node-2 home `/root/.zebvix-testnet-node2`, RPC :18546, P2P :31334, service `zebvix-testnet2`. Mainnet (chain_id 7878, port 8545, P2P 30333, `/root/.zebvix`) is fully isolated. Flags: `--status` (read-only), `--keygen-only`, `--dry-run`, no flag = full run. Re-runs converge: if node-2's pubkey is already registered, the script ensures the local service is up and exits cleanly.

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
- **Auth:** Clerk (for Web3 Site Builder)
- **AI Generation:** Anthropic (`claude-sonnet-4-5`) (for Web3 Site Builder)