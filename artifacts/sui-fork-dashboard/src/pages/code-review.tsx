import { useState } from "react";
import {
  FileCode, FileText, Package, GitBranch, Plus, Edit3,
  ChevronDown, ChevronRight, CheckCircle, AlertCircle,
  Layers, Cpu, Coins, Users, Zap, Shield, ArrowUpDown, Activity
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ── Types ──────────────────────────────────────────────────────────────────

type ChangeKind = "modified" | "added" | "renamed";

interface ChangeItem {
  file: string;
  kind: ChangeKind;
  lines: string;
  icon: React.ElementType;
  color: string;
  summary: string;
  details: string[];
}

// ── Data ───────────────────────────────────────────────────────────────────

const RUST_CHANGES: ChangeItem[] = [
  {
    file: "crates/sui-types/src/gas_coin.rs",
    kind: "modified",
    lines: "161 → 234 (+73)",
    icon: Coins,
    color: "text-amber-400",
    summary: "ZBX Tokenomics constants — complete rewrite of supply & economics",
    details: [
      "MIST_PER_SUI → MIST_PER_ZBX = 1_000_000_000 (kept alias for compat)",
      "TOTAL_SUPPLY_SUI → TOTAL_SUPPLY_ZBX = 150_000_000 (was 10 billion)",
      "TOTAL_SUPPLY_MIST = TOTAL_SUPPLY_ZBX × MIST_PER_ZBX",
      "GENESIS_SUPPLY_ZBX = 2_000_000 (2M ZBX at genesis → founder)",
      "GENESIS_SUPPLY_MIST = 2_000_000_000_000_000",
      "FIRST_HALVING_ZBX = 50_000_000  (50M minted → halving starts)",
      "SECOND_HALVING_ZBX = 100_000_000 (100M minted → 2nd halving)",
      "INITIAL_BLOCK_REWARD_MIST = 100_000_000 (0.1 ZBX per block)",
      "GAS_VALIDATOR_BPS = 7200 (72% gas → validators)",
      "GAS_TREASURY_BPS = 1800  (18% gas → founder treasury)",
      "GAS_BURN_BPS = 1000        (10% gas → burn, until cap)",
      "MAX_BURN_SUPPLY_ZBX = 75_000_000 (50% of max = burn cap)",
      "MAX_BURN_SUPPLY_MIST = 75_000_000_000_000_000",
      "MAX_VALIDATORS = 41 (only 41 slots allowed)",
      "MIN_VALIDATOR_STAKE_ZBX = 10_000 (10K ZBX min stake)",
      "MIN_VALIDATOR_STAKE_MIST = 10_000_000_000_000",
      "MAX_VALIDATOR_STAKE_ZBX = 250_000 (250K max — validator's OWN stake only)",
      "GLOBAL_STAKE_CAP_MIST = 5_000_000_000_000_000 (5M ZBX: ALL validators + ALL delegators combined)",
      "VALIDATOR_STAKING_APR = 120 (% APR on self-stake)",
      "DELEGATOR_APR = 80            (% APR for delegators)",
      "VALIDATOR_DELEGATION_BONUS = 40 (% bonus APR on delegated amt)",
      "NODE_DAILY_REWARD_MIST = 5 × MIST_PER_ZBX (5 ZBX/day)",
      "CHAIN_ID = \"zebvix-mainnet-1\"",
      "TOKEN_SYMBOL = \"ZBX\"",
      "TOKEN_DECIMALS = 9",
      "fn halving_divisor() → 1/2/4 based on minted supply",
      "fn current_block_reward_mist() → reward after halving",
      "fn split_gas_fee() → (validator, treasury, burn) tuple",
      "fn is_validator_cap_reached() → bool (41 slot check)",
    ],
  },
  {
    file: "crates/sui-types/src/base_types.rs",
    kind: "modified",
    lines: "1944 → 1948 (+4 net, 8 lines changed)",
    icon: Cpu,
    color: "text-cyan-400",
    summary: "20-byte EVM-compatible address format (last 20 of Blake2b256)",
    details: [
      "SUI_ADDRESS_LENGTH: usize = ObjectID::LENGTH  →  = 20  (was 32)",
      "impl From<&T: SuiPublicKey> for SuiAddress → hash[12..32] last 20 bytes",
      "impl From<&PublicKey> for SuiAddress → hash[12..32] last 20 bytes",
      "impl From<&MultiSigPublicKey> for SuiAddress → hash[12..32] last 20 bytes",
      "try_from_unpadded (ZkLogin) → hash[12..32] last 20 bytes",
      "impl From<ObjectID> for SuiAddress → bytes[12..] last 20 of 32",
      "impl From<AccountAddress> for SuiAddress → bytes[12..] last 20 of 32",
      "NEW: impl From<SuiAddress> for AccountAddress → pad 20 → 32 with leading 0x00×12",
      "Address display: 0x + 40 hex chars (EVM style)",
    ],
  },
  {
    file: "crates/sui-node/Cargo.toml",
    kind: "modified",
    lines: "73 → 77 (+4)",
    icon: Package,
    color: "text-violet-400",
    summary: "Node binary renamed sui-node → zebvix-node",
    details: [
      "package.name = \"sui-node\" → \"zebvix-node\"",
      "authors = Zebvix Technologies Pvt Ltd <build@zebvix.io>",
      "description = Zebvix blockchain node — ZBX (zebvix-mainnet-1)",
      "Added [[bin]] section: name = \"zebvix-node\", path = \"src/main.rs\"",
    ],
  },
];

const MOVE_MODULES: ChangeItem[] = [
  {
    file: "crates/sui-framework/packages/zebvix/sources/zbx_token.move",
    kind: "added",
    lines: "91 lines",
    icon: Coins,
    color: "text-amber-400",
    summary: "ZBX native token module — mint, genesis, halving",
    details: [
      "struct ZBX has drop {} — one-time witness (OTW)",
      "DECIMALS = 9, SYMBOL = ZBX, NAME = Zebvix",
      "MAX_SUPPLY_MIST = 150M × 1e9",
      "GENESIS_SUPPLY_MIST = 2M × 1e9 → minted to founder on init",
      "struct MintAuthority — tracks total_minted_mist (shared)",
      "fn mint_block_reward() — called by staking pool, checks cap",
      "fn total_minted(), total_minted_zbx(), remaining_mintable()",
      "metadata frozen at genesis (immutable description/icon)",
    ],
  },
  {
    file: "crates/sui-framework/packages/zebvix/sources/pay_id.move",
    kind: "added",
    lines: "147 lines",
    icon: Activity,
    color: "text-green-400",
    summary: "UPI-style Pay ID system — rahul@zbx format",
    details: [
      "struct PayIdRegistry (shared) — bidirectional maps",
      "  name_to_addr: Table<String, address> — pay_id → owner",
      "  addr_to_name: Table<address, String> — owner → pay_id",
      "struct PayId has key (NOT store — cannot transfer/delete)",
      "  pay_id: String  — e.g. \"rahul\"       (GLOBALLY UNIQUE)",
      "  full_id: String — e.g. \"rahul@zbx\"   (auto-appended)",
      "  display_name: String — e.g. \"Rahul Kumar\" (NOT unique)",
      "  owner: address, created_epoch: u64",
      "E_DISPLAY_NAME_EMPTY = 6 — display_name cannot be empty",
      "E_NAME_TAKEN = 2 — pay_id already registered globally",
      "E_ALREADY_REGISTERED = 3 — one Pay ID per address",
      "fn register_pay_id() — validates + creates PayId object",
      "fn transfer_to_pay_id<T>() — send any coin to a handle",
      "fn resolve_pay_id() → address lookup",
      "fn is_name_available() → bool check",
      "fn total_registered() — registry stats",
    ],
  },
  {
    file: "crates/sui-framework/packages/zebvix/sources/staking_pool.move",
    kind: "added",
    lines: "282 lines",
    icon: Users,
    color: "text-blue-400",
    summary: "Validator staking + delegator system (120%/80%/40% APR) — global 5M cap",
    details: [
      "MAX_VALIDATORS = 41 (slots), MIN_VALIDATOR_STAKE = 10,000 ZBX",
      "MAX_VALIDATOR_STAKE = 250,000 ZBX (validator's OWN stake max — per slot)",
      "GLOBAL_STAKE_CAP = 5,000,000 ZBX total (ALL validators + ALL delegators combined)",
      "  → 41 slots × 10K min = 410,000 ZBX reserved; 1 validator joins → 400,000 left",
      "VALIDATOR_STAKING_APR_BPS = 12,000 (120%)",
      "DELEGATOR_APR_BPS = 8,000 (80%)",
      "VALIDATOR_DELEGATION_BONUS_BPS = 4,000 (40% bonus on delegated amount)",
      "NODE_DAILY_REWARD_MIST = 5 ZBX/day (node runners only)",
      "EPOCH REWARD SPLIT via distribute_epoch_reward():",
      "  • 0 validators → 100% → founder treasury (pre-launch)",
      "  • N validators (N < 41) → (N/41) × reward → reward_balance (validators claim)",
      "  •                       → ((41-N)/41) × reward → founder treasury (empty-slot subsidy)",
      "  • All 41 filled → 100% → reward_balance (validators/delegators claim)",
      "struct ValidatorStake — has key,store; tracks self-stake",
      "struct DelegatorStake — has key,store; tracks delegation",
      "struct StakingPool (shared) — slot_stakes + slot_delegated Tables",
      "struct NodeWallet — per-node identity + wallet registration",
      "fn stake() — become validator (41 cap, 10K–250K own stake, global 5M cap)",
      "fn unstake() — returns staked ZBX (1 epoch lock)",
      "fn claim_rewards() — self-stake APR + delegation bonus",
      "fn claim_node_reward() — 5 ZBX/day for node runners",
      "fn delegate() — delegate to validator (global 5M cap enforced, no per-slot limit)",
      "fn undelegate() — reclaim delegated ZBX",
      "fn claim_delegation_rewards() — 80% APR on delegated amt",
      "fn distribute_epoch_reward() — new: splits reward between active validators + founder",
      "fn fund_rewards() — direct top-up from genesis treasury",
      "fn global_cap_remaining() — view: how much ZBX still fits in 5M pool",
      "fn is_global_cap_reached() — bool check",
    ],
  },
  {
    file: "crates/sui-framework/packages/zebvix/sources/master_pool.move",
    kind: "added",
    lines: "117 lines",
    icon: ArrowUpDown,
    color: "text-orange-400",
    summary: "Decentralized AMM base pool — no admin, anti-rug locked",
    details: [
      "struct MasterPool has key (shared, NO admin field)",
      "  zbx_reserve: Balance<ZBX>",
      "  fee_bps = 30 (0.3%), total_volume, total_fees",
      "add_liquidity() → PERMANENTLY aborts E_ADD_LIQ_DISABLED (100)",
      "remove_liquidity() → PERMANENTLY aborts E_REMOVE_LIQ_DISABLED (101)",
      "fn seed_pool() — one-time initial seeding only",
      "fn get_zbx_out() — constant product: x*y=k quote",
      "fn get_token_out() — reverse quote",
      "pub(package) fn deposit_zbx() — called by sub_pool buys",
      "pub(package) fn withdraw_zbx() — called by sub_pool sells",
      "Result: NO ONE can rug-pull the ZBX reserve, ever",
    ],
  },
  {
    file: "crates/sui-framework/packages/zebvix/sources/sub_pool.move",
    kind: "added",
    lines: "228 lines",
    icon: Zap,
    color: "text-pink-400",
    summary: "Permissionless token-pair pools — x*y=k, anti-rug",
    details: [
      "struct SubPool<phantom T> has key (shared)",
      "  token_reserve: Balance<T>",
      "  creator_fee_addr: address (NO owner field — only fee recipient)",
      "  fee_bps: u64 (1–1000, i.e. 0.01%–10%)",
      "  total_volume_zbx, total_fees_zbx",
      "add_liquidity<T>() → PERMANENTLY aborts (anti-rug)",
      "remove_liquidity<T>() → PERMANENTLY aborts (anti-rug)",
      "fn create<T>() — anyone can create a pair (permissionless)",
      "fn buy<T>() — ZBX in → token out (slippage protection: min_out)",
      "fn sell<T>() — token in → ZBX out (slippage protection: min_zbx)",
      "fn swap_a_to_b<A,B>() — A→ZBX→B cross-pair routing",
      "fn claim_creator_fees<T>() — creator claims earned fees",
      "fn quote_buy(), quote_sell() — read-only price quotes",
    ],
  },
  {
    file: "crates/sui-framework/packages/zebvix/sources/founder_admin.move",
    kind: "added",
    lines: "136 lines",
    icon: Shield,
    color: "text-red-400",
    summary: "MultiSig 4/6 Founder AdminCap — new features only",
    details: [
      "struct FounderAdminCap has key,store — held by 4/6 MultiSig wallet",
      "  admin_addr: address, features_added: u64",
      "struct FeatureRecord has key — on-chain log of each added feature",
      "struct FeatureAdded has copy,drop — event emitted per feature",
      "IMMUTABLE CORE (cannot change via AdminCap):",
      "  MAX_TOTAL_SUPPLY_ZBX = 150M  ← immutable",
      "  MAX_BURN_SUPPLY_ZBX = 75M    ← immutable",
      "  MAX_VALIDATORS = 41           ← immutable",
      "  SUI_ADDRESS_LENGTH = 20       ← immutable",
      "  GAS split 72/18/10            ← immutable",
      "  Manual liquidity = DISABLED   ← immutable",
      "fn transfer_to_multisig() — hand off cap to MultiSig once",
      "fn add_feature() — creates FeatureRecord + emits event",
      "fn update_admin() — key rotation (requires current admin sig)",
    ],
  },
];

const CONFIG_FILES: ChangeItem[] = [
  {
    file: "crates/sui-framework/packages/zebvix/Move.toml",
    kind: "added",
    lines: "14 lines",
    icon: FileText,
    color: "text-teal-400",
    summary: "Move package manifest for Zebvix modules",
    details: [
      "name = zebvix, version = 1.0.0, edition = 2024",
      "addresses: zebvix = 0x0, sui = 0x2, std = 0x1",
      "dependency: Sui = { local = ../sui-framework }",
    ],
  },
  {
    file: "zebvix-scripts/apply_patches.sh",
    kind: "added",
    lines: "72 lines",
    icon: FileCode,
    color: "text-lime-400",
    summary: "Master patch script — apply everything to Sui clone in 1 command",
    details: [
      "bash apply_patches.sh ~/zebvix-node",
      "Step 1: copies gas_coin.rs, base_types.rs, Cargo.toml",
      "Step 2: copies 6 Move modules + Move.toml",
      "Step 3: applies genesis.yaml, validator.yaml configs",
      "Step 4: renames MIST_PER_SUI → MIST_PER_ZBX in genesis-builder",
      "Color-coded output with ok / err messages",
    ],
  },
  {
    file: "zebvix-config/genesis_template.yaml",
    kind: "added",
    lines: "~40 lines",
    icon: FileText,
    color: "text-slate-400",
    summary: "Genesis configuration for zebvix-mainnet-1",
    details: [
      "chain_id: zebvix-mainnet-1",
      "initial_supply: 2000000 ZBX",
      "validator_slots: 41",
      "epoch_duration: 86400s (24h)",
    ],
  },
  {
    file: "ZEBVIX_INSTALL.md",
    kind: "added",
    lines: "~160 lines",
    icon: FileText,
    color: "text-slate-400",
    summary: "Full VPS deployment guide with all commands",
    details: [
      "VPS requirements (8GB RAM, 100GB SSD, Ubuntu 22.04)",
      "Rust install + Sui CLI install",
      "git clone mainnet-v1.69.2",
      "apply_patches.sh one-command run",
      "cargo build --release --bin zebvix-node",
      "sui move publish (deploy 6 modules)",
      "systemd service setup",
      "Full tokenomics + APR reference table",
    ],
  },
];

// ── Stats ──────────────────────────────────────────────────────────────────

const STATS = [
  { label: "Rust Files Modified", value: "3", color: "text-amber-400", sub: "gas_coin, base_types, Cargo.toml" },
  { label: "Move Modules Added", value: "6", color: "text-green-400", sub: "zbx, pay_id, staking, amm×2, admin" },
  { label: "Config / Script Files", value: "4+", color: "text-blue-400", sub: "genesis, scripts, INSTALL.md" },
  { label: "Total Lines Changed", value: "~2,400", color: "text-violet-400", sub: "across all files" },
  { label: "Supply Changed", value: "10B → 150M", color: "text-red-400", sub: "ZBX max supply" },
  { label: "Address Size", value: "32 → 20 bytes", color: "text-cyan-400", sub: "EVM-compatible" },
];

// ── Sub-components ─────────────────────────────────────────────────────────

const kindBadge = (kind: ChangeKind) => {
  if (kind === "added")    return <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">+ ADDED</Badge>;
  if (kind === "modified") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">~ MODIFIED</Badge>;
  return                          <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[10px]">↻ RENAMED</Badge>;
};

function ChangeCard({ item }: { item: ChangeItem }) {
  const [open, setOpen] = useState(false);
  const Icon = item.icon;
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card/40 hover:bg-card/60 transition-colors">
      <button
        className="w-full flex items-start gap-3 p-4 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${item.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {kindBadge(item.kind)}
            <span className="font-mono text-[11px] text-muted-foreground/70">{item.lines}</span>
          </div>
          <p className="font-mono text-xs text-primary/80 truncate">{item.file}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{item.summary}</p>
        </div>
        <div className="shrink-0 mt-1">
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Changes / Additions</p>
          <ul className="space-y-1">
            {item.details.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle className="h-3 w-3 text-primary/50 mt-0.5 shrink-0" />
                <span className="font-mono">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, color, items }: {
  title: string; icon: React.ElementType; color: string; items: ChangeItem[]
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`h-4 w-4 ${color}`} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">({items.length} files)</span>
      </div>
      <div className="space-y-2">
        {items.map(item => <ChangeCard key={item.file} item={item} />)}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CodeReview() {
  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <GitBranch className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Full Code Review</h1>
            <p className="text-xs text-muted-foreground font-mono">
              Sui mainnet-v1.69.2 → Zebvix Chain (zebvix-mainnet-1)
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-3">
          Ye saari changes hai jo Sui source code mein ki gayi hain — kya add hua, kya modify hua,
          har file mein kya exactly badla. Har item pe click karo full details dekhne ke liye.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        {STATS.map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg p-3">
            <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
            <p className="text-xs font-medium text-foreground mt-0.5">{s.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">~ MODIFIED</Badge>
          Existing file mein changes
        </span>
        <span className="flex items-center gap-1.5">
          <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">+ ADDED</Badge>
          Nai file / module
        </span>
      </div>

      {/* ─── RUST CHANGES ─── */}
      <Section
        title="Rust Files — Modified"
        icon={FileCode}
        color="text-amber-400"
        items={RUST_CHANGES}
      />

      {/* ─── MOVE MODULES ─── */}
      <Section
        title="Move Modules — New (6 modules)"
        icon={Layers}
        color="text-green-400"
        items={MOVE_MODULES}
      />

      {/* ─── CONFIG / SCRIPTS ─── */}
      <Section
        title="Config, Scripts & Docs — New"
        icon={FileText}
        color="text-blue-400"
        items={CONFIG_FILES}
      />

      {/* Summary box */}
      <div className="mt-6 p-4 rounded-lg border border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground text-sm">Kya nahi badla — Core Sui</p>
            <p>Consensus engine (Mysticeti), P2P layer (Anemo), RPC API, Storage engine, Transaction execution VM, Move bytecode interpreter — ye sab original Sui ka hai. Sirf tokenomics constants, address size, binary name, aur Move application layer add hui hai.</p>
            <p className="mt-2 text-primary/70 font-mono">
              Final archive: <strong>zebvix-full-source.tar.gz</strong> (78MB) — Sui clone + all patches applied
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
