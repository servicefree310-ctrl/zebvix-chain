# Overview

This project is a pnpm workspace monorepo for the Zebvix L1 blockchain, developed using TypeScript and Rust. It aims to be a high-performance, secure, scalable, and user-friendly platform featuring a Cancun-EVM-bytecode-compatible execution layer (ZVM), an integrated DeFi AMM (zSwap), robust governance, and seamless cross-chain bridging. Key capabilities include a custom L1 blockchain (`zebvix-chain`), an on-chain permissionless zSwap AMM, a comprehensive dashboard, mobile wallet connectivity, and a ZVM for smart contracts with zero-config compatibility with existing Ethereum tooling.

# User Preferences

Communicate in Hinglish with the user.

# System Architecture

## Monorepo Structure
The project is organized as a pnpm workspace monorepo with the following key packages:
- `zebvix-chain/`: Core Rust L1 blockchain.
- `api-server/`: Express 5 based API server.
- Dashboard (`artifacts/sui-fork-dashboard/`): React-based frontend.
- `mobile/zebvix-wallet/`: Flutter mobile wallet application.
- `artifacts/zebvix-js/`: TypeScript SDK (`@zebvix/zebvix.js`).

## Core Technologies
- **Backend:** Node.js 24, TypeScript 5.9, Express 5, Rust.
- **Database:** PostgreSQL (off-chain, Drizzle ORM), RocksDB (on-chain).
- **Validation:** Zod.
- **API Codegen:** Orval.
- **Build System:** esbuild.

## Zebvix L1 Blockchain (`zebvix-chain/`)
- **Consensus:** 2-node P2P gossip sync, RocksDB-backed validator registry, Ed25569 votes (secp256k1 for ETH-compatible addresses), 2/2 quorum for block verification, round-robin proposer. State commitment uses a deterministic binary-merkle root.
- **Transactions:** Supports `Transfer`, `ValidatorAdd`, `ValidatorRemove`, `Swap`, `Bridge`, `Proposal`, `TokenPoolCreate`, `TokenPoolAddLiquidity`, `TokenPoolRemoveLiquidity`, `TokenPoolSwap`, and `TokenSetMetadata` types.
- **Tokenomics:** 150M ZBX supply with Bitcoin-style halving.
- **AMM (zSwap):** On-chain AMM following `x·y=k` with 0.3% fee. Supports permissionless Uniswap V2-style TOKEN/ZBX pools.
- **Pool Addresses:** Deterministic 20-byte addresses for per-token AMM pools derived from `keccak256("zbx-pool-v1" || token_id_be8)[12..]`. Addresses are reserved at token creation to prevent griefing.
- **Recent Transactions:** RocksDB-backed ring buffer (1000 native transactions) for O(1) lookup.
- **Cryptography:** secp256k1 (ECDSA) for Ethereum-compatible address derivation.
- **Bridge Module:** On-chain lock/release pattern with a single-trusted-oracle MVP.
- **Forkless On-chain Governance:** `proposal` module supporting `FeatureFlag`, `ParamChange`, `ContractWhitelist`, and `TextOnly` proposals, with testing and voting phases.

## ZVM (Zebvix Virtual Machine) Integration
- **Execution Layer:** Native Rust implementation, Cancun-EVM-bytecode compatible with full Cancun opcode support.
- **Gas Accounting:** Mainnet-matching gas constants.
- **Storage:** `CfZvmDb` backed by `CF_ZVM` RocksDB column family.
- **Precompiles:** Standard Ethereum precompiles (0x01–0x09) and custom Zebvix precompiles (0x80–0x83) for specific functionalities.
- **JSON-RPC Wire Protocol:** Adheres to `eth_*` namespace with canonical `zbx_*` aliases.
- **Solidity Contracts:** Drafted Solidity 0.8.24 contracts are fully Cancun-EVM-bytecode compatible.

## User Interface (Dashboard)
- **Monitoring & Interaction:** Mission Control for chain stats, ZVM Explorer, Pool Explorer, Tokenomics, Smart Contracts, Cross-Chain Bridge, Multisig Wallet Tools, and enhanced Balance Lookup.
- **Wallet Functionality:** ZBX Wallet page supports native transfers and MetaMask integration, with transaction tracking and history. Includes an "Import Wallet" feature supporting private keys, mnemonics, and keypair generation.
- **Block Explorer:** Etherscan-style interface for viewing blocks, transactions, and addresses.
- **RPC Playground:** Interactive tool for testing RPC methods.
- **Pay-ID Register:** Allows users to claim permanent `handle@zbx` aliases on-chain.
- **Staking Dashboard:** Full delegator UI for staking operations (Stake, Unstake, Redelegate, ClaimRewards).
- **Typed Tx Decoder:** `zbx_getTxByHash` RPC provides full semantically-decoded `TxKind` payloads for historical transactions.
- **Live Chain Click-Through:** `/live-chain` Recent Txs panel shows a Tx Hash column; Block#, Tx Hash, From, To, and (in Blocks tab) block hash + proposer all link to `/block-explorer?q=<value>` which auto-resolves the kind via `DetailRouter` + `detectQueryKind`.
- **User-Creatable Fungible Tokens:** Permissionless creation of ERC-20-style tokens with custom metadata and supply. A dedicated "Create Token Page" facilitates this process.

## Security Hardening
- **Block Forgery Defense:** Proposer signature verification, two-phase apply with pre-validation, fail-loud apply policy, crash-safety markers.
- **Mempool DoS Hardening:** Balance checks and nonce windows.
- **RPC Security:** CORS defaults to localhost-only.
- **Slashing:** Automatic burning of stake for double-signing.
- **State-Root Verification:** Recommended for fresh chains.

## Censorship-Resistance Guarantees
Zebvix prevents administrative interference with user transfers for core transaction types. Administrative control is limited to actions like `ValidatorAdd/Edit/Remove`, `GovernorChange`, and certain `Bridge` operations. The mempool has no admin filter or address blacklist.

# External Dependencies

- **Monorepo Management:** pnpm workspaces
- **Blockchain Core:** Rust, RocksDB, `k256`
- **Web Server:** Express 5
- **Database:** PostgreSQL, Drizzle ORM
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Cryptography (JS):** `@noble/hashes/sha3.js`, `@noble/curves/secp256k1`
- **Mobile Development:** Flutter, `flutter_secure_storage`
- **Smart Contracts:** Solidity 0.8.24
- **Client Libraries (Dashboard):** ethers.js