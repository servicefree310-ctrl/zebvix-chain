import { CheckCircle2, Circle, Clock, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type FeatureStatus = "done" | "wip" | "planned";

interface Feature {
  name: string;
  desc: string;
  status: FeatureStatus;
  version?: string;
  files?: string[];
}

interface FeatureGroup {
  group: string;
  icon: string;
  features: Feature[];
}

const GROUPS: FeatureGroup[] = [
  {
    group: "Core Chain",
    icon: "⛓",
    features: [
      {
        name: "20-byte ZVM-style addresses",
        desc: "Keccak256(pubkey)[12..] — Ethereum compatible address format",
        status: "done",
        version: "v0.1",
        files: ["src/types.rs", "src/crypto.rs"],
      },
      {
        name: "Ed25519 signatures",
        desc: "Tx + block signing — upgradable to BLS in v0.2",
        status: "done",
        version: "v0.1",
        files: ["src/crypto.rs"],
      },
      {
        name: "Single-validator PoA consensus",
        desc: "5-second block time, founder produces blocks",
        status: "done",
        version: "v0.1",
        files: ["src/consensus.rs"],
      },
      {
        name: "RocksDB storage",
        desc: "Accounts CF, blocks CF, meta CF — production-grade KV store",
        status: "done",
        version: "v0.1",
        files: ["src/state.rs"],
      },
      {
        name: "Mempool",
        desc: "Pending tx pool — max 50,000 txs",
        status: "done",
        version: "v0.1",
        files: ["src/mempool.rs"],
      },
    ],
  },
  {
    group: "Tokenomics",
    icon: "💰",
    features: [
      {
        name: "150M ZBX hard cap",
        desc: "Total supply hard-capped, no inflation beyond cap",
        status: "done",
        version: "v0.1",
        files: ["src/tokenomics.rs"],
      },
      {
        name: "Founder pre-mine = 0 ZBX (no genesis allocation)",
        desc: "Admin/founder receives ZERO ZBX at genesis. Earns only through (a) block proposer rewards (3 ZBX per block, halving every 25M blocks), (b) tx fees on mined blocks, and (c) 50% swap-fee share after the 10M zUSD pool loan is repaid. Fully meritocratic — no premine concentration risk.",
        status: "done",
        version: "v0.1.3",
        files: ["src/tokenomics.rs", "src/main.rs"],
      },
      {
        name: "Admin/Founder address rotation (max 3 times)",
        desc: "Current admin can rotate to a new address up to 3 times. After 3 rotations the admin is permanently locked. Each rotation must be signed by the current admin's keyfile (verified via `zebvix-node admin-change-address --signer-key <current.key> --new-admin 0x...`). Stored on-chain in meta CF — survives restart. Future swap-fee payouts automatically route to the new admin. Live state via `zbx admin` (RPC: zbx_getAdmin).",
        status: "done",
        version: "v0.1.3",
        files: ["src/state.rs", "src/main.rs", "src/rpc.rs", "src/tokenomics.rs"],
      },
      {
        name: "Refund-on-failure for pool transactions",
        desc: "If an auto-swap fails (e.g. dust amount below 0.01 zUSD minimum, pool not initialized, output overflow), the sender's principal amount is REFUNDED — only the gas fee is kept. ZVM-style 'revert with gas spent' UX. Pool reserves are never touched on failure (atomic via match-on-Result in apply_tx).",
        status: "done",
        version: "v0.1.3",
        files: ["src/state.rs"],
      },
      {
        name: "Minimum swap output (0.01 zUSD / 0.01 ZBX)",
        desc: "Swaps that would produce less than 0.01 zUSD (or 0.01 ZBX on reverse) are rejected with `swap too small` error. Prevents dust-spam attacks and ensures every swap is economically meaningful. Combined with refund-on-failure, dust attempts cost only gas and don't disturb pool reserves.",
        status: "done",
        version: "v0.1.3",
        files: ["src/pool.rs", "src/tokenomics.rs"],
      },
      {
        name: "U256 overflow-safe AMM math (primitive-types)",
        desc: "All CPMM calculations (`isqrt`, `spot_price_zusd_per_zbx`, `swap_zbx_for_zusd`, `swap_zusd_for_zbx`) use 256-bit intermediate arithmetic via `primitive_types::U256`. Prevents u128 overflow on values like 10^25 wei × 10^25 wei = 10^50. Result down-cast to u128 only after overflow check. Fixed a pre-v0.1.2 bug where spot price showed $0.000034 instead of $1.00.",
        status: "done",
        version: "v0.1.2",
        files: ["src/pool.rs"],
      },
      {
        name: "Bitcoin-style halving",
        desc: "3 ZBX initial reward, halves every 25M blocks (~3.96 yrs)",
        status: "done",
        version: "v0.1",
        files: ["src/tokenomics.rs"],
      },
      {
        name: "18 decimals",
        desc: "ZVM standard — wei = 1e-18 ZBX",
        status: "done",
        version: "v0.1",
      },
      {
        name: "Mandatory gas fees (Ethereum-style)",
        desc: "21,000 gas units per transfer (ETH-compatible) × 50 gwei min price = 0.00105 ZBX min fee. Spam protection. Fees → proposer along with mining reward.",
        status: "done",
        version: "v0.1.1",
        files: ["src/tokenomics.rs", "src/state.rs", "src/mempool.rs"],
      },
      {
        name: "zSwap AMM pool (Uniswap V2 style)",
        desc: "On-chain ZBX/zUSD constant-product pool (x·y=k) with 0.3% fee. Founder-seeded liquidity, LP tokens minted to providers. Acts as decentralized price oracle.",
        status: "done",
        version: "v0.1.2",
        files: ["src/pool.rs", "src/state.rs"],
      },
      {
        name: "Multi-token state (ZBX + zUSD)",
        desc: "Account now holds both ZBX (native) and zUSD (testnet faucet stablecoin) balances. LP tokens stored in separate keyspace. Backward-compatible serde with #[serde(default)] on zUSD field.",
        status: "done",
        version: "v0.1.2",
        files: ["src/state.rs"],
      },
      {
        name: "Dynamic USD-pegged fee (consensus-enforced) ✅",
        desc: "EVERY tx fee is bound to a live USD window of $0.001 (min) — $0.01 (max), auto-converted to ZBX wei via the AMM pool spot price at block-apply time. apply_tx() rejects any tx outside this band. Window auto-scales: if ZBX 10x rises, the wei amount drops 10x; if ZBX crashes, wei amount goes up so users still pay only ~1¢ max. Bootstrap fallback: while pool is uninitialized, fixed [0.000021, 0.21] ZBX window is used. Helpers: pool::fee_bounds_wei() + pool::usd_micro_to_zbx_wei(). New RPC zbx_feeBounds returns live {min, max, recommended} for wallets. CLI commands accept --fee auto to fetch + use the recommendation automatically (no math required).",
        status: "done",
        version: "v0.1.5",
        files: ["src/pool.rs", "src/tokenomics.rs", "src/state.rs", "src/rpc.rs", "src/main.rs"],
      },
      {
        name: "RPC: zbx_feeBounds + CLI --fee auto",
        desc: "zbx_feeBounds returns { min_fee_wei, max_fee_wei, recommended_fee_wei, min_usd, max_usd, source }. New CLI helper resolve_fee() turns the literal string `--fee auto` into a live RPC fetch — used by register-pay-id (default = auto). Wallets/explorers display the live USD-pegged band so users never overpay or get rejected.",
        status: "done",
        version: "v0.1.5",
        files: ["src/rpc.rs", "src/main.rs"],
      },
      {
        name: "🔐 Multisig wallets (M-of-N, full advanced) ✅",
        desc: "Phase B.8 — full advanced multisig wallet support. New TxKind::Multisig with 5 ops (Create / Propose / Approve / Revoke / Execute), all consensus-enforced. Multisig accounts are chain-controlled addresses with NO private key — funds only move when ≥M of N owners approve. Address derivation is deterministic (keccak256 over sorted owners + threshold + salt + creator → last 20 bytes). Owners 2-10, threshold 1..=N, configurable per-proposal expiry (default 24h, max 58 days). Storage in CF_META: `ms/<addr>` for accounts, `mspr/<addr><id>` for proposals, `mso/<owner><addr>` for owner→multisig index. Five RPC endpoints (zbx_getMultisig, zbx_getMultisigProposal, zbx_getMultisigProposals, zbx_listMultisigsByOwner, zbx_multisigCount) plus 8 branded CLI commands (multisig-create, multisig-propose, multisig-approve, multisig-revoke, multisig-execute, multisig-info, multisig-proposals, multisig-list). Atomic execute path with refund-on-failure; balance debited from multisig only on Execute. All ops use --fee auto by default.",
        status: "done",
        version: "v0.1.7",
        files: ["src/multisig.rs", "src/types.rs", "src/state.rs", "src/rpc.rs", "src/main.rs", "src/lib.rs"],
      },
      {
        name: "--fee auto rolled out to ALL CLI commands ✅",
        desc: "Every fee-paying CLI command (send, register-pay-id, validator-add/remove, governor-change, validator-create/edit-commission, stake, unstake, redelegate, claim-rewards) now defaults to --fee auto and routes through resolve_fee(). The legacy static check_fee() floor was removed — dynamic fee bounds are fully consensus-enforced in state::apply_tx. Users no longer need to know the current ZBX/USD rate to pay the right fee. Two-node cluster on VPS verified: Node-1 producer + Node-2 follower fully synced (heights match, zero double-sign).",
        status: "done",
        version: "v0.1.6",
        files: ["src/main.rs"],
      },
      {
        name: "Permissionless pool + auto-swap router (POOL_ADDRESS)",
        desc: "Pool has a magic address (0x7a73776170...) with NO private key — controlled entirely by chain logic. Any normal user who SENDS ZBX to this address triggers an instant auto-swap: their ZBX is consumed by the pool, and zUSD is credited back to their wallet at the current spot rate. Admin transfers are exempted: admin → pool = single-sided liquidity add (no swap, no LP mint). Implemented in State::apply_tx as an interceptor.",
        status: "done",
        version: "v0.1.2",
        files: ["src/state.rs", "src/pool.rs", "src/tokenomics.rs", "src/main.rs"],
      },
      {
        name: "Genesis pool seed (10M ZBX + 10M zUSD loan, admin-bypass)",
        desc: "On `admin-pool-genesis`, chain mints 10M ZBX directly into pool ZBX reserve AND 10M zUSD into pool zUSD reserve as a 'liquidity loan'. Admin receives ZERO — assets are pool-owned. All LP tokens are locked permanently to POOL_ADDRESS so nobody (not even admin) can withdraw the seed liquidity. Pool is provably permissionless from genesis.",
        status: "done",
        version: "v0.1.2",
        files: ["src/state.rs", "src/pool.rs", "src/main.rs"],
      },
      {
        name: "Liquidity loan repayment + 50/50 admin fee split",
        desc: "0.3% swap fee deducted from input is sequestered into a separate fee bucket (NOT added to reserves). After every swap, settle_fees() runs: while the 10M zUSD loan is outstanding, 100% of fees go to repaying it (tokens move into reserves). Once loan = 0, future fees split 50% to admin (real income) + 50% back into reserves (compounding LP value). Lifetime totals tracked: total_fees_collected, total_admin_paid, total_reinvested — all visible via zbx_getPool RPC.",
        status: "done",
        version: "v0.1.2",
        files: ["src/pool.rs"],
      },
      {
        name: "Anti-whale swap limit (100,000 per tx)",
        desc: "Single swap max = 100,000 ZBX or 100,000 zUSD. Bigger trades must split across multiple txs. Protects pool from whale dumps & flash-loan-style price manipulation. Enforced in pool.swap_zbx_for_zusd / swap_zusd_for_zbx (input + output cap).",
        status: "done",
        version: "v0.1.2",
        files: ["src/pool.rs", "src/tokenomics.rs"],
      },
      {
        name: "Pool admin commands (faucet / pool-init / swap)",
        desc: "zebvix-node admin-faucet | admin-pool-init | admin-pool-add | admin-swap | pool-info — direct DB writes (Phase 1, node must be stopped). Phase 2 moves swap/liquidity ops to signed txs through mempool.",
        status: "done",
        version: "v0.1.2",
        files: ["src/main.rs"],
      },
    ],
  },
  {
    group: "Pay-ID Registry (Phase B.7)",
    icon: "🪪",
    features: [
      {
        name: "Pay-ID format: handle@zbx",
        desc: "Human-readable on-chain identity. Handle 3–25 chars, lowercase `[a-z0-9_]`, mandatory `@zbx` suffix. Display name 1–50 chars (mandatory, NOT unique — multiple people can have name 'Rahul Kumar'). Pay-ID is globally unique across the chain.",
        status: "done",
        version: "v0.1.4",
        files: ["src/state.rs", "src/types.rs"],
      },
      {
        name: "TxKind::RegisterPayId — on-chain tx",
        desc: "New transaction kind: `RegisterPayId { pay_id, name }`. Submitted as a normal signed tx, applied at block-apply time. Backward-compatible enum extension (added at end). Fee: 0.002 ZBX.",
        status: "done",
        version: "v0.1.4",
        files: ["src/types.rs", "src/state.rs"],
      },
      {
        name: "1 address = 1 Pay-ID, PERMANENT",
        desc: "An address can register exactly ONE Pay-ID. Once registered: NO edit, NO delete, NO transfer (no TxKind exists for any of these operations). Bidirectional storage: `META_PAYID_PREFIX` (pay_id → address) + `META_PAYID_ADDR_PREFIX` (address → (pay_id, name)). Duplicate Pay-ID attempts = tx rejected. Validation helpers: `validate_payid()` + `validate_payid_name()`.",
        status: "done",
        version: "v0.1.4",
        files: ["src/state.rs"],
      },
      {
        name: "RPC: zbx_lookupPayId / zbx_getPayIdOf / zbx_payIdCount",
        desc: "Three new JSON-RPC methods. `zbx_lookupPayId(pay_id)` → forward resolve to {address, name}. `zbx_getPayIdOf(address)` → reverse resolve. `zbx_payIdCount()` → total registered Pay-IDs on chain. Used by wallets, explorers, and the dashboard.",
        status: "done",
        version: "v0.1.4",
        files: ["src/rpc.rs"],
      },
      {
        name: "CLI: register-pay-id / lookup-pay-id / whois",
        desc: "Three branded CLI commands. `register-pay-id --signer-key <k> --pay-id founder@zbx --name 'Zebvix Founder'` (with permanent-warning banner). `lookup-pay-id founder@zbx` → forward. `whois 0xe381…fecc` → reverse. ✅ VPS-verified live: founder@zbx registered, tx 0x0d1f6d32… confirmed, both forward + reverse lookups working.",
        status: "done",
        version: "v0.1.4",
        files: ["src/main.rs"],
      },
    ],
  },
  {
    group: "JSON-RPC API",
    icon: "🔌",
    features: [
      {
        name: "eth_chainId, eth_blockNumber, eth_getBalance",
        desc: "Ethereum-compatible RPC methods",
        status: "done",
        version: "v0.1",
        files: ["src/rpc.rs"],
      },
      {
        name: "zbx_chainInfo, zbx_supply, zbx_getNonce",
        desc: "Custom Zebvix RPC methods",
        status: "done",
        version: "v0.1",
        files: ["src/rpc.rs"],
      },
      {
        name: "zbx_sendTransaction, zbx_getBlockByNumber",
        desc: "Tx submission + block queries",
        status: "done",
        version: "v0.1",
        files: ["src/rpc.rs"],
      },
      {
        name: "zbx_getPool, zbx_getZusdBalance, zbx_getLpBalance",
        desc: "Pool RPCs: live reserves, spot price ($/ZBX), 0.3% fee bucket, lifetime totals (fees collected, admin paid, reinvested), outstanding 10M zUSD loan balance, LP supply. Plus per-account zUSD and LP token balance lookups.",
        status: "done",
        version: "v0.1.2",
        files: ["src/rpc.rs", "src/pool.rs"],
      },
      {
        name: "zbx_getAdmin, zbx_gasEstimate",
        desc: "zbx_getAdmin returns { current_admin, genesis_admin, changes_used, max_changes, rotations_left }. zbx_gasEstimate returns the live USD-pegged gas price (gwei) derived from pool spot — used by wallets to auto-fill fees.",
        status: "done",
        version: "v0.1.3",
        files: ["src/rpc.rs"],
      },
    ],
  },
  {
    group: "CLI Tools",
    icon: "🛠",
    features: [
      {
        name: "keygen",
        desc: "Generate Ed25519 keypair + 20-byte address",
        status: "done",
        version: "v0.1",
      },
      {
        name: "init",
        desc: "Bootstrap chain with genesis + founder pre-mine",
        status: "done",
        version: "v0.1",
      },
      {
        name: "start",
        desc: "Run block producer + JSON-RPC server",
        status: "done",
        version: "v0.1",
      },
      {
        name: "send",
        desc: "Build, sign, submit transfer txs from CLI",
        status: "done",
        version: "v0.1",
      },
      {
        name: "zbx (user wallet CLI)",
        desc: "Standalone user-facing CLI binary (separate from zebvix-node). Subcommands: new (create wallet), import, show / address (print address from keyfile), balance (ZBX + zUSD combined view), nonce, send, swap (one-shot ZBX → zUSD via pool), zusd (zUSD-only balance), lp (LP token balance), pool (live pool info, spot price, fees, loan), price, gas (current dynamic fee estimate), admin (current admin + rotation status).",
        status: "done",
        version: "v0.1.3",
        files: ["src/bin/zbx.rs"],
      },
      {
        name: "zebvix-node admin commands",
        desc: "Direct-to-DB admin operations (node must be stopped): admin-faucet (mint zUSD for testing), admin-pool-genesis (seed 10M ZBX + 10M zUSD loan), admin-pool-add (add liquidity), admin-swap (manual swap with slippage), pool-info (read-only state), admin-info (current admin + rotations used), admin-change-address (rotate admin, max 3 times).",
        status: "done",
        version: "v0.1.3",
        files: ["src/main.rs"],
      },
      {
        name: "balance — full wallet view",
        desc: "Branded `balance --address 0x…` shows: liquid ZBX + staked amount + locked rewards + daily drip rate + lifetime released + GRAND TOTAL. Live-verified on VPS: founder 17,954 ZBX liquid, rewards pool 246 ZBX. Uses RPC zbx_getStaked + zbx_getLockedRewards + zbx_getDailyDrip aggregation.",
        status: "done",
        version: "v0.1.4",
        files: ["src/main.rs"],
      },
      {
        name: "pool — AMM live inspector",
        desc: "Branded `pool` command: live ZBX/zUSD reserves, spot price, 0.3% fee bucket, lifetime fees collected/admin-paid/reinvested, outstanding 10M zUSD loan balance, total LP supply. Live-verified: 1 ZBX = $1.00, 10M:10M reserves.",
        status: "done",
        version: "v0.1.4",
        files: ["src/main.rs"],
      },
      {
        name: "price — live ZBX/USD",
        desc: "Branded `price` command: pretty-prints current ZBX/USD spot derived from on-chain pool. Calls zbx_getPool, applies x*y=k formula. Live: $1.00.",
        status: "done",
        version: "v0.1.4",
        files: ["src/main.rs"],
      },
      {
        name: "zbx-address / generate-address",
        desc: "Branded wallet generator: produces fresh Ed25519 keypair + 20-byte address with header 'New Zebvix (ZBX) Wallet' showing coin=Zebvix, symbol=ZBX, chain_id=7878. Saves keyfile (secret_hex) on disk for use with --signer-key.",
        status: "done",
        version: "v0.1.4",
        files: ["src/main.rs"],
      },
      {
        name: "register-pay-id / lookup-pay-id / whois",
        desc: "Pay-ID Registry CLI (Phase B.7). See dedicated Pay-ID Registry section above. Live on VPS: founder@zbx registered + queryable both ways.",
        status: "done",
        version: "v0.1.4",
        files: ["src/main.rs"],
      },
    ],
  },
  {
    group: "PoS Staking & Rewards",
    icon: "🥩",
    features: [
      {
        name: "TxKind::Stake / Unstake — on-chain delegation",
        desc: "Typed stake/unstake transactions, applied at block-apply time. Stake locks ZBX into a per-(delegator, validator) bucket; unstake returns it after lock period. Backward-compatible enum extension.",
        status: "done",
        version: "v0.1.4",
        files: ["src/types.rs", "src/staking.rs", "src/state.rs"],
      },
      {
        name: "Locked rewards pool + daily drip",
        desc: "Block-mint rewards accumulate into a per-address LockedRewards bucket and stream out via a daily drip schedule (gradual release prevents instant dump). Lifetime released amount tracked separately. Live: rewards pool seeded with 246 ZBX from mined blocks.",
        status: "done",
        version: "v0.1.4",
        files: ["src/staking.rs", "src/tokenomics.rs"],
      },
      {
        name: "Block-mint pool distribution",
        desc: "Each mined block's reward is split between proposer, staking pool, and locked-rewards drip according to tokenomics constants. REWARDS_POOL constants centralize the split percentages. Halving still applies to total mint per block.",
        status: "done",
        version: "v0.1.4",
        files: ["src/staking.rs", "src/tokenomics.rs"],
      },
      {
        name: "Gas fee redistribution",
        desc: "Tx fees no longer go 100% to proposer. Split: portion → validators (staking pool), portion → delegators, portion → treasury, portion → burn (until burn cap). Removes proposer-only incentive concentration.",
        status: "done",
        version: "v0.1.4",
        files: ["src/state.rs", "src/tokenomics.rs"],
      },
      {
        name: "Burn mechanics with hard cap",
        desc: "Per-tx fee burn share until total burned hits 75M ZBX cap (50% of max supply). After cap: burn share automatically redirects to validators (no more deflation). is_burn_allowed() gate checked every tx.",
        status: "done",
        version: "v0.1.4",
        files: ["src/tokenomics.rs"],
      },
      {
        name: "RPCs: zbx_getStaked / zbx_getLockedRewards / zbx_getDailyDrip",
        desc: "Per-address staking views: total staked across validators, locked rewards balance, current daily drip rate, lifetime released. Used by `balance` CLI + dashboard.",
        status: "done",
        version: "v0.1.4",
        files: ["src/rpc.rs"],
      },
    ],
  },
  {
    group: "Performance (High-TPS)",
    icon: "⚡",
    features: [
      {
        name: "Tokio multi-threaded runtime",
        desc: "Async I/O across all CPU cores",
        status: "done",
        version: "v0.1",
      },
      {
        name: "Rayon parallel tx execution",
        desc: "Parallel signature verification across all CPU cores — 5-10x TPS boost. Auto-enabled for blocks with 4+ txs.",
        status: "done",
        version: "v0.1.1",
        files: ["src/crypto.rs", "src/state.rs"],
      },
      {
        name: "Batch Ed25519 verification",
        desc: "ed25519-dalek batch API — single multi-scalar multiplication for 64 sigs at a time, 3-5x faster than individual verify.",
        status: "done",
        version: "v0.1.1",
        files: ["src/crypto.rs"],
      },
      {
        name: "Block-STM parallel execution",
        desc: "Aptos-style optimistic MVCC parallel execution — 10-50x boost. Scaffold + execution planner ready, MVCC engine in progress.",
        status: "wip",
        version: "v0.3",
        files: ["src/block_stm.rs"],
      },
    ],
  },
  {
    group: "Smart Contracts (ZVM Layer — Phase C)",
    icon: "📜",
    features: [
      {
        name: "ZVM via revm",
        desc: "Embed Rust-native revm 7.x as the contract execution engine. Full ZVM bytecode compatibility (London/Shanghai/Cancun forks); Solidity 0.8+ contracts compile and run unchanged. Gas metered per opcode, hard cap per block (3M default, governable).",
        status: "planned",
        version: "C.1",
        files: ["src/evm.rs (planned)", "src/state.rs"],
      },
      {
        name: "Standard precompiles (0x01–0x0a)",
        desc: "ecrecover, sha256, ripemd160, identity, modexp, ecAdd, ecMul, ecPairing, blake2f — full Ethereum precompile parity so libraries like OpenZeppelin / ZK verifiers work out of the box.",
        status: "planned",
        version: "C.1",
      },
      {
        name: "Custom Zebvix precompiles (0x80–0x90)",
        desc: "Bridge precompile (call BridgeOut from contract), Pay-ID resolver precompile (resolve @alias → address), AMM swap precompile (call ZBX↔zUSD swap from contract), multisig propose precompile — exposes native chain features to Solidity dApps.",
        status: "planned",
        version: "C.2",
      },
      {
        name: "Contract account state",
        desc: "ZVM accounts have nonce, balance (in ZBX wei), code_hash, storage_root. Stored in CF_EVM column family with merkle-patricia-trie compatible layout. Code stored content-addressed (keccak256(code) → bytecode). State root hashed into block header for light-client proofs.",
        status: "planned",
        version: "C.1",
        files: ["src/state.rs", "src/evm_state.rs (planned)"],
      },
      {
        name: "TxKind::EvmCall + TxKind::EvmCreate",
        desc: "Two new tx variants: EvmCreate{init_code, value, gas_limit} deploys a new contract (returns deployed address); EvmCall{to, data, value, gas_limit} invokes a contract function. Both pay gas in ZBX (USD-pegged via AMM, just like native txs). CREATE2 supported via salt parameter.",
        status: "planned",
        version: "C.1",
        files: ["src/transaction.rs"],
      },
      {
        name: "Logs / Events (eth_getLogs)",
        desc: "ZVM LOG0–LOG4 opcodes emit events indexed by (contract_addr, topic0..topic3). Stored in CF_LOGS keyed by (block_height, log_index). RPC zbx_getLogs accepts standard filter object {fromBlock, toBlock, address, topics} — drop-in replacement for eth_getLogs so The Graph / Subgraph indexers work.",
        status: "planned",
        version: "C.2",
      },
      {
        name: "eth_call (read-only simulation)",
        desc: "RPC zbx_ethCall executes a contract call against current state without committing — no fee, no nonce increment. Used by frontends to read contract data (balances, allowances, view functions). Supports state-override (debug_traceCall style) for what-if simulations.",
        status: "planned",
        version: "C.1",
      },
      {
        name: "ERC-20 / ERC-721 / ERC-1155 ready",
        desc: "No special chain support needed — these are pure Solidity standards on top of ZVM. OpenZeppelin contracts deploy as-is. zUSD itself can later be migrated from native ledger entry to a canonical ERC-20 contract for unified tooling.",
        status: "planned",
        version: "C.2",
      },
      {
        name: "Hardhat / Foundry / Remix compatibility",
        desc: "Chain exposes the standard JSON-RPC subset (eth_chainId, eth_blockNumber, eth_getBalance, eth_sendRawTransaction, eth_call, eth_getLogs, eth_estimateGas, eth_gasPrice). Devs deploy with `npx hardhat deploy --network zebvix` or `forge create --rpc-url http://93.127.213.192:8545` — zero Zebvix-specific tooling needed.",
        status: "planned",
        version: "C.2",
      },
      {
        name: "Contract verification + ABI registry",
        desc: "Block-explorer-style RPC zbx_verifyContract uploads source + compiler version + constructor args; chain re-compiles deterministically and stores verified ABI in CF_META. Frontend shows decoded function calls / event names instead of raw hex.",
        status: "planned",
        version: "C.3",
      },
      {
        name: "Reentrancy + gas-limit safety",
        desc: "revm's call-depth limit (1024) + per-call gas forwarding (63/64 rule) prevent DoS. Block gas limit enforced; any tx exceeding budget reverts with full-state-rollback. Refund cap (gas_used / 5) per EIP-3529.",
        status: "planned",
        version: "C.1",
      },
      {
        name: "ZVM <-> native bridge (cross-VM calls)",
        desc: "Solidity contracts can call native chain features (transfer ZBX, swap ZBX↔zUSD, BridgeOut to BSC) via custom precompiles. Conversely, native txs can target ZVM contracts via TxKind::EvmCall. Single state, single fee market, single nonce-space per address.",
        status: "planned",
        version: "C.2",
      },
    ],
  },
  {
    group: "Decentralization",
    icon: "🌐",
    features: [
      {
        name: "P2P networking (libp2p) — Phase A complete",
        desc: "Full multi-node networking. Built on libp2p 0.54 with TCP+Noise+Yamux transport. Three gossipsub topics (chain-id namespaced): `zebvix/<id>/blocks/v1`, `…/txs/v1`, `…/heartbeat/v1`. mDNS for LAN auto-discovery + bootstrap peers via `--peer <multiaddr>`. Producer auto-gossips every mined block; RPC `zbx_sendTransaction` immediately gossips the tx to all peers (no need to wait for next block). Block sync (catch-up) protocol via libp2p request-response (cbor codec, `/zebvix/sync/1.0.0`): when a peer announces tip > ours via heartbeat OR when out-of-order block arrives, we request the missing range [tip+1..=peer_tip] (capped at 256 blocks/request). Peer serves blocks from State, we apply in order. New nodes joining late, downtime recovery, and chain forks all converge to the canonical chain.",
        status: "done",
        version: "v0.2",
        files: ["src/p2p.rs", "src/consensus.rs", "src/main.rs", "src/rpc.rs", "Cargo.toml"],
      },
      {
        name: "Validator set on-chain — Phase B.1 complete",
        desc: "Persistent validator registry in state DB (CF_META `validator/<addr>` prefix). Each `Validator { address, pubkey: ed25519, voting_power: u64 }` is bincode-serialized and indexed by 20-byte address. Genesis seeds the founder validator with power=1. Admin-gated CLI: `validator-add --pubkey 0x… --power N` and `validator-remove --address 0x…` (signer must equal current admin; refuses to empty the set to prevent chain halt). State exposes `validators()`, `total_voting_power()`, and `quorum_threshold()` returning ⌊2N/3⌋+1 — used in B.3 for Tendermint commit. Two new RPCs: `zbx_listValidators` returns full set + totals + quorum; `zbx_getValidator(addr)` returns one. Producer/consensus untouched (still single-validator PoA); B.1 is foundation only.",
        status: "done",
        version: "v0.2",
        files: ["src/types.rs", "src/state.rs", "src/main.rs", "src/rpc.rs"],
      },
      {
        name: "Vote messages (Prevote/Precommit) — Phase B.2 ✅",
        desc: "Ed25519-signed Vote { height, round, block_hash, voter_pubkey } with domain-tag separation. VotePool tracks per-(height, round) votes with double-sign detection (slashing-ready). Dedicated gossipsub topic `zebvix/7878/votes/v1`. RPC `zbx_voteStats` exposes live vote count + voting power per height. ✅ VPS-verified: 2/2 quorum on EVERY block, both nodes vote independently and see each other.",
        status: "done",
        version: "v0.2",
        files: ["src/vote.rs", "src/p2p.rs", "src/rpc.rs"],
      },
      {
        name: "On-chain governance txs — Phase B.3.1 ✅",
        desc: "TxKind enum: Transfer / ValidatorAdd / ValidatorRemove (typed tx body). Governance txs are admin-gated; last-validator removal blocked. CLI validator-add/remove now submits via RPC (no direct DB write). `submit_tx_strict` helper detects real RPC errors (no more silent fake-success). ✅ VPS PROOF: tx 0xdf109d69… → both nodes logged 'validator-add applied' independently; founder nonce 0 → 1 verified.",
        status: "done",
        version: "v0.2",
        files: ["src/types.rs", "src/state.rs", "src/main.rs"],
      },
      {
        name: "Tendermint state machine — Phase B.3 (full)",
        desc: "Propose → Prevote → Precommit → Commit rounds with timeouts, locking, and 2/3+ supermajority. Vote pool + governance already live; full round-based state machine + double-sign slashing pending.",
        status: "wip",
        version: "v0.2",
      },
    ],
  },
  {
    group: "Multisig Wallets (Phase B.5)",
    icon: "🛡",
    features: [
      {
        name: "On-chain multisig vault registry",
        desc: "Create N-of-M signer wallets with threshold-based approval; addresses derived deterministically from signer set + nonce",
        status: "done",
        version: "B.5",
        files: ["src/multisig.rs", "src/state.rs"],
      },
      {
        name: "MultisigOp::CreateVault",
        desc: "Founder/user signs a tx that registers a new multisig with signer addresses + threshold; vault gets its own ZBX/zUSD balance",
        status: "done",
        version: "B.5",
        files: ["src/multisig.rs"],
      },
      {
        name: "MultisigOp::Propose / Approve / Execute",
        desc: "Any signer proposes a transfer/admin-op; other signers approve; once threshold met anyone can execute (atomic state change + fee debit)",
        status: "done",
        version: "B.5",
        files: ["src/multisig.rs", "src/state.rs"],
      },
      {
        name: "Multisig RPCs + Explorer page",
        desc: "zbx_listMultisigs, zbx_getMultisigVault, zbx_listMultisigProposals — dashboard 'Multisig Explorer' tab live",
        status: "done",
        version: "B.5",
        files: ["src/rpc.rs", "src/pages/multisig-explorer.tsx"],
      },
    ],
  },
  {
    group: "AMM Swap Pool — ZBX/zUSD (Phase B.10)",
    icon: "🔁",
    features: [
      {
        name: "Constant-product AMM (x*y=k)",
        desc: "Single canonical pool: ZBX paired with zUSD stablecoin; spot price = pool_zusd / pool_zbx; LP-style admin-funded reserves",
        status: "done",
        version: "B.10",
        files: ["src/amm.rs", "src/state.rs"],
      },
      {
        name: "AdminPoolGenesis & AdminPoolAdd",
        desc: "Founder seeds initial pool reserves and tops up liquidity; protected by admin auth; emits PoolUpdated events",
        status: "done",
        version: "B.10",
        files: ["src/amm.rs"],
      },
      {
        name: "TxKind::Swap (user-facing)",
        desc: "Any user swaps ZBX↔zUSD via TxKind::Swap{direction, amount_in, min_out}; slippage protection + 0.3% pool fee",
        status: "done",
        version: "B.10",
        files: ["src/transaction.rs", "src/state.rs"],
      },
      {
        name: "USD-pegged dynamic gas fees",
        desc: "Tx fees expressed in $0.001–$0.05 USD range; converted to ZBX wei using live AMM spot price; consensus enforces fee_bounds_wei window",
        status: "done",
        version: "B.10",
        files: ["src/state.rs", "src/rpc.rs (zbx_feeBounds)"],
      },
      {
        name: "Pool RPCs + DEX/Swap dashboard pages",
        desc: "zbx_getPool, zbx_quoteSwap, zbx_feeBounds — DEX page shows reserves, Swap page lets users sign-and-send via MetaMask",
        status: "done",
        version: "B.10",
        files: ["src/rpc.rs", "src/pages/dex.tsx", "src/pages/swap.tsx"],
      },
    ],
  },
  {
    group: "secp256k1 ETH-Compatible Signing (Phase B.11)",
    icon: "🔑",
    features: [
      {
        name: "secp256k1 + Keccak256 (Ed25519 deprecated)",
        desc: "Switched chain-wide signing scheme to Ethereum's curve so MetaMask, Trust Wallet, hardware wallets work natively. Address = keccak256(uncompressed_pubkey[1..])[12..]",
        status: "done",
        version: "B.11",
        files: ["src/crypto.rs"],
      },
      {
        name: "EIP-191 personal_sign tx envelope",
        desc: "Tx hashes wrapped in '\\x19Ethereum Signed Message:\\n' prefix so MetaMask's eth_sign / personal_sign yields valid Zebvix tx signatures",
        status: "done",
        version: "B.11",
        files: ["src/transaction.rs", "src/crypto.rs"],
      },
      {
        name: "Recoverable signatures (v, r, s)",
        desc: "65-byte signature with recovery byte; chain recovers signer pubkey from sig + msg_hash, derives address — no signer hint needed in tx",
        status: "done",
        version: "B.11",
        files: ["src/crypto.rs"],
      },
      {
        name: "MetaMask network registration ready",
        desc: "Chain ID 7878, RPC http://93.127.213.192:8545, currency ZBX (18 dec) — users can add Zebvix as custom ZVM-style network in MetaMask",
        status: "done",
        version: "B.11",
        files: ["src/rpc.rs"],
      },
      {
        name: "Founder/admin key as ETH key",
        desc: "Same secp256k1 key signs blocks (consensus), admin ops (governance), AMM swaps (user), bridge ops (oracle) — single identity across all roles",
        status: "done",
        version: "B.11",
        files: ["src/main.rs", "src/bin/zbx.rs"],
      },
    ],
  },
  {
    group: "BEP20 / ZVM Bridge Module (Phase B.12) ✅ LIVE",
    icon: "🌉",
    features: [
      {
        name: "On-chain bridge registry (admin-extensible)",
        desc: "Two registries: BridgeNetwork (id, name, kind=evm/cosmos/solana, rpc_url, active) and BridgeAsset (asset_id, network_id, native=ZBX|zUSD, contract, decimals); founder adds new networks/assets via signed tx — no off-chain hard-coding",
        status: "done",
        version: "B.12",
        files: ["src/bridge.rs", "src/state.rs"],
      },
      {
        name: "TxKind::Bridge — 6 admin/user ops",
        desc: "RegisterNetwork, SetNetworkActive, RegisterAsset, SetAssetActive (admin-only) + BridgeOut, BridgeIn (user/oracle); tag_index=9 in tx envelope",
        status: "done",
        version: "B.12",
        files: ["src/transaction.rs", "src/bridge.rs"],
      },
      {
        name: "Outbound: lock-vault pattern",
        desc: "User signs BridgeOut{asset_id, dest_address}: chain debits user balance, credits system vault 0x7a627…0000, emits sequenced BridgeOutEvent for off-chain relayer to mint on destination chain",
        status: "done",
        version: "B.12",
        files: ["src/state.rs (apply_tx Bridge arm)", "src/tokenomics.rs"],
      },
      {
        name: "Inbound: replay-protected admin claims",
        desc: "Admin/oracle signs BridgeIn{asset_id, source_tx_hash, recipient, amount}: chain checks claim-set is unused, debits vault, credits recipient, marks claim used; oracle gas refunded same-block (fee-neutral)",
        status: "done",
        version: "B.12",
        files: ["src/state.rs", "src/bridge.rs"],
      },
      {
        name: "7 read-only bridge RPCs",
        desc: "zbx_listBridgeNetworks, zbx_getBridgeNetwork, zbx_listBridgeAssets (filterable), zbx_getBridgeAsset, zbx_recentBridgeOutEvents (cap 100), zbx_isBridgeClaimUsed, zbx_bridgeStats",
        status: "done",
        version: "B.12",
        files: ["src/rpc.rs"],
      },
      {
        name: "8 bridge CLI verbs (zebvix-node binary)",
        desc: "bridge-register-network, bridge-set-network-active, bridge-register-asset, bridge-out, bridge-in, bridge-networks, bridge-assets, bridge-stats — auto-scales amount based on asset.native (ZBX→18dec, zUSD→6dec)",
        status: "done",
        version: "B.12",
        files: ["src/main.rs"],
      },
      {
        name: "BNB Chain (id=56) registered LIVE",
        desc: "On VPS srv1266996: BNB Chain registered as evm network, ZBX (decimals=18, asset_id=240518168576) registered as bridgeable asset; admin auth + fee economics validated end-to-end",
        status: "done",
        version: "B.12",
      },
    ],
  },
  {
    group: "Bridge Oracle Daemon (Phase B.13 — planned)",
    icon: "🛰",
    features: [
      {
        name: "Off-chain BSC ↔ Zebvix relayer",
        desc: "Python/Node.js daemon listens to Zebvix BridgeOutEvent → mints BEP20 ZBX on BSC; reverse listens to BSC contract Lock events → broadcasts BridgeIn admin-tx",
        status: "planned",
        version: "B.13",
      },
      {
        name: "BEP20 ZBX contract on BSC",
        desc: "Solidity ERC20-compat token with mint-on-bridge-in, burn-on-bridge-out; governance controlled by lock-vault contract address",
        status: "planned",
        version: "B.13",
      },
      {
        name: "Multisig oracle (M-of-N admin)",
        desc: "Replace single founder oracle with 2-of-3 / 3-of-5 signed BridgeIn; consensus aggregates partial sigs",
        status: "planned",
        version: "B.13+",
      },
    ],
  },
  {
    group: "Storage & Indexing",
    icon: "💾",
    features: [
      {
        name: "libmdbx storage engine (optional)",
        desc: "Drop-in RocksDB replacement, 2-3x faster reads",
        status: "planned",
        version: "v0.3",
      },
      {
        name: "Block explorer indexer",
        desc: "Postgres-backed indexer for tx/block search",
        status: "planned",
        version: "v0.2",
      },
    ],
  },
];

const STATUS_META: Record<
  FeatureStatus,
  { label: string; icon: typeof CheckCircle2; color: string; badge: string }
> = {
  done: {
    label: "Done",
    icon: CheckCircle2,
    color: "text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  wip: {
    label: "In Progress",
    icon: Clock,
    color: "text-amber-400",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  planned: {
    label: "Planned",
    icon: Circle,
    color: "text-slate-500",
    badge: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  },
};

export default function ChainStatus() {
  const allFeatures = GROUPS.flatMap((g) => g.features);
  const done = allFeatures.filter((f) => f.status === "done").length;
  const wip = allFeatures.filter((f) => f.status === "wip").length;
  const planned = allFeatures.filter((f) => f.status === "planned").length;
  const total = allFeatures.length;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-purple-400" /> Chain Features
        </h1>
        <p className="text-slate-400">
          Zebvix L1 mein abhi tak kya kya hai aur aage kya add hoga — complete progress tracker
        </p>
      </div>

      {/* Stats overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-emerald-950/30 border-emerald-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-emerald-400">{done}</div>
            <div className="text-xs text-emerald-300/80 mt-1">Done</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-950/30 border-amber-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-amber-400">{wip}</div>
            <div className="text-xs text-amber-300/80 mt-1">In Progress</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-slate-300">{planned}</div>
            <div className="text-xs text-slate-400 mt-1">Planned</div>
          </CardContent>
        </Card>
        <Card className="bg-purple-950/30 border-purple-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-purple-300">{pct}%</div>
            <div className="text-xs text-purple-300/80 mt-1">v0.1 Complete</div>
          </CardContent>
        </Card>
      </div>

      {/* Groups */}
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <Card key={g.group} className="bg-slate-900/40 border-slate-700/50">
            <CardHeader>
              <CardTitle className="text-lg text-white flex items-center gap-2">
                <span className="text-2xl">{g.icon}</span> {g.group}
              </CardTitle>
              <CardDescription className="text-slate-500 text-xs">
                {g.features.filter((f) => f.status === "done").length} / {g.features.length} done
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {g.features.map((f, i) => {
                const meta = STATUS_META[f.status];
                const Icon = meta.icon;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-md bg-slate-950/40 border border-slate-800/60"
                    data-testid={`feature-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="text-sm font-medium text-slate-200">{f.name}</div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {f.version && (
                            <Badge className="text-[10px] bg-slate-800 text-slate-400 border-slate-700 border">
                              {f.version}
                            </Badge>
                          )}
                          <Badge className={`text-[10px] border ${meta.badge}`}>
                            {meta.label}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{f.desc}</div>
                      {f.files && f.files.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {f.files.map((file) => (
                            <span
                              key={file}
                              className="text-[10px] font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800"
                            >
                              {file}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
