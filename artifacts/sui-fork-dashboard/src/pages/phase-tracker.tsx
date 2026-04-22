import React, { useState, useEffect } from "react";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Trophy, GitCommit, Plus, Edit2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const STORAGE_KEY = "zebvix-phase-tracker";

const CHANGES_LOG = [
  {
    phase: "P1",
    date: "Apr 21, 2026",
    color: "text-green-400",
    dot: "bg-green-500",
    entries: [
      { type: "add", text: "Binary name: sui-node → zebvix-node (Cargo.toml [[bin]] section)" },
      { type: "change", text: "Config directory: ~/.sui → ~/.zebvix" },
      { type: "change", text: "Token constant: MIST_PER_SUI → MIST_PER_ZBX (gas_coin.rs)" },
      { type: "change", text: "Token constant: TOTAL_SUPPLY_SUI → TOTAL_SUPPLY_ZBX" },
      { type: "change", text: "governance.rs import fix: MIST_PER_SUI → MIST_PER_ZBX" },
      { type: "add", text: "114MB binary built: /usr/local/bin/zebvix-node" },
    ],
  },
  {
    phase: "P2",
    date: "Apr 21, 2025",
    color: "text-yellow-400",
    dot: "bg-yellow-500",
    entries: [
      { type: "change", text: "SUI_ADDRESS_LENGTH: 32 → 20 bytes (EVM-compatible)" },
      { type: "change", text: "Address derivation: last 20 bytes of Blake2b256 hash (4 functions)" },
      { type: "change", text: "ObjectID → SuiAddress: last 20 bytes of 32-byte ID" },
      { type: "change", text: "AccountAddress → SuiAddress: last 20 bytes" },
      { type: "change", text: "SuiAddress → AccountAddress: pad with 12 zero bytes" },
      { type: "change", text: "sui_sdk_types_conversions.rs: address conversion fix" },
    ],
  },
  {
    phase: "P3",
    date: "Apr 21, 2025",
    color: "text-blue-400",
    dot: "bg-blue-500",
    entries: [
      { type: "add", text: "MAX_TOTAL_SUPPLY_ZBX = 150,000,000 (hard cap)" },
      { type: "add", text: "GENESIS_SUPPLY_ZBX = 2,000,000" },
      { type: "add", text: "FIRST_HALVING_ZBX = 50,000,000" },
      { type: "add", text: "SECOND_HALVING_ZBX = 100,000,000" },
      { type: "add", text: "INITIAL_BLOCK_REWARD_MIST = 100,000,000 (0.1 ZBX)" },
      { type: "add", text: "GAS_NODE_BPS = 2200 (22% → node runners — sirf node chalane wale)" },
      { type: "add", text: "GAS_VALIDATOR_BPS = 3000 (30% → validators staking reward)" },
      { type: "add", text: "GAS_DELEGATOR_BPS = 2000 (20% → delegators)" },
      { type: "add", text: "GAS_TREASURY_BPS = 1800 (18% → founder treasury)" },
      { type: "add", text: "GAS_BURN_BPS = 1000 (10% burn 🔥 — jab tak 75M cap na aa jaye)" },
      { type: "add", text: "get_halving_multiplier(total_minted) function" },
      { type: "add", text: "adjusted_block_reward(total_minted) function" },
    ],
  },
  {
    phase: "P3",
    date: "Apr 21, 2026",
    color: "text-orange-400",
    dot: "bg-orange-500",
    label: "Burn Cap",
    entries: [
      { type: "add", text: "MAX_BURN_SUPPLY_MIST = 75_000_000 × 10⁹ (50% of max supply = 75M ZBX hard burn cap)" },
      { type: "add", text: "is_burn_allowed(total_burned_mist: u64) → bool function (gas_coin.rs)" },
      { type: "add", text: "Burn gate: if total_burned >= MAX_BURN_SUPPLY_MIST → burn skip, amount validators ko jaata hai" },
      { type: "change", text: "GAS_BURN_BPS logic: automatic fee deduction per txn — koi manual burn nahi" },
      { type: "change", text: "After-cap fee split: 82% validators + 18% treasury (burn share redirect)" },
    ],
  },
  {
    phase: "P3",
    date: "Apr 21, 2026",
    color: "text-red-400",
    dot: "bg-red-500",
    label: "MultiSig Rules",
    entries: [
      { type: "add", text: "MAX_MULTISIG_SIGNERS = 10 (base_types.rs) — ek multisig mein max 10 signers" },
      { type: "add", text: "MAX_SIGNER_WEIGHT: u16 = 255 — har signer ka max weight" },
      { type: "add", text: "TREASURY_MULTISIG_THRESHOLD = 3/5 (60%) — Zebvix Technologies treasury ke liye minimum" },
      { type: "add", text: "CHAIN_UPGRADE_THRESHOLD = 4/6 (67%) — protocol upgrade ke liye 2/3 supermajority" },
      { type: "add", text: "VALIDATOR_KEY_ROTATION_THRESHOLD = 3/5 — validator hot-key change ke liye minimum" },
      { type: "add", text: "validate_multisig_threshold(weights, threshold) → Result function (crypto/multisig.rs)" },
      { type: "change", text: "MultiSigPublicKey: threshold enforce hoga — threshold > 0 AND threshold ≤ Σ(weights) check" },
      { type: "change", text: "Supported key types: Ed25519 (primary), Secp256k1, Secp256r1 — ZkLogin bhi allowed" },
    ],
  },
  {
    phase: "P4",
    date: "Apr 21, 2026",
    color: "text-violet-400",
    dot: "bg-violet-500",
    label: "ZBX Pay ID",
    entries: [
      { type: "add", text: "Module: zebvix::pay_id (Fabric Layer — Move contract)" },
      { type: "add", text: "PayIdRegistry: shared object — chain-wide global registry (ek hi instance)" },
      { type: "add", text: "PayId struct { pay_id, full_id, display_name, owner, created_epoch } — immutable on-chain object" },
      { type: "add", text: "Format: pay_id = 'rahul' → full_id = 'rahul@zbx' (unique), display_name = 'Rahul Kumar' (mandatory, NOT unique)" },
      { type: "add", text: "register_pay_id(registry, pay_id, display_name): dono required — E_NAME_EMPTY ya E_DISPLAY_NAME_EMPTY se abort" },
      { type: "add", text: "Uniqueness rule: sirf pay_id globally unique — display_name pe koi uniqueness check nahi (do log same naam rakh sakte hain)" },
      { type: "add", text: "E_DISPLAY_NAME_EMPTY: u64 = 6 — display_name empty diya to abort, but duplicate naam allowed" },
      { type: "add", text: "Bidirectional map: name_to_addr + addr_to_name — pay_id duplicate = E_NAME_TAKEN abort" },
      { type: "add", text: "transfer_to_pay_id<T>(registry, pay_id, coin, ctx) — pay_id se seedha coin/token transfer" },
      { type: "add", text: "resolve_pay_id(registry, pay_id) → address — naam se wallet address lookup" },
      { type: "add", text: "get_display_name(pay_id_obj) + get_full_id(pay_id_obj) — view helpers" },
      { type: "change", text: "PayId: has key only (no store) — VM level pe transfer/delete permanently blocked" },
      { type: "change", text: "Ek address = sirf ek ID — dusra register attempt = E_ALREADY_REGISTERED abort" },
    ],
  },
  {
    phase: "P4",
    date: "Apr 21, 2026",
    color: "text-cyan-400",
    dot: "bg-cyan-500",
    label: "Master Pool AMM",
    entries: [
      { type: "add", text: "Module: zebvix::master_pool — ZBX native coin ka ek global decentralized base pool (shared object, no admin key)" },
      { type: "add", text: "MasterPool struct { zbx_reserve: Balance<ZBX>, total_volume: u64 } — koi bhi admin nahi, protocol-owned" },
      { type: "add", text: "Module: zebvix::sub_pool — koi bhi SubPool<T> create kar sakta hai (linked to MasterPool)" },
      { type: "add", text: "SubPool<T> struct { token_reserve: Balance<T>, zbx_reserve: Balance<ZBX>, creator_fee_addr: address, fee_bps: u64 } — no owner field" },
      { type: "add", text: "AMM formula: x × y = k (constant product) — price automatic adjust hoti hai buy/sell se" },
      { type: "add", text: "buy<T>(sub_pool, zbx_in, ctx): ZBX de do, token lo — liquidity pool automatically adjust" },
      { type: "add", text: "sell<T>(sub_pool, token_in, ctx): token do, ZBX lo — pool khud rebalance karta hai" },
      { type: "add", text: "Creator fee: har buy/sell/swap pe fee_bps (e.g. 30 bps = 0.3%) creator_fee_addr ko jaati hai" },
      { type: "add", text: "MANUAL_LIQUIDITY_DISABLED: bool = true — add_liquidity() aur remove_liquidity() permanently abort" },
      { type: "add", text: "One-way liquidity add: agar koi ZBX deposit kar bhi de to remove_liquidity = abort — permanently locked in pool" },
      { type: "change", text: "Liquidity sirf trades se adjust hoti hai — buy se token badhta hai ZBX kamta hai, sell se ulta" },
      { type: "change", text: "SubPool creator = fee recipient only — koi ownership, no pause, no rug pull, no drain function" },
    ],
  },
  {
    phase: "P5",
    date: "Apr 21, 2026",
    color: "text-pink-400",
    dot: "bg-pink-500",
    label: "Validator Staking Pool",
    entries: [
      { type: "add", text: "Module: zebvix::staking_pool — ek global permissionless pool (shared object, no admin)" },
      { type: "add", text: "MAX_VALIDATORS: u64 = 41 — sirf 41 validator slots; 41 active hone ke baad naya validator nahi ban sakta" },
      { type: "add", text: "MIN_VALIDATOR_STAKE: u64 = 10,000 ZBX — koi bhi is amount ko stake + node run kar ke validator slot le sakta hai" },
      { type: "add", text: "MAX_VALIDATOR_STAKE: u64 = 250,000 ZBX — ek validator apni KHUD ki stake maximum 250K ZBX kar sakta hai (delegators alag)" },
      { type: "add", text: "GLOBAL_STAKE_CAP: u64 = 5,000,000 ZBX — poore network ka total stake (ALL validators + ALL delegators mila ke) 5M se zyada nahi hoga" },
      { type: "add", text: "Math: 41 slots × 10,000 min = 4,10,000 ZBX minimum commitment; 1 validator join kare → 4,00,000 bachi baaki 40 ke liye" },
      { type: "add", text: "VALIDATOR_STAKING_APR: u64 = 120 — validators ko 120% APR unke apne staked amount pe" },
      { type: "add", text: "NODE_DAILY_REWARD: u64 = 5 ZBX/day — node run karne ke liye alag se 5 ZBX daily reward per node" },
      { type: "add", text: "Delegator system: koi bhi user kisi bhi validator pe ZBX stake kar sakta hai — khud validator bane bina" },
      { type: "add", text: "DELEGATOR_APR: u64 = 80 — delegators ko 80% APR milega apne staked amount pe (bina node chalaye)" },
      { type: "add", text: "VALIDATOR_DELEGATION_BONUS_APR: u64 = 40 — validator ko delegated amount pe extra 40% APR (jitne zyada delegators, utna bonus)" },
      { type: "add", text: "distribute_epoch_reward(pool, reward_coin, ctx): naya function — har epoch ka reward split karta hai" },
      { type: "add", text: "  Reward split logic: active_share = total × (active_validators / 41) → reward_balance mein" },
      { type: "add", text: "  Empty slot subsidy: (41 − active) / 41 × total → founder_treasury address pe" },
      { type: "add", text: "  0 validators (pre-launch): poora reward → founder treasury" },
      { type: "add", text: "  Sab 41 slots bhar gaye: poora reward → reward_balance (validators/delegators claim karte hain)" },
      { type: "add", text: "delegate(pool, validator_addr, zbx_coin, ctx): kisi bhi validator pe delegation" },
      { type: "add", text: "undelegate(pool, delegation_obj, ctx): delegation wapas le — lock period ke baad" },
      { type: "add", text: "claim_delegation_rewards(pool, delegation_obj, ctx): delegator apna APR reward claim karo" },
      { type: "add", text: "Global cap rule: agar total_staked = 5M ZBX → aur stake attempt = E_GLOBAL_CAP_REACHED abort (koi per-slot limit nahi)" },
      { type: "add", text: "Validator stake limit: agar apna stake > 250K → E_MAX_VALIDATOR_STAKE abort (delegators ke liye koi limit nahi, global cap tak)" },
      { type: "add", text: "Validator cap rule: 41 active validators ke baad stake attempt = E_VALIDATOR_CAP_REACHED abort" },
      { type: "add", text: "NODE_BOND_MIST: u64 = 100 × 10⁹ — har node runner ko 100 ZBX collateral lock karna padega" },
      { type: "add", text: "  • bond SEPARATE hai stake se — staking total aur APR mein count nahi hoga" },
      { type: "add", text: "  • bond locked rahega jab tak validator unstake nahi karta — phir poora wapas milega" },
      { type: "add", text: "  • future upgrade: agar node offline/misbehave kare → bond slash ho sakta hai" },
      { type: "add", text: "E_BOND_WRONG_AMOUNT = 10 — agar bond coin exactly 100 ZBX nahi → abort" },
      { type: "add", text: "ValidatorStake struct: node_bond: Balance<ZBX> field add kiya (100 ZBX locked)" },
      { type: "add", text: "stake(pool, zbx_coin, bond_coin, node_wallet, ctx): validator self-stake + 100 ZBX bond — 10K min, 250K max" },
      { type: "fix", text: "BUG FIX: claim_node_reward() ab last_reward_epoch update karta hai — infinite reward exploit band" },
      { type: "fix", text: "BUG FIX: unstake() mein active_validators > 0 guard — u64 underflow nahi hoga" },
      { type: "fix", text: "BUG FIX: claim_rewards() + claim_node_reward() mein epoch underflow guard (last >= current → return zero)" },
      { type: "fix", text: "BUG FIX: step3_constants.sh — is_slot_full() ab MAX_VALIDATOR_STAKE_MIST use karta hai (pehle undefined MAX_STAKE_PER_VALIDATOR tha)" },
      { type: "fix", text: "MIGRATION: step2/step3/step4 shell scripts python3 → Node.js (VPS pe python3 available nahi)" },
      { type: "add", text: "unstake(pool, stake_obj, ctx): validator exit — 1 epoch lock" },
      { type: "add", text: "claim_rewards(pool, stake_obj, ctx): 120% APR claim — validator share" },
      { type: "add", text: "claim_node_reward(pool, node_wallet, ctx): 5 ZBX/day per node — daily claim (delegator ko nahi milta)" },
      { type: "add", text: "NodeWallet: har node runner ke liye dedicated on-chain wallet object (node identity)" },
      { type: "add", text: "global_cap_remaining() + is_global_cap_reached(): view functions for UI/apps" },
      { type: "change", text: "Permissionless validator — sirf 41 slots, first-come-first-served, 10K–250K stake + node required" },
      { type: "change", text: "Delegator = stake karo bina node chalaye — validator select karo, APR ka hissa pao (global 5M tak)" },
    ],
  },
  {
    phase: "P5",
    date: "Apr 21, 2026",
    color: "text-amber-400",
    dot: "bg-amber-500",
    label: "Founder Admin Wallet",
    entries: [
      { type: "add", text: "FounderAdminCap: special capability object — chain upgrade authority (founder ke paas)" },
      { type: "add", text: "Founder wallet = Admin MultiSig wallet — core chain change impossible, sirf naye features add ho sakte hain" },
      { type: "add", text: "add_feature(admin_cap, feature_code, ctx): naya Move module ya feature deploy kar sakte hain" },
      { type: "add", text: "Chain core rules (block reward, address format, supply cap) — immutable even for founder" },
      { type: "add", text: "FounderAdminCap: treasury surplus receiver jab tak koi validator active nahi hai" },
      { type: "add", text: "Founder treasury address: MultiSig wallet (e.g. 3/5 threshold) — single point of failure nahi" },
      { type: "change", text: "Founder ≠ God Mode — chain consensus, tokenomics constants, address format change NAHI kar sakta" },
      { type: "change", text: "Founder = Feature Deployer — new contracts, new modules, protocol enhancements only" },
      { type: "change", text: "Admin MultiSig: CHAIN_UPGRADE_THRESHOLD = 4/6 (67%) — feature add ke liye supermajority required" },
    ],
  },
  {
    phase: "P6",
    date: "Apr 21, 2026",
    color: "text-pink-400",
    dot: "bg-pink-500",
    label: "Move Contracts Written",
    entries: [
      { type: "add", text: "zbx_token.move (91 lines) — ZBX native token, OTW pattern, 2M genesis mint, 150M cap, MintAuthority shared obj" },
      { type: "add", text: "pay_id.move (147 lines) — PayIdRegistry, PayId struct, register_pay_id(), transfer_to_pay_id<T>()" },
      { type: "add", text: "staking_pool.move (347 lines) — ValidatorStake, DelegatorStake, StakingPool, NodeWallet — full APR system" },
      { type: "add", text: "master_pool.move (117 lines) — MasterPool shared obj, x*y=k AMM, add/remove_liquidity permanently DISABLED" },
      { type: "add", text: "sub_pool.move (228 lines) — SubPool<T> permissionless, buy/sell/swap_a_to_b, anti-rug locks" },
      { type: "add", text: "founder_admin.move (136 lines) — FounderAdminCap, FeatureRecord, add_feature(), update_admin()" },
      { type: "add", text: "Move.toml (14 lines) — package manifest: name=zebvix, edition=2024, deps=Sui" },
      { type: "add", text: "zebvix-full-source.tar.gz (78MB) — complete Sui clone + all 6 patches applied, ready for VPS build" },
      { type: "add", text: "apply_patches.sh — ek command se saari patches apply: bash apply_patches.sh ~/zebvix-node" },
      { type: "change", text: "DEPLOY STATUS: Move modules WRITTEN & archived — VPS pe actual deploy karna baaki hai (P6 task list)" },
    ],
  },
  {
    phase: "P7",
    date: "Pending",
    color: "text-amber-400",
    dot: "bg-amber-500",
    label: "Ecosystem Setup",
    entries: [
      { type: "add", text: "GitHub repo: ZebvixTech/zebvix-node — push zebvix-full-source.tar.gz contents" },
      { type: "add", text: "GitHub repo: ZebvixTech/zebvix-explorer — sui-explorer fork + ZBX branding" },
      { type: "add", text: "GitHub repo: ZebvixTech/zebvix.js — @mysten/sui.js fork renamed to zebvix.js" },
      { type: "add", text: "Block Explorer: deploy on domain (e.g. explorer.zebvix.network)" },
      { type: "add", text: "ZBX Wallet: Chrome extension build + publish" },
      { type: "add", text: "Testnet Faucet: deploy on testnet.zebvix.network" },
      { type: "add", text: "Mainnet Domain: zebvix.network + docs.zebvix.network" },
      { type: "add", text: "Documentation: full technical docs publish karo" },
      { type: "change", text: "STATUS: Ye saare tasks VPS node launch ke BAAD karne hain (P5 complete hone ke baad)" },
    ],
  },
  {
    phase: "B.1",
    date: "Apr 22, 2026",
    color: "text-emerald-400",
    dot: "bg-emerald-500",
    label: "Custom Rust Chain — Validator Registry",
    entries: [
      { type: "add", text: "PIVOT: Sui-fork chhoda, clean Rust L1 likha — zebvix-chain/ (lean codebase, full control)" },
      { type: "add", text: "Phase A: 2-node P2P sync ✅ — libp2p gossip, heartbeat, block sync verified on VPS" },
      { type: "add", text: "ValidatorRegistry: RocksDB-backed on-chain validator set with power, pubkey, address" },
      { type: "add", text: "CLI: validator-add / validator-remove / validator-list — admin-gated" },
      { type: "add", text: "RPC: zbx_validatorList, zbx_validatorInfo" },
      { type: "add", text: "Founder address hardcoded as initial admin: 0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc" },
    ],
  },
  {
    phase: "B.2",
    date: "Apr 22, 2026",
    color: "text-teal-400",
    dot: "bg-teal-500",
    label: "Vote Messages (BFT prep)",
    entries: [
      { type: "add", text: "Vote struct: Ed25519-signed { height, round, block_hash, voter_pubkey } with domain tag" },
      { type: "add", text: "VotePool: per-(height,round) vote tracking with double-sign detection (slashing-ready)" },
      { type: "add", text: "Gossipsub topic: zebvix/7878/votes/v1 — separate from blocks/heartbeat" },
      { type: "add", text: "RPC: zbx_voteStats — live vote count + voting power per height" },
      { type: "add", text: "VPS verified: 2/2 quorum on EVERY block — both nodes vote independently, see each other" },
    ],
  },
  {
    phase: "B.3.1",
    date: "Apr 22, 2026",
    color: "text-cyan-400",
    dot: "bg-cyan-500",
    label: "On-chain Validator Updates",
    entries: [
      { type: "add", text: "TxKind enum: Transfer / ValidatorAdd / ValidatorRemove (typed tx body)" },
      { type: "add", text: "apply_tx dispatch: governance txs admin-gated; last-validator removal blocked" },
      { type: "change", text: "CLI validator-add/remove ab RPC ke through tx submit karta hai (no direct DB write)" },
      { type: "add", text: "submit_tx_strict helper: real RPC error detection — no more silent fake-success" },
      { type: "fix", text: "Bug fix: default validator-tx fee bumped 0.001 → 0.002 ZBX (above MIN_TX_FEE_WEI)" },
      { type: "fix", text: "Bug fix: systemd unit ne 'start' command pe gairzaroori --validator-key flag pass kar raha tha" },
      { type: "fix", text: "Bug fix: keyfile sirf secret_hex store karta hai — pubkey ko Python Ed25519 se derive kiya" },
      { type: "add", text: "🎉 VPS PROOF: tx 0xdf109d69... bheji → DONO nodes ne 'validator-add applied' log kiya independently" },
      { type: "add", text: "Founder nonce 0 → 1 verified — registry ab block-apply ke through replicate hota hai (no manual mirror)" },
    ],
  },
];

const PHASES = [
  {
    id: "P1", title: "Binary Build",
    color: "from-green-500 to-emerald-600", lightColor: "text-green-400",
    borderColor: "border-green-500/40", bgColor: "bg-green-500/5",
    points: [
      { id: "p1_1", text: "Sui repo clone kiya (mainnet-v1.69.2)" },
      { id: "p1_2", text: "Binary naam change kiya: zebvix-node (Cargo.toml [[bin]])" },
      { id: "p1_3", text: "Config dir change kiya: .sui → .zebvix" },
      { id: "p1_4", text: "Token rename kiya: SUI → ZBX (gas_coin.rs)" },
      { id: "p1_5", text: "MIST_PER_SUI → MIST_PER_ZBX (saari files mein grep + sed)" },
      { id: "p1_6", text: "governance.rs import fix (MIST_PER_ZBX)" },
      { id: "p1_7", text: "cargo build --release -p sui-node --bin zebvix-node" },
      { id: "p1_8", text: "Binary ready: target/release/zebvix-node (114MB)" },
      { id: "p1_9", text: "/usr/local/bin/zebvix-node mein copy kiya" },
    ],
  },
  {
    id: "P2", title: "EVM Address Format",
    color: "from-yellow-500 to-orange-500", lightColor: "text-yellow-400",
    borderColor: "border-yellow-500/40", bgColor: "bg-yellow-500/5",
    points: [
      { id: "p2_1", text: "SUI_ADDRESS_LENGTH: 32 → 20 bytes (base_types.rs line 788)" },
      { id: "p2_2", text: "SuiPublicKey derivation: last 20 bytes of hash (line 922)" },
      { id: "p2_3", text: "PublicKey derivation: last 20 bytes of hash (line 932)" },
      { id: "p2_4", text: "MultiSigPublicKey derivation: last 20 bytes (line 954)" },
      { id: "p2_5", text: "ObjectID→SuiAddress: last 20 bytes fix (line 875)" },
      { id: "p2_6", text: "AccountAddress→SuiAddress: last 20 bytes fix (line 881)" },
      { id: "p2_7", text: "SuiAddress→AccountAddress: pad 20→32 bytes fix (line 1811)" },
      { id: "p2_8", text: "sui_sdk_types_conversions.rs fix (line 218)" },
      { id: "p2_9", text: "Rebuild successful — 0 compile errors" },
    ],
  },
  {
    id: "P3", title: "Tokenomics Constants",
    color: "from-blue-500 to-cyan-500", lightColor: "text-blue-400",
    borderColor: "border-blue-500/40", bgColor: "bg-blue-500/5",
    points: [
      { id: "p3_1", text: "MAX_TOTAL_SUPPLY_ZBX = 150,000,000 add kiya" },
      { id: "p3_2", text: "GENESIS_SUPPLY_ZBX = 2,000,000 add kiya" },
      { id: "p3_3", text: "FIRST_HALVING_ZBX = 50,000,000 add kiya" },
      { id: "p3_4", text: "SECOND_HALVING_ZBX = 100,000,000 add kiya" },
      { id: "p3_5", text: "INITIAL_BLOCK_REWARD_MIST = 0.1 ZBX add kiya" },
      { id: "p3_6", text: "GAS_NODE_BPS = 2200 (22% → node runners) add kiya" },
      { id: "p3_7", text: "GAS_VALIDATOR_BPS = 3000 (30% → validators) add kiya" },
      { id: "p3_71", text: "GAS_DELEGATOR_BPS = 2000 (20% → delegators) add kiya" },
      { id: "p3_8", text: "GAS_TREASURY_BPS = 1800 (18%) + GAS_BURN_BPS = 1000 (10%) add kiya" },
      { id: "p3_9", text: "get_halving_multiplier() function add kiya" },
    ],
  },
  {
    id: "P4", title: "CLI Build & Keypairs",
    color: "from-purple-500 to-violet-600", lightColor: "text-purple-400",
    borderColor: "border-purple-500/40", bgColor: "bg-purple-500/5",
    points: [
      { id: "p4_1", text: "cargo build --release -p sui --bin sui" },
      { id: "p4_2", text: "zebvix-cli ban gaya (sui binary copy + rename)" },
      { id: "p4_3", text: "Directories ready: ~/zebvix-data/{genesis,logs,db,consensus_db}" },
      { id: "p4_4", text: "Validator keypairs generate kiye (4 keys)" },
      { id: "p4_5", text: "validator.yaml fill kiya (keys + ports)" },
      { id: "p4_6", text: "genesis.yaml banaya (chain_id, supply, block time)" },
      { id: "p4_7", text: "genesis.blob generate kiya" },
      { id: "p4_8", text: "genesis.blob verify kiya" },
    ],
  },
  {
    id: "P5", title: "Node Launch",
    color: "from-primary to-cyan-500", lightColor: "text-primary",
    borderColor: "border-primary/40", bgColor: "bg-primary/5",
    points: [
      { id: "p5_1", text: "systemd service file banaya (zebvix-node.service)" },
      { id: "p5_2", text: "systemctl enable --now zebvix-node" },
      { id: "p5_3", text: "Node start hua — koi crash nahi" },
      { id: "p5_4", text: "RPC respond kar raha hai (curl localhost:9000)" },
      { id: "p5_5", text: "Chain ID verify: zebvix-mainnet-1" },
      { id: "p5_6", text: "Epoch 0 chal raha hai" },
      { id: "p5_7", text: "Logs clean hain — koi error nahi" },
      { id: "p5_8", text: "Firewall ports open: 8080, 9000, 9184" },
    ],
  },
  {
    id: "P6", title: "Move Contracts Deploy",
    color: "from-pink-500 to-rose-500", lightColor: "text-pink-400",
    borderColor: "border-pink-500/40", bgColor: "bg-pink-500/5",
    points: [
      { id: "p6_0", text: "zebvix-cli client new-env --alias zebvix (node se connect karo)" },
      { id: "p6_1", text: "Test wallet address liya — faucet se ZBX gas mila" },
      { id: "p6_2", text: "zbx_token.move deploy kiya (150M cap, 2M genesis, MintAuthority)" },
      { id: "p6_3", text: "pay_id.move deploy kiya (PayIdRegistry shared obj, rahul@zbx format)" },
      { id: "p6_4", text: "staking_pool.move deploy kiya (41 slots, 120%/80% APR, NodeWallet)" },
      { id: "p6_5", text: "master_pool.move deploy kiya (AMM base, anti-rug locked)" },
      { id: "p6_6", text: "sub_pool.move deploy kiya (permissionless pairs, x*y=k)" },
      { id: "p6_7", text: "founder_admin.move deploy kiya (FounderAdminCap → MultiSig wallet transfer)" },
      { id: "p6_8", text: "Saare 6 Package IDs note kiye aur config mein save kiye" },
      { id: "p6_9", text: "Basic txn test kiya — ZBX transfer + Pay ID register + stake test" },
    ],
  },
  {
    id: "P7", title: "Ecosystem Launch",
    color: "from-amber-500 to-yellow-500", lightColor: "text-amber-400",
    borderColor: "border-amber-500/40", bgColor: "bg-amber-500/5",
    points: [
      { id: "p7_1", text: "GitHub: ZebvixTech/zebvix-node repo banaya" },
      { id: "p7_2", text: "GitHub: sui-explorer fork → ZBX Explorer" },
      { id: "p7_3", text: "GitHub: sui.js fork → zebvix.js SDK" },
      { id: "p7_4", text: "Block Explorer deploy kiya (domain pe)" },
      { id: "p7_5", text: "ZBX Wallet Chrome Extension banaya" },
      { id: "p7_6", text: "Testnet Faucet deploy kiya" },
      { id: "p7_7", text: "zebvix.network domain setup kiya" },
      { id: "p7_8", text: "Documentation publish kiya (docs.zebvix.network)" },
    ],
  },
  {
    id: "B1", title: "🦀 B.1 — Custom Rust Chain: Validator Registry",
    color: "from-emerald-500 to-green-600", lightColor: "text-emerald-400",
    borderColor: "border-emerald-500/40", bgColor: "bg-emerald-500/5",
    points: [
      { id: "b1_1", text: "PIVOT: Sui-fork chhoda → clean Rust L1 (zebvix-chain/) banaya — full control" },
      { id: "b1_2", text: "Phase A: 2-node libp2p P2P sync verified on VPS (gossip + heartbeat + block sync)" },
      { id: "b1_3", text: "ValidatorRegistry: RocksDB-backed on-chain set — power, pubkey, address fields" },
      { id: "b1_4", text: "CLI: validator-add / validator-remove / validator-list (admin-gated)" },
      { id: "b1_5", text: "RPC methods: zbx_validatorList + zbx_validatorInfo" },
      { id: "b1_6", text: "Founder hardcoded admin: 0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc" },
    ],
  },
  {
    id: "B2", title: "🗳️ B.2 — Vote Messages (BFT prep)",
    color: "from-teal-500 to-cyan-600", lightColor: "text-teal-400",
    borderColor: "border-teal-500/40", bgColor: "bg-teal-500/5",
    points: [
      { id: "b2_1", text: "Vote struct: Ed25519-signed { height, round, block_hash, voter_pubkey } + domain tag" },
      { id: "b2_2", text: "VotePool: per-(height,round) tracking with double-sign detection (slashing-ready)" },
      { id: "b2_3", text: "Gossipsub topic: zebvix/7878/votes/v1 (separate from blocks/heartbeat)" },
      { id: "b2_4", text: "RPC: zbx_voteStats — live vote count + voting power" },
      { id: "b2_5", text: "✅ VPS verified: 2/2 quorum on EVERY block — both nodes vote independently" },
    ],
  },
  {
    id: "B31", title: "⚙️ B.3.1 — On-chain Validator Updates",
    color: "from-cyan-500 to-blue-600", lightColor: "text-cyan-400",
    borderColor: "border-cyan-500/40", bgColor: "bg-cyan-500/5",
    points: [
      { id: "b31_1", text: "TxKind enum: Transfer / ValidatorAdd / ValidatorRemove (typed tx body)" },
      { id: "b31_2", text: "apply_tx dispatch: governance txs admin-gated; last-validator removal blocked" },
      { id: "b31_3", text: "CLI validator-add/remove ab RPC ke through tx submit karta hai (no direct DB write)" },
      { id: "b31_4", text: "submit_tx_strict helper: real RPC error detection — no fake-success" },
      { id: "b31_5", text: "Bug fixes: default fee 0.001→0.002 ZBX, systemd unit cleanup, keyfile pubkey derivation" },
      { id: "b31_6", text: "🎉 VPS PROOF: tx 0xdf109d69... → DONO nodes ne 'validator-add applied' log kiya independently" },
      { id: "b31_7", text: "Founder nonce 0→1 — registry block-apply ke through replicate hota hai (no manual mirror)" },
    ],
  },
  {
    id: "B315", title: "🔧 B.3.1.5 — Genesis Fix + RPC validator-list ✅ VERIFIED",
    color: "from-fuchsia-500 to-pink-600", lightColor: "text-fuchsia-400",
    borderColor: "border-fuchsia-500/40", bgColor: "bg-fuchsia-500/5",
    points: [
      { id: "b315_1", text: "FOUNDER_PUBKEY_HEX constant in tokenomics.rs (0xaa9f6c1f...d097)" },
      { id: "b315_2", text: "cmd_init ab DETERMINISTIC genesis seed karta hai — sab nodes pe same {founder} validator at genesis" },
      { id: "b315_3", text: "Old bug fixed: pehle har node apni local validator key ko genesis mein daal deti thi (divergence) — VPS pe diagnose hua: Node-1 height 239, Node-2 height 2212, alag chains" },
      { id: "b315_4", text: "validator-list CLI ab default mein RPC (zbx_listValidators) call karta hai — koi DB lock clash nahi" },
      { id: "b315_5", text: "--offline flag rakha hai diagnostic ke liye (jab node band ho)" },
      { id: "b315_6", text: "VPS re-init DONE: dono nodes ab same chain pe, true 2/2 quorum (prevote + precommit) verified live" },
    ],
  },
  {
    id: "B321", title: "⚙️ B.3.2.1 — Round-Robin Proposer ✅ VERIFIED",
    color: "from-indigo-500 to-blue-600", lightColor: "text-indigo-400",
    borderColor: "border-indigo-500/40", bgColor: "bg-indigo-500/5",
    points: [
      { id: "b321_1", text: "who_proposes(height, validators) → Address: deterministic election by sorted-address index" },
      { id: "b321_2", text: "Producer::run() ab har tick par re-reads validator set (live registry updates)" },
      { id: "b321_3", text: "Elected != me → skip (chain stalls if elected validator down — correct BFT, fix in B.3.2.2)" },
      { id: "b321_4", text: "Backward compat: --follower flag still hard-overrides (pure observer mode)" },
      { id: "b321_5", text: "Unit tests: 2-validator alternation, 3-validator round-robin, empty registry" },
      { id: "b321_6", text: "VPS LIVE PROOF: Node-1 produced #123,125,127,129,131,133 (ODD), Node-2 produced #124,126,128,130,132,134 (EVEN) — strict alternation, 5-sec interval, 2/2 validator set converged" },
    ],
  },
  {
    id: "B322", title: "⏰ B.3.2.2 — State Machine Timeouts (CODE READY)",
    color: "from-purple-500 to-fuchsia-600", lightColor: "text-purple-400",
    borderColor: "border-purple-500/40", bgColor: "bg-purple-500/5",
    points: [
      { id: "b322_1", text: "who_proposes(height, round, validators) → round bumping for liveness recovery" },
      { id: "b322_2", text: "PROPOSE_TIMEOUT_SECS = 8s — agar elected proposer block na de paaye, round +1, naya proposer try kare" },
      { id: "b322_3", text: "TICK_INTERVAL_MS = 500ms — fine-grained state machine, no busy wait" },
      { id: "b322_4", text: "Round 0 BLOCK_TIME_SECS=5s pacing honour karta hai; recovery rounds (≥1) immediate propose" },
      { id: "b322_5", text: "Local state per node: (current_height, current_round, round_started_at, produced_at)" },
      { id: "b322_6", text: "Tip-advance auto-resets round=0 (peer ne block deliver kar diya)" },
      { id: "b322_7", text: "Unit tests: round 1 ALWAYS flips proposer for 2-validator set; (h+r)%n math verified" },
      { id: "b322_8", text: "VPS test: kill Node-1 → 8s baad chain Node-2 takeover, ⏰ propose timeout log dikhe" },
    ],
  },
  {
    id: "B323", title: "🔮 B.3.2.3 — 2/3+ Commit Gate (NEXT)",
    color: "from-rose-500 to-pink-600", lightColor: "text-rose-400",
    borderColor: "border-rose-500/40", bgColor: "bg-rose-500/5",
    points: [
      { id: "b323_1", text: "Block apply gate: reject block at H if not 2/3+ precommits from prev height H-1" },
      { id: "b323_2", text: "Chain HALT under quorum loss (correct BFT — not a bug, a feature)" },
      { id: "b323_3", text: "B.3.2.4: LastCommit field in BlockHeader (signed precommits chain-wide proof)" },
    ],
  },
];

export default function PhaseTracker() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [openPhases, setOpenPhases] = useState<Record<string, boolean>>(
    Object.fromEntries(PHASES.map(p => [p.id, true]))
  );
  const [activeTab, setActiveTab] = useState<"tasks" | "changes">("tasks");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setChecked(JSON.parse(saved));
  }, []);

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const togglePhase = (id: string) => {
    setOpenPhases(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const phaseProgress = (phase: typeof PHASES[0]) => {
    const done = phase.points.filter(p => checked[p.id]).length;
    return { done, total: phase.points.length, pct: Math.round((done / phase.points.length) * 100) };
  };

  const totalDone = PHASES.flatMap(p => p.points).filter(p => checked[p.id]).length;
  const totalPoints = PHASES.flatMap(p => p.points).length;
  const totalPct = Math.round((totalDone / totalPoints) * 100);
  const isPhaseComplete = (phase: typeof PHASES[0]) => phase.points.every(p => checked[p.id]);

  const resetAll = () => {
    setChecked({});
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Phase Tracker</h1>
          <p className="text-muted-foreground">Zebvix chain launch ka poora progress — phase by phase tick karo</p>
        </div>
        <button onClick={resetAll} className="text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded border border-border hover:border-destructive/50">
          Reset All
        </button>
      </div>

      {/* Overall progress */}
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm text-muted-foreground">Overall Progress</div>
            <div className="text-3xl font-bold text-foreground mt-0.5">{totalPct}%</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">{totalDone}</div>
            <div className="text-xs text-muted-foreground">of {totalPoints} tasks</div>
          </div>
        </div>
        <Progress value={totalPct} className="h-3" />
        {totalPct === 100 && (
          <div className="flex items-center gap-2 mt-3 text-yellow-400 text-sm font-semibold">
            <Trophy className="h-4 w-4" /> Zebvix Chain fully launched! 🎉
          </div>
        )}
      </div>

      {/* Phase grid summary */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {PHASES.map((phase) => {
          const { pct } = phaseProgress(phase);
          const complete = isPhaseComplete(phase);
          return (
            <button key={phase.id}
              onClick={() => {
                setActiveTab("tasks");
                setTimeout(() => {
                  document.getElementById(`phase-${phase.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  setOpenPhases(prev => ({ ...prev, [phase.id]: true }));
                }, 50);
              }}
              className={`rounded-lg p-2 text-center border transition-all hover:scale-105 ${complete ? "border-green-500/50 bg-green-500/10" : "border-border bg-muted/20"}`}
            >
              <div className={`text-xs font-bold ${complete ? "text-green-400" : phase.lightColor}`}>{phase.id}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{pct}%</div>
            </button>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/20 p-1 rounded-lg border border-border w-fit">
        <button
          onClick={() => setActiveTab("tasks")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "tasks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          ✅ Tasks
        </button>
        <button
          onClick={() => setActiveTab("changes")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "changes" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          📝 Changes Log
        </button>
      </div>

      {/* TASKS TAB */}
      {activeTab === "tasks" && (
        <div className="space-y-3">
          {PHASES.map((phase) => {
            const { done, total, pct } = phaseProgress(phase);
            const complete = isPhaseComplete(phase);
            const isOpen = openPhases[phase.id];

            return (
              <div key={phase.id} id={`phase-${phase.id}`}
                className={`rounded-xl border overflow-hidden transition-all ${complete ? "border-green-500/40 bg-green-500/5" : `${phase.borderColor} ${phase.bgColor}`}`}
              >
                <button onClick={() => togglePhase(phase.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-white/5 transition-colors"
                >
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${phase.color} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
                    {complete ? "✓" : phase.id.replace("P", "")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{phase.title}</span>
                      {complete && <span className="text-xs text-green-400 font-semibold">Complete!</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <Progress value={pct} className="h-1.5 flex-1" />
                      <span className="text-xs text-muted-foreground shrink-0">{done}/{total}</span>
                    </div>
                  </div>
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>

                {isOpen && (
                  <div className="px-5 pb-4 space-y-1.5">
                    {phase.points.map((point, i) => (
                      <button key={point.id} onClick={() => toggle(point.id)}
                        className="w-full flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-white/5 transition-colors text-left group"
                      >
                        <div className="mt-0.5 shrink-0">
                          {checked[point.id]
                            ? <CheckCircle2 className={`h-5 w-5 ${complete ? "text-green-400" : phase.lightColor}`} />
                            : <Circle className="h-5 w-5 text-muted-foreground group-hover:text-foreground/60 transition-colors" />
                          }
                        </div>
                        <span className={`text-sm leading-relaxed ${checked[point.id] ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          <span className="text-muted-foreground text-xs font-mono mr-2">{i + 1}.</span>
                          {point.text}
                        </span>
                      </button>
                    ))}
                    {complete && (
                      <div className="mt-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold flex items-center gap-2">
                        <Trophy className="h-4 w-4" /> Phase {phase.id} complete! 🎉
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CHANGES LOG TAB */}
      {activeTab === "changes" && (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground mb-4">
            Sui source code mein kya-kya change kiya — exact file references ke saath
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-center">
              <div className="text-xl font-bold text-green-400">
                {CHANGES_LOG.flatMap(c => c.entries).filter(e => e.type === "add").length}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">New additions</div>
            </div>
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-center">
              <div className="text-xl font-bold text-yellow-400">
                {CHANGES_LOG.flatMap(c => c.entries).filter(e => e.type === "change").length}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Modified</div>
            </div>
          </div>

          {/* Timeline */}
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
            <div className="space-y-6">
              {CHANGES_LOG.map((log, i) => (
                <div key={i} className="relative pl-10">
                  {/* Dot */}
                  <div className={`absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2 border-background ${log.dot}`} />

                  <div className="rounded-xl border border-border bg-muted/5 overflow-hidden">
                    {/* Log header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                      <GitCommit className={`h-4 w-4 ${log.color} shrink-0`} />
                      <span className={`font-bold text-sm ${log.color}`}>{log.phase}</span>
                      <span className="text-sm font-medium text-foreground">
                        {PHASES.find(p => p.id === log.phase)?.title}
                      </span>
                      {(log as any).label && (() => {
                        const c = log.color; // e.g. "text-orange-400", "text-red-400"
                        const col = c.includes("orange") ? "bg-orange-500/15 text-orange-400 border-orange-500/20"
                                  : c.includes("red")    ? "bg-red-500/15 text-red-400 border-red-500/20"
                                  : c.includes("violet") ? "bg-violet-500/15 text-violet-400 border-violet-500/20"
                                  : c.includes("cyan")   ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/20"
                                  : c.includes("blue")   ? "bg-blue-500/15 text-blue-400 border-blue-500/20"
                                  : c.includes("green")  ? "bg-green-500/15 text-green-400 border-green-500/20"
                                  : c.includes("yellow") ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
                                  : "bg-muted/15 text-muted-foreground border-border";
                        return (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${col}`}>
                            {(log as any).label}
                          </span>
                        );
                      })()}
                      <span className="text-xs text-muted-foreground ml-auto">{log.date}</span>
                    </div>

                    {/* Entries */}
                    <div className="px-4 py-3 space-y-2">
                      {log.entries.map((entry, j) => (
                        <div key={j} className="flex items-start gap-2.5 text-sm">
                          {entry.type === "add"
                            ? <Plus className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
                            : entry.type === "fix"
                              ? <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                              : <Edit2 className="h-3.5 w-3.5 text-yellow-400 shrink-0 mt-0.5" />
                          }
                          <span className={entry.type === "add" ? "text-foreground" : "text-foreground/80"}>
                            <span className={`text-xs font-mono px-1.5 py-0.5 rounded mr-2 ${entry.type === "add" ? "bg-green-500/10 text-green-400" : entry.type === "fix" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                              {entry.type === "add" ? "+add" : entry.type === "fix" ? "!fix" : "~mod"}
                            </span>
                            {entry.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              {/* Future phases placeholder */}
              <div className="relative pl-10 opacity-40">
                <div className="absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2 border-border bg-muted" />
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  P4 – P7 changes yahaan aayenge jab complete honge...
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
