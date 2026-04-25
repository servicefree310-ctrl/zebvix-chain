# Overview

This project is a pnpm workspace monorepo building the Zebvix L1 blockchain using TypeScript and Rust. Its primary goal is to deliver a performant L1 with a Cancun-EVM-bytecode-compatible execution layer (ZVM), integrated DeFi (zSwap AMM), robust governance, and seamless cross-chain bridging. Zebvix aims to be a secure, scalable, and user-friendly platform in the decentralized ecosystem.

Key capabilities include:
- A custom L1 blockchain (`zebvix-chain`) in Rust with the ZBX token (chain-id 7878), Ethereum-spec 20-byte secp256k1 addresses, and Bitcoin-like halving.
- An on-chain, permissionless zSwap Automated Market Maker (AMM).
- A comprehensive dashboard for monitoring, interaction, and development.
- Mobile wallet connectivity with QR pairing.
- A ZVM execution layer (Cancun-EVM-bytecode compatible) for smart contracts. MetaMask, Hardhat, Foundry, ethers and viem connect zero-config because the wire-protocol method names (`eth_*` / `net_*` / `web3_*`) follow the standard Ethereum spec verbatim.
- A cross-chain bridge module for interoperability with foreign EVM-compatible networks (Ethereum, BSC, Polygon, …).

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
- **Recent Transactions:** RocksDB-backed ring buffer (rolling cap of 1000 native txs). Phase C.2.1 added a secondary `META_RTX_HASH_PREFIX = b"rtx/h/"` index in CF_META so `find_tx_by_hash()` does an O(1) point lookup; the ring's `push_recent_tx()` writes both indexes in lockstep and cascade-deletes the hash mapping on eviction. `eth_getTransactionByHash` / `eth_getTransactionReceipt` (and their canonical `zbx_getZvmTransaction` / `zbx_getZvmReceipt` aliases — legacy `zbx_*Evm*` names also accepted for backward compat) synthesize the standard Geth-shape JSON from this index — `status=0x1` is correct by construction since failed txs are never indexed. ZVM (Solidity) tx coverage + real per-execution receipts ship in Phase C.3.
- **Cryptography:** Switched to secp256k1 (ECDSA) for ETH-compatible address derivation.
- **Bridge Module:** On-chain `bridge` module with `BridgeNetwork` and `BridgeAsset` registries, lock/release pattern. Single-trusted-oracle MVP.
- **Forkless On-chain Governance (Phase D):** `proposal` module with `ProposalKind` (FeatureFlag, ParamChange, ContractWhitelist, TextOnly). 14-day Testing phase, 76-day Voting phase (90 days total). 1 wallet = 1 vote, 90% approval + 5 votes quorum for auto-activation. Max 3 active proposals per proposer.

## ZVM (Zebvix Virtual Machine) Integration
- **ZVM Execution Layer:** Native Rust implementation, Cancun-EVM-bytecode compatible, accessed via `--features zvm`.
- **Opcode Support:** Full Cancun opcode set.
- **Gas Accounting:** Mainnet-matching gas constants.
- **Storage:** `CfZvmDb` backed by the `CF_ZVM` column family (Rust constant; on-disk RocksDB CF name is the legacy string `"evm"` for backward compat — no migration needed when upgrading from the pre-rebrand binary). In-memory account cache layered on top.
- **Precompiles:** Standard Ethereum-spec precompiles (0x01–0x09) plus custom Zebvix precompiles 0x80–0x83 (bridge_out, payid_resolve, amm_swap, multisig_propose).
- **JSON-RPC Wire Protocol:** `eth_*` namespace (15 methods, kept as the standard Ethereum spec — never renamed because every wallet/library expects these exact names) for MetaMask/Foundry/Hardhat compatibility, aliased to canonical `zbx_*` for Zebvix-native callers. `web3_clientVersion` returns `Zebvix/0.1.0/rust1.83/zvm-cancun`. Tx submit/lookup aliases are `zbx_sendRawZvmTransaction` / `zbx_getZvmTransaction` / `zbx_getZvmReceipt` (deprecated `zbx_*Evm*` names still accepted).
- **Solidity Contracts:** Drafted Solidity 0.8.24 contracts (e.g., `ZBX20.sol`, `BridgeVault.sol`) are fully Cancun-EVM-bytecode compatible.

## User Interface (Dashboard)
- **Mission Control:** Live block height, chain stats, KPIs, recent blocks, and MetaMask connection.
- **ZVM Explorer:** Unified Smart Search for 20-byte addresses, tx/block hashes, block numbers, and Pay-ID aliases. Tools for net status, balance/transaction/code/block lookup, and raw JSON-RPC.
- **Pool Explorer:** Monitors zSwap AMM pool, displays reserves, k-invariant, quote calculator, and recent swaps.
- **Tokenomics:** Live `zbx_supply` data, distribution bar, Foundation Treasury & AMM Pool Seed cards, block reward mechanics.
- **Smart Contracts (ZVM) Page:** Details Cancun-targeted ZVM, supported features, and strict caveats for current functionality (e.g., logs/receipts gap, ZVM tx not yet ring-buffer-indexed — both close in C.3). Dual-namespace `zbx_*`/`eth_*` RPC calls. Internal Rust types renamed `Evm*` → `Zvm*` (e.g., `ZvmTxEnvelope`, `CF_ZVM`, `try_zvm_dispatch`); Ethereum-spec wire-protocol method names (`eth_*`) intentionally preserved.
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
- **ZBX Wallet (Send + MetaMask):** 4-tab page (Send / MetaMask / Manage / History) at `/wallet`. Native send tab signs `TxKind::Transfer` locally, gates on a confirmation dialog (preview of from/to/amount/fee/total/nonce/chain id), then live-tracks the receipt via `pollReceipt(eth_getTransactionReceipt, 4s/90s)` showing signing → in-mempool (with elapsed-secs counter) → included @ block N (success/reverted). MetaMask tab uses EIP-1193 (`window.ethereum`) — Connect, idempotent `wallet_switchEthereumChain` with `wallet_addEthereumChain` fallback (chainId `0x1ec6`, RPC = dashboard `/api/rpc`, ZBX 18 dec), then `eth_sendTransaction` for value or Solidity-data txs with the same review-then-track UX. History persists in localStorage with `block`/`confirmedTs`/`kind` (native|metamask) fields and links every hash to the explorer.
- **Block Explorer (Etherscan-style):** Universal `?q=` search at `/block-explorer` auto-detects block height, block hash (32B), tx hash (32B), or address (20B) and routes to the right detail view. Overview shows live tip + last 10 blocks + recent 12 txs (poll 6s) via `eth_getBlockByNumber(_, true)`. Block detail renders header (hash, parent, proposer, ts, gas, base fee, size) + tx list. Tx detail combines `eth_getTransactionByHash` + `eth_getTransactionReceipt` for status badge, gas used, contract-creation address, calldata, and event logs. Address detail does parallel `zbx_getBalance`/`zbx_getNonce`/`zbx_getCode` and flags EOA vs contract.
- **RPC Playground:** Two-pane page at `/rpc-playground` listing every allowlisted method grouped by family (ZBX core, ETH-spec, NET/WEB3, bridge/staking/multisig/payid, governance) with searchable filter, click-to-load curated example params, JSON params editor, Execute button hitting the same `/api/rpc` proxy, formatted JSON response with copy + duration, and a 10-call recent-history strip.

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