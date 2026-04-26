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
- **Bridge Module:** On-chain lock/release pattern. The legacy single-trusted-oracle MVP for Z→foreign mints is being superseded by the BSC bridge described below; on the Zebvix side, BridgeOut still locks ZBX in a public escrow vault, BridgeIn is admin-attested, and the chain enforces replay protection by `(network, source_tx_hash)`.
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
- **Typed Tx Decoder:** `zbx_getTxByHash` RPC provides full semantically-decoded `TxKind` payloads for historical transactions. Block Explorer's `TypedPayloadView` renders dedicated per-kind sections (token ops, pool ops, swap, staking with all 6 sub-ops, validator admin ops, governor change, register PayID) so users see the actual operation parameters instead of the misleading eth-style "Value: 0 ZBX" row.
- **Live Chain Click-Through:** `/live-chain` Recent Txs panel shows a Tx Hash column; Block#, Tx Hash, From, To, and (in Blocks tab) block hash + proposer all link to `/block-explorer?q=<value>` which auto-resolves the kind via `DetailRouter` + `detectQueryKind`.
- **User-Creatable Fungible Tokens:** Permissionless creation of ERC-20-style tokens with custom metadata and supply. A dedicated "Create Token Page" facilitates this process.

## BSC ↔ Zebvix Bridge (Production multisig)
- **Goal:** Replace the single-admin attestation MVP with an M-of-N validator multisig for the Zebvix → BSC mint direction.
- **On-chain (BSC):**
  - `WrappedZBX` (`lib/bsc-contracts/contracts/WrappedZBX.sol`) — OpenZeppelin 5.6 ERC20 + AccessControl + Pausable, 18 decimals. Only `MINTER_ROLE` (= the `ZebvixBridge` contract) can mint; any holder can burn their own balance. Admin/pauser is the governance Gnosis Safe.
  - `ZebvixBridge` (`lib/bsc-contracts/contracts/ZebvixBridge.sol`) — Solidity 0.8.24 + cancun (for OZ `mcopy`). Holds the validator set + threshold and verifies M-of-N EIP-712 signatures per mint with replay protection on `sourceTxHash`. Owner = Safe (add/remove validators, set threshold, pause). EIP-712 domain `{name:"ZebvixBridge", version:"1", chainId, verifyingContract}`; type `MintRequest{bytes32 sourceTxHash, address recipient, uint256 amount, uint256 sourceChainId, uint64 sourceBlockHeight}`. 22/22 Hardhat tests passing.
- **Off-chain:**
  - `lib/bridge-relayer/` — single Express service. Polls `zbx_recentBridgeOutEvents` (Z→BSC) and watches `BurnToZebvix` events on BSC after `BSC_BURN_CONFIRMATIONS` (BSC→Z). For mints it asks each validator's signer service for an EIP-712 signature, aggregates M unique sigs, and submits one `mintFromZebvix` tx using the relayer EOA (which holds NO authority). State persisted in better-sqlite3.
  - `lib/bridge-signer/` — per-validator daemon. Independently re-verifies the source Zebvix BridgeOut tx exists with the expected recipient/amount on its own Zebvix RPC before signing. Holds a single validator key. Designed to run on isolated infrastructure per-operator behind TLS + `AUTH_TOKEN`. So a malicious relayer cannot forge mints — it would need M honest signers to all be tricked.
- **Dashboard:** `/bridge-live` page includes a `BscSidePanel` (`artifacts/sui-fork-dashboard/src/components/bridge/BscSidePanel.tsx`) showing wZBX + bridge contract addresses (BscScan links), an "Add wZBX to MetaMask" button (`wallet_watchAsset`), live wZBX balance via the BSC public RPC, and a reverse-bridge form (approve + `burnToZebvix`) with a relayer status indicator. The dashboard talks to BSC directly via a tiny no-deps client (`src/lib/bsc-bridge.ts`) using `@noble/hashes` for keccak.
- **Unified bridge UI (primary):** `/bridge` page leads with a single Across/Stargate-style widget (`artifacts/sui-fork-dashboard/src/components/bridge/UnifiedBridge.tsx`) that handles BOTH directions in one form: From/To chain pills with a swap arrow, single amount + recipient inputs, context-aware Approve→Submit button (auto-detected via live `bscErc20Allowance` reading), live dual-chain balances + chain heads, relayer/validator health row, and a "Your recent bridges" sidebar filtered to the active wallet. Same in-browser secp256k1 key signs both legs (no MetaMask required); the existing protocol docs are tucked into a collapsible "Protocol details" section below. Race-safe across mid-flight wallet swaps via a `browserAddrRef` snapshot check in async handlers + a wallet-change `useEffect` that resets `destAddr`/`lastTx`/`err`/`busy`.
- **api-server:** `GET /api/bridge/bsc-config` (public read of wZBX/bridge addresses + chain id from env) and `GET /api/bridge/relayer-status` (proxy to relayer `/health`) at `artifacts/api-server/src/routes/bridge.ts`.
- **Operator runbook:** `lib/bsc-contracts/DEPLOY.md` covers compile/test, testnet deploy, signer + relayer wiring, dashboard env, end-to-end testnet verification, and a mainnet promotion checklist (Safe ownership, validator key isolation, pause-recovery drill, monitoring).

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

## Zebvix Mobile Wallet (`mobile/zebvix_wallet/`)
Flutter app (web + iOS + Android targets) providing self-custody multichain wallet for Zebvix L1 and BSC. Premium dark UI with emerald→cyan gradient, glass cards, Inter font.
- **Core:** BIP39 mnemonic, BIP44 derivation (`m/44'/60'/0'/0/i`), `flutter_secure_storage` for keystore, `web3dart` for JSON-RPC, multichain registry (Zebvix 7878, BSC 56, ETH, Polygon, Arbitrum).
- **Built-in bridge:** Direct ZBX↔wZBX via on-chain mainnet contracts (`WrappedZBX 0xf7AA…`, `ZebvixBridge 0xa6dF…`). `bridge_service.dart` handles approve / burnToZebvix / bridgeOut.
- **QR-scan-to-approve flow (WalletConnect-style):**
  - api-server runs a non-custodial WS relay at `wss://…/api/wc/relay/:id` (sessions created via `POST /api/wc/sessions`). Relay validates JSON shape, drops malformed/oversized messages, rejects duplicate-role connections (close 4409) and invalid roles, applies per-IP session creation rate limit (30/min/IP), tears sessions down when both peers disconnect, and bounds messages to 64 KB.
  - Dashboard: `MobileConnectModal` opens a session, displays QR with `zbx://wc?…` URI, listens for mobile peer + signed responses.
  - Mobile: Scan tab parses URI (paste-fallback on web preview), opens WS as `role=mobile`, surfaces incoming signing requests in Approve screen with Approve/Reject. Supports `personal_sign`, `eth_signTypedData_v4`, `eth_accounts`. Signs locally with the active private key — keys never leave the device, server never sees plaintext sigs before the requesting dashboard.
- **Web preview:** Flutter web build (`--base-href /api/mobile/`) is served by api-server at `/api/mobile/` so it appears in the same Replit preview.