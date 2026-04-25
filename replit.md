# Overview

This project is a pnpm workspace monorepo building the Zebvix L1 blockchain using TypeScript and Rust. Its primary goal is to deliver a performant, EVM-compatible blockchain with integrated DeFi (zSwap AMM), robust governance, and seamless cross-chain bridging. Zebvix aims to be a secure, scalable, and user-friendly platform in the decentralized ecosystem.

Key capabilities include:
- A custom L1 blockchain (`zebvix-chain`) in Rust with the ZBX token (chain-id 7878), EVM-style addresses, and Bitcoin-like halving.
- An on-chain, permissionless zSwap Automated Market Maker (AMM).
- A comprehensive dashboard for monitoring, interaction, and development.
- Mobile wallet connectivity with QR pairing.
- An EVM execution layer (Cancun fork compatible) for smart contracts.
- A cross-chain bridge module for interoperability with other networks like BNB Chain.

The project emphasizes high performance, security, and extensibility through modern tools and architectural patterns.

# User Preferences

Communicate in Hinglish with the user.

# System Architecture

## Monorepo Structure
The project uses a pnpm workspace monorepo, with packages like:
- `zebvix-chain/`: Core Rust L1 blockchain.
- `api-server/`: Express 5 API server.
- Dashboard (`artifacts/sui-fork-dashboard/`): React-based frontend.
- `mobile/zebvix-wallet/`: Flutter mobile wallet.
- `artifacts/zebvix-js/`: TypeScript SDK (`@zebvix/zebvix.js`), extending ethers v6 with native `zbx_*` RPC methods.

## Core Technologies
- **Backend:** Node.js 24, TypeScript 5.9, Express 5, Rust.
- **Database:** PostgreSQL (off-chain, Drizzle ORM), RocksDB (on-chain state).
- **Validation:** Zod.
- **API Codegen:** Orval.
- **Build System:** esbuild.

## Zebvix L1 Blockchain (`zebvix-chain/`)
- **Consensus:** 2-node sync (P2P gossip), RocksDB-backed validator registry, Ed25519 votes (with secp256k1 for ETH-compatible addresses), 2/2 quorum for block verification, round-robin proposer. State commitment via deterministic binary-merkle root for production hardening.
- **Transactions:** `TxKind` enum supports `Transfer`, `ValidatorAdd`, `ValidatorRemove`, `Swap`, `Bridge`, and `Proposal`.
- **Tokenomics:** 150M ZBX supply, Bitcoin-style halving. `MIN_SELF_BOND_WEI` set to 100 ZBX, `MIN_DELEGATION_WEI` to 10 ZBX.
- **AMM:** On-chain zSwap AMM, `x·y=k` model with 0.3% fee.
- **Recent Transactions:** RocksDB-backed ring buffer (rolling cap of 1000 native txs). Phase C.2.1 added a secondary `META_RTX_HASH_PREFIX = b"rtx/h/"` index in CF_META so `find_tx_by_hash()` does an O(1) point lookup; the ring's `push_recent_tx()` writes both indexes in lockstep and cascade-deletes the hash mapping on eviction. `eth_getTransactionByHash` / `eth_getTransactionReceipt` (and their `zbx_getEvmTransaction` / `zbx_getEvmReceipt` aliases) synthesize the standard Ethereum-shape JSON from this index — `status=0x1` is correct by construction since failed txs are never indexed. ZVM (Solidity) tx coverage + real per-execution receipts ship in Phase C.3.
- **Cryptography:** Switched to secp256k1 (ECDSA) for ETH-compatible address derivation.
- **Bridge Module:** On-chain `bridge` module with `BridgeNetwork` and `BridgeAsset` registries, lock/release pattern. Single-trusted-oracle MVP.
- **Forkless On-chain Governance (Phase D):** `proposal` module with `ProposalKind` (FeatureFlag, ParamChange, ContractWhitelist, TextOnly). 14-day Testing phase, 76-day Voting phase (90 days total). 1 wallet = 1 vote, 90% approval + 5 votes quorum for auto-activation. Max 3 active proposals per proposer.

## ZVM (Zebvix Virtual Machine) Integration
- **ZVM Execution Layer:** Native Rust implementation, Cancun-EVM-fork compatible, accessed via `--features zvm`.
- **Opcode Support:** Full Cancun opcode set.
- **Gas Accounting:** Mainnet-matching gas constants.
- **Storage:** `CfZvmDb` with in-memory account cache.
- **Precompiles:** Standard EVM precompiles and custom Zebvix precompiles (bridge_out, payid_resolve, amm_swap, multisig_propose).
- **JSON-RPC Wire Protocol:** `eth_*` namespace (15 methods) for wallet/Foundry/Hardhat compatibility, aliased to `zbx_*` for Zebvix-native callers. `web3_clientVersion` returns `Zebvix/0.1.0/rust1.83/zvm-cancun`.
- **Solidity Contracts:** Drafted Solidity 0.8.24 contracts (e.g., `ZBX20.sol`, `BridgeVault.sol`) are fully EVM-bytecode compatible.

## User Interface (Dashboard)
- **Mission Control:** Live block height, chain stats, KPIs, recent blocks, and MetaMask connection.
- **EVM Explorer:** Unified Smart Search for EVM addresses, hashes, blocks, and Pay-ID aliases. Tools for net status, balance/transaction/code/block lookup, and raw JSON-RPC.
- **Pool Explorer:** Monitors zSwap AMM pool, displays reserves, k-invariant, quote calculator, and recent swaps.
- **Tokenomics:** Live `zbx_supply` data, distribution bar, Foundation Treasury & AMM Pool Seed cards, block reward mechanics.
- **Smart Contracts (EVM) Page:** Details Cancun-targeted EVM, supported features, and strict caveats for EVM functionality (e.g., logs/receipts gap). Dual-namespace `zbx_*`/`eth_*` RPC calls.
- **Cross-Chain Bridge Page:** Explains the single-trusted-oracle MVP, lock-and-mint/burn-and-release mechanics, and limitations.
- **Network Configuration:** Documents libp2p P2P layer (v0.54, TCP+Noise+Yamux, 4 gossipsub topics, mDNS, request_response sync).
- **Genesis Configuration:** Guide for chain bootstrap, including `chain_id` (7878), ZBX 18 decimals, 5-second blocks, and deterministic founder validator.
- **Environment Setup:** Build/run guide for VPS deployment (Rust, native dependencies, `cargo build --release`, systemd unit).
- **Validator Setup:** `zbx_listValidators` and `zbx_getStaking` data, network parameters (min self-bond, min delegation), and 6-step setup guide.
- **Launch Checklist:** Operator sign-off list covering repo & build, pre-flight config, genesis, validator set, network, RPC sanity, testing, operational wiring, soft-launch, and trust-model acknowledgements.
- **Consensus Roadmap:** Outlines stages from current PoA to future DAG-BFT designs (HotStuff, Narwhal, Mysticeti).
- **Multisig Wallet Tools:** In-browser deterministic address planner for new multisigs and a localStorage-backed watchlist for managing existing ones.
- **Multisig Explorer (Advanced Pro UI):** Full rewrite providing a reference and live-data UI for multisigs, including lifecycle diagram, lookup, selected wallet details, owner grid, proposal list, CLI, and JSON-RPC references.
- **Balance Lookup (Advanced Pro Rewrite):** Address inspector performing 17 parallel RPC calls to provide comprehensive address data, including roles, total balance, special address banners, identity panel, drip panel, mempool panel, and delegations table.

## Deployment & Operations
- Defined VPS topology for Node-1 (founder/proposer) and Node-2 (follower).
- CLI tools for validator management, pool genesis, and bridge operations.

# External Dependencies

- **Monorepo:** pnpm workspaces
- **Blockchain Core:** Rust, RocksDB, `k256` (for secp256k1)
- **Web Server:** Express 5
- **Database:** PostgreSQL, Drizzle ORM
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Cryptography (JS):** `@noble/hashes/sha3.js`, `@noble/curves/secp256k1`
- **Mobile Development:** Flutter, `flutter_secure_storage`
- **Smart Contracts:** Solidity 0.8.24 (compiled via Hardhat/Foundry)
- **Client Libraries (Dashboard):** ethers.js