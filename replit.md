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
- **Per-Token AMM (Phase F / Phase 1 of production roadmap):** Permissionless Uniswap V2-style TOKEN/ZBX pools for any ZBX-20 token. Four new TxKind variants (tags 15–18: `TokenPoolCreate`, `TokenPoolAddLiquidity`, `TokenPoolRemoveLiquidity`, `TokenPoolSwap`) with 0.30% pool fee and a 1,000-share lockup on bootstrap. Six new read-only RPCs: `zbx_listTokenPools`, `zbx_getTokenPool`, `zbx_tokenPoolCount`, `zbx_tokenSwapQuote`, `zbx_getTokenLpBalance`, `zbx_tokenPoolStats`. Dashboard pages: `/token-trade` (swap UI with live quote + slippage) and `/token-liquidity` (Add / Remove / Create Pool). Deploy script: `scripts/deploy_token_pool_phase1.sh`.
- **Token Metadata (Phase G / Phase 2 of production roadmap):** Creator-only, on-chain logo / website / description / twitter / telegram / discord. One new TxKind variant (tag 19: `TokenSetMetadata`). Field caps mirrored Rust↔TS: logo+website 256B, description 1024B, socials 64B. New read-only RPC: `zbx_getTokenMetadata`. `zbx_listTokens` / `zbx_tokenInfo*` now embed `metadata` inline (null when unset) so wallets/explorers don't need a second round-trip. Dashboard page: `/token-metadata` (creator-guarded edit form, length pre-validation). Deploy script: `scripts/deploy_token_metadata_phase2.sh`. Code-review verdict: SAFE TO DEPLOY (no consensus-breaking changes, length validation enforced, creator-only auth verified, idempotent overwrite).
- **Pool Addresses (Phase H / Phase 2.5 of production roadmap):** Every per-token AMM pool now has a deterministic 20-byte address derived as `keccak256("zbx-pool-v1" || token_id_be8)[12..]`. Pure helper at `zebvix_chain::token_pool::pool_address(token_id)` and JS mirror `derivePoolAddress(tokenId)` in the dashboard's `lib/tokens.ts`. Reverse index `META_POOL_ADDR_INDEX_PREFIX = b"poola/"` enables O(1) "is this address a pool?" lookups. **Custody invariant** (enforced by every pool apply branch): `account(pool_addr).balance == pool.zbx_reserve` and `token_balance_of(id, pool_addr) == pool.token_reserve`. Maintained by mirroring reserves into the standard balance ledgers after every Create / AddLiquidity / RemoveLiquidity / Swap. **Anti-corruption guards**: `Transfer`, `TokenTransfer`, and `TokenMint` all refund (fee kept) when the recipient is a known pool address — pool reserves can only change through the four pool ops, never through external donations.
  - **Reservation at TokenCreate (anti-griefing fix):** The reverse index is written at `TokenCreate` time, NOT at `TokenPoolCreate` time. Without this, an attacker who knew the derivation function could compute `pool_address(id)` offline and pre-fund it with one wei BEFORE anyone called `TokenPoolCreate`, permanently bricking pool bootstrap (the empty-check in `TokenPoolCreate` would refund forever). Reserving the address at token-creation time means the transfer guards (`is_pool_address`) reject sends from day zero. Semantic shift: `is_pool_address` now returns true for *every* token's pool address, opened or not. New `pool_open: bool` field on `zbx_isPoolAddress` lets wallets distinguish "reserved-but-not-yet-bootstrapped" from "live pool".
  - **One-time, fail-fast backfill on `State::open()`:** `backfill_pool_address_index()` is guarded by a durable migration marker (`META_PHASE_H_BACKFILL_DONE = b"phaseh/backfill_done_v1"`). On the first boot post-upgrade, it walks `1..=token_count`, reserves any missing pool addresses in the reverse index, and scrubs stray ZBX/nonce/token-balance ONLY for tokens with no live `TokenPool` (skipping open pools is critical — otherwise we'd wipe their legitimate mirrored reserves). Marker is written LAST so partial runs retry. **Failure refuses to boot the daemon** (returns `Err` from `State::open()`) — divergent index state across validators would cause `is_pool_address` to disagree, splitting consensus on transfer-guard accept/reject decisions. Deploy script auto-rolls-back to the EXACT previous binary captured pre-deploy if systemctl reports the unit failed to start, and verifies EVERY token's derived pool address is reserved post-restart (hard-fails the deploy if any are missing).
  - **Fail-closed consensus reads + split API:** `get_pool_token_id_by_address` (used by transfer guards) panics on RocksDB read errors or corrupt index entries — silently dropping to `None` would let one node accept a transfer that healthy peers reject. Combined with `panic = "abort"` in `[profile.release]`, this turns any consensus-path read failure into a clean process exit (rather than killing only the panicking tokio task). `try_get_pool_token_id_by_address` is the `Result`-returning variant used by the `zbx_isPoolAddress` and `zbx_getTokenPoolByAddress` RPC handlers — RPC must not crash the validator on user-controlled input, so RPC paths return JSON-RPC error -32603 instead.
  - New read-only RPCs: `zbx_getTokenPoolByAddress`, `zbx_isPoolAddress`. `TokenPoolJson` now carries `address` field. Dashboard `/token-trade` and `/token-liquidity` display the address (click-to-copy). Deploy script: `scripts/deploy_pool_addresses_phase2_5.sh`.
  - **Atomicity note:** Pool apply branches (and the surrounding `apply_tx`) follow the codebase's pre-existing pattern of multiple sequential `?`-propagating writes without an explicit transaction wrapper. If any write fails mid-branch, `apply_block` halts via the chain-halt marker and the operator must recover. This is acceptable per existing chain conventions; not a Phase-H regression.
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

- **Typed Tx Decoder (`zbx_getTxByHash` — Phase H.1):** New RPC that returns the full semantically-decoded `TxKind` payload for any historical tx, so the block explorer can show real amounts/recipients/pool addresses for non-Transfer kinds (e.g. `TokenPoolCreate` seeds, `TokenTransfer` recipient + token symbol, `Swap` direction + output, all `Staking`/`Multisig`/`Bridge`/`Proposal` ops) instead of the misleading `value: 0` from the eth-style getter. Wire format: `{ hash, height, sender, amount, fee, nonce, chain_id, kind, kind_index, payload }` where `kind` is **lowercase snake_case** (matches Rust `TxKind::variant_name()` — never PascalCase) and every monetary `u128` is stringified for JS precision safety. Decoder lives in `zebvix-chain/src/rpc.rs` (`tx_kind_to_json` + four wrapped-enum helpers `stake_op_to_json` / `multisig_op_to_json` / `bridge_op_to_json` / `proposal_op_to_json`, each exhaustive over its variants — extending the inner enums REQUIRES updating the matching helper, do NOT fall back to raw `serde_json::to_value` for any field that contains a u128). Read-side scan helper `State::find_signed_tx_by_hash` walks the ring buffer + per-block tx list (~16k blocks ≈ low-ms cost). Dashboard side: `ZbxTypedTx` interface + `getZbxTypedTx()` in `lib/zbx-rpc.ts`, `TypedPayloadView` per-kind renderer + `prettyKind()` Title-Case display helper in `pages/block-explorer.tsx`. RPC whitelisted in `api-server/src/routes/rpc.ts`. Deploy script: `scripts/deploy_typed_tx_by_hash_phase_h1.sh` (no migration, probes recent txs for a TokenPoolCreate to validate decoded payload shape).

## Security Hardening
- **Block Forgery Defense:** Includes proposer signature verification, two-phase apply with pre-validation, fail-loud apply policy, and crash-safety markers.
- **Mempool DoS Hardening:** Implements balance checks and nonce windows to prevent flooding.
- **RPC Security:** CORS defaults to localhost-only, requiring explicit opt-in for broader access.
- **Slashing:** `SLASHING_ENABLED` defaults to TRUE, automatically burning stake for detected double-signing.
- **State-Root Verification:** Operators are recommended to enable state-root enforcement for fresh chains.

## Censorship-Resistance Guarantees
Zebvix is designed to prevent administrative interference with user transfers. `Transfer`, `TokenTransfer`, `TokenCreate`, `TokenBurn`, `Swap`, `Staking::Stake`, `Multisig::Execute`, `RegisterPayId`, `Proposal::Submit`, and `Proposal::Vote` transactions are not gated by any admin or governor role. Only specific administrative actions like `ValidatorAdd/Edit/Remove`, `GovernorChange`, and certain `Bridge` operations are controlled. The mempool has no admin filter or address blacklist.

## User-Creatable Fungible Tokens
Users can create ERC-20-style tokens with custom symbols, names, decimals, and initial supply. Token creation costs only the standard gas fee (`TOKEN_CREATION_BURN_WEI = 0` in `tokenomics.rs`; the chain handler in `state.rs` skips the burn block when this constant is 0). Creator address is recorded for `Mint` authorization, while `Transfer` and `Burn` are permissionless for token holders. RPC methods are provided for querying token information, balances, and listing tokens.

- **Create Token Page (`/token-create`):** Permissionless launch page for `TxKind::TokenCreate` (tag 11). Inputs: name (1..50), symbol (2..10, uppercase A-Z + 0-9, globally unique case-insensitive), decimals (0..18), initial supply (whole tokens, scaled by 10^decimals to u128 base units). Features: cost cards (only 0.002 ZBX standard gas fee — no extra burn), wallet panel with insufficient-balance warning (~0.01 ZBX gas buffer), debounced symbol availability check (`zbx_tokenInfoBySymbol`, race-safe per-keystroke epoch), live preview card, recent tokens table from `zbx_listTokens`, broadcast + receipt poll with 60s timeout fallback (queries token by symbol once more before surfacing timeout), submit lock during full submitting/broadcast lifecycle. Encoders + RPC helpers in `lib/tokens.ts`. New whitelisted RPCs in api-server: `zbx_listTokens`, `zbx_tokenInfo`, `zbx_tokenInfoBySymbol`, `zbx_tokenBalanceOf`, `zbx_tokenCount`.

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