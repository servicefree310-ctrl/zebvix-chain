# Overview

This project is a pnpm workspace monorepo developing the Zebvix L1 blockchain. It's built with TypeScript and Rust, aiming to deliver a high-performance L1 with a Cancun-EVM-bytecode-compatible execution layer (ZVM), an integrated DeFi AMM (zSwap), robust governance, and seamless cross-chain bridging. Zebvix is designed to be a secure, scalable, and user-friendly platform in the decentralized ecosystem.

Key capabilities include:
- A custom L1 blockchain (`zebvix-chain`) in Rust with the ZBX token, Ethereum-spec secp256k1 addresses, and Bitcoin-like halving.
- An on-chain, permissionless zSwap Automated Market Maker (AMM).
- A comprehensive dashboard for monitoring and interaction.
- Mobile wallet connectivity.
- A ZVM execution layer (Cancun-EVM-bytecode compatible) for smart contracts, offering zero-config compatibility with existing Ethereum tooling.
- A cross-chain bridge module for interoperability with other EVM-compatible networks.

# User Preferences

Communicate in Hinglish with the user.

# System Architecture

## Monorepo Structure
The project utilizes a pnpm workspace monorepo, organizing components into distinct packages:
- `zebvix-chain/`: The core Rust L1 blockchain.
- `api-server/`: An Express 5 based API server.
- Dashboard (`artifacts/sui-fork-dashboard/`): The React-based frontend.
- `mobile/zebvix-wallet/`: The Flutter mobile wallet application.
- `artifacts/zebvix-js/`: The TypeScript SDK (`@zebvix/zebvix.js`), extending ethers v6.

## Core Technologies
- **Backend:** Node.js 24, TypeScript 5.9, Express 5, Rust.
- **Database:** PostgreSQL (for off-chain data, with Drizzle ORM), RocksDB (for on-chain state).
- **Validation:** Zod.
- **API Codegen:** Orval.
- **Build System:** esbuild.

## Zebvix L1 Blockchain (`zebvix-chain/`)
- **Consensus:** A 2-node P2P gossip sync mechanism, RocksDB-backed validator registry, Ed25569 votes (with secp256k1 for ETH-compatible addresses), 2/2 quorum for block verification, and a round-robin proposer. State commitment uses a deterministic binary-merkle root.
- **Transactions:** Supports `Transfer`, `ValidatorAdd`, `ValidatorRemove`, `Swap`, `Bridge`, and `Proposal` types.
- **Tokenomics:** 150M ZBX supply with Bitcoin-style halving. Minimum self-bond is 100 ZBX, minimum delegation is 10 ZBX.
- **AMM:** An on-chain zSwap AMM following the `x·y=k` model with a 0.3% fee.
- **Recent Transactions:** RocksDB-backed ring buffer with a rolling cap of 1000 native transactions, indexed for O(1) lookup.
- **Cryptography:** Uses secp256k1 (ECDSA) for Ethereum-compatible address derivation.
- **Bridge Module:** An on-chain module with `BridgeNetwork` and `BridgeAsset` registries, implementing a lock/release pattern with a single-trusted-oracle MVP.
- **Forkless On-chain Governance:** Features a `proposal` module supporting `FeatureFlag`, `ParamChange`, `ContractWhitelist`, and `TextOnly` proposals. Proposals undergo a 14-day testing phase and a 76-day voting phase, requiring 90% approval and 5 votes quorum.

## ZVM (Zebvix Virtual Machine) Integration
- **Execution Layer:** Native Rust implementation, Cancun-EVM-bytecode compatible.
- **Opcode Support:** Full Cancun opcode set.
- **Gas Accounting:** Mainnet-matching gas constants.
- **Storage:** `CfZvmDb` backed by the `CF_ZVM` RocksDB column family, with an in-memory account cache.
- **Precompiles:** Standard Ethereum precompiles (0x01–0x09) and custom Zebvix precompiles (0x80–0x83) for bridge_out, payid_resolve, amm_swap, and multisig_propose.
- **JSON-RPC Wire Protocol:** Adheres to the `eth_*` namespace for broad compatibility with Ethereum tooling, with canonical `zbx_*` aliases for Zebvix-native callers.
- **Solidity Contracts:** Drafted Solidity 0.8.24 contracts are fully Cancun-EVM-bytecode compatible.

## User Interface (Dashboard)
- **Monitoring & Interaction:** Provides a Mission Control for chain stats, ZVM Explorer for unified search, Pool Explorer for AMM data, and Tokenomics section for ZBX supply and distribution.
- **Advanced Features:** Includes a Smart Contracts (ZVM) page, Cross-Chain Bridge page, Multisig Wallet Tools and Explorer, and an enhanced Balance Lookup.
- **Wallet Functionality:** The ZBX Wallet page supports native `TxKind::Transfer` and MetaMask integration for `eth_sendTransaction`, with transaction tracking and history.
- **Block Explorer:** An Etherscan-style interface for searching and viewing blocks, transactions, and addresses.
- **RPC Playground:** An interactive tool for testing RPC methods with curated examples and real-time responses.
- **Pay-ID Register (`/payid-register`):** Lets a user with a funded address claim a permanent `handle@zbx` alias on-chain via `TxKind::RegisterPayId` (tag 6). Includes debounced live availability check (`zbx_lookupPayId`), reverse-lookup guard against duplicate claims, fee badge (0.002 ZBX), broadcast + receipt polling, and explorer deep-link.
- **Import Wallet (`/import-wallet`):** Three-tab flow for adding addresses to the dashboard hot-wallet store: (1) raw hex private key with live address preview; (2) BIP39 mnemonic (12/15/18/21/24 words, derivation `m/44'/60'/0'/0/0` — MetaMask compatible); (3) generate fresh keypair. Includes wallet list with set-active / copy / remove.
- **Wallet Context:** Single React provider (`contexts/wallet-context.tsx`) used by every page that touches user funds. Persists wallets to `localStorage` (`zbx_wallets_v1`/`zbx_active_wallet_v1`), exposes `addFromPrivateKey`, `addFromMnemonic`, `addGenerated`, `setActive`, `remove`. The dashboard top bar mounts a global wallet picker (`components/ui/wallet-picker.tsx`) so the active address is selectable from anywhere.
- **Staking Dashboard (`/staking`):** Full delegator UI for `TxKind::Staking` (tag 5) with all four delegator ops: Stake, Unstake (% slider, queues into 7-epoch unbonding), Redelegate (move shares to another active validator), and ClaimRewards (drains drip + commission pool). Live network stats from `zbx_getStaking`, validator table sorted by stake, "Your Delegations" panel from `zbx_getDelegationsByDelegator`, modal-based confirm flow. Encoders live in `lib/staking.ts` and mirror the Rust `StakeOp` bincode layout (u32-LE variant tag, length-prefixed UTF-8 hex addresses, u128-LE amounts/shares).

## Security Hardening
- **Block Forgery Defense:** Includes proposer signature verification, two-phase apply with pre-validation, fail-loud apply policy, and crash-safety markers.
- **Mempool DoS Hardening:** Implements balance checks and nonce windows to prevent flooding.
- **RPC Security:** CORS defaults to localhost-only, requiring explicit opt-in for broader access.
- **Slashing:** `SLASHING_ENABLED` defaults to TRUE, automatically burning stake for detected double-signing.
- **State-Root Verification:** Operators are recommended to enable state-root enforcement for fresh chains.

## Censorship-Resistance Guarantees
Zebvix is designed to prevent administrative interference with user transfers. `Transfer`, `TokenTransfer`, `TokenCreate`, `TokenBurn`, `Swap`, `Staking::Stake`, `Multisig::Execute`, `RegisterPayId`, `Proposal::Submit`, and `Proposal::Vote` transactions are not gated by any admin or governor role. Only specific administrative actions like `ValidatorAdd/Edit/Remove`, `GovernorChange`, and certain `Bridge` operations are controlled. The mempool has no admin filter or address blacklist.

## User-Creatable Fungible Tokens
Users can create ERC-20-style tokens with custom symbols, names, decimals, and initial supply. Token creation requires a one-time burn of 100 ZBX. Creator address is recorded for `Mint` authorization, while `Transfer` and `Burn` are permissionless for token holders. RPC methods are provided for querying token information, balances, and listing tokens.

- **Create Token Page (`/token-create`):** Permissionless launch page for `TxKind::TokenCreate` (tag 11). Inputs: name (1..50), symbol (2..10, uppercase A-Z + 0-9, globally unique case-insensitive), decimals (0..18), initial supply (whole tokens, scaled by 10^decimals to u128 base units). Features: cost cards (100 ZBX burn + 0.002 ZBX fee), wallet panel with insufficient-balance warning, debounced symbol availability check (`zbx_tokenInfoBySymbol`, race-safe per-keystroke epoch), live preview card, recent tokens table from `zbx_listTokens`, broadcast + receipt poll with 60s timeout fallback (queries token by symbol once more before surfacing timeout), submit lock during full submitting/broadcast lifecycle. Encoders + RPC helpers in `lib/tokens.ts`. New whitelisted RPCs in api-server: `zbx_listTokens`, `zbx_tokenInfo`, `zbx_tokenInfoBySymbol`, `zbx_tokenBalanceOf`, `zbx_tokenCount`.

# External Dependencies

- **Monorepo Management:** pnpm workspaces
- **Blockchain Core:** Rust, RocksDB, `k256` (for secp256k1 cryptography)
- **Web Server:** Express 5
- **Database:** PostgreSQL, Drizzle ORM
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild
- **Cryptography (JS):** `@noble/hashes/sha3.js`, `@noble/curves/secp256k1`
- **Mobile Development:** Flutter, `flutter_secure_storage`
- **Smart Contracts:** Solidity 0.8.24
- **Client Libraries (Dashboard):** ethers.js