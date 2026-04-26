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

### Dashboard Production Hardening
The dashboard (`artifacts/sui-fork-dashboard`) ships an opt-in **wallet vault** (`src/lib/wallet-vault.ts`) using AES-GCM 256 with PBKDF2-SHA-256 key derivation (200k iterations). When the vault is unlocked, the derived `CryptoKey` is held in module memory so subsequent wallet writes auto-re-encrypt the on-disk blob without re-prompting; sessionStorage acts as a per-tab plaintext mirror that survives reloads but evicts on tab close. UI lives in `src/components/wallet/VaultControls.tsx`. The chain-source explorer (`/api/chain/file`, `/api/chain/tree`) is gated behind `CHAIN_EXPLORER_PUBLIC=1` (default OFF in production) with async fs, depth caps, and path-traversal guards. The `/api/rpc` proxy no longer leaks `VPS_RPC_URL` in error responses and rejects oversized methods/non-array params. The frontend wraps routes in an `ErrorBoundary` keyed on location, configures React Query with `staleTime: 30s` + `refetchOnWindowFocus: false`, drops `console`/`debugger` from production builds via `esbuild.drop`, and uses a `usePagePolling` hook so chain pollers pause when the tab is hidden.

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