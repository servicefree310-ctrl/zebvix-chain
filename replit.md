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
- **Transactions:** `TxKind` enum supports `Transfer`, `ValidatorAdd`, `ValidatorRemove`, and `Swap`.
- **Tokenomics:** 150M ZBX supply, Bitcoin-style halving.
- **AMM:** On-chain zSwap AMM with initial seed at $0.50/ZBX. Supports `SwapDirection` (ZbxToZusd, ZusdToZbx) with slippage protection.
- **Recent Transactions:** On-chain `RecentTxRecord` index (RocksDB-backed ring buffer) for fast retrieval of past transactions without scanning blocks.
- **Cryptography:** Switched from Ed25519 to secp256k1 (ECDSA) for ETH-compatible address derivation (`keccak256(uncompressed_pubkey[1..])[12..]`).
- **Bridge Module:** On-chain `bridge` module with `BridgeNetwork` and `BridgeAsset` registries, lock/release pattern for cross-chain transfers. Admin-extensible for new networks and assets.

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