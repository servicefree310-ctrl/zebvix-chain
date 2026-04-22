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
        name: "20-byte EVM-style addresses",
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
        desc: "If an auto-swap fails (e.g. dust amount below 0.01 zUSD minimum, pool not initialized, output overflow), the sender's principal amount is REFUNDED — only the gas fee is kept. EVM-style 'revert with gas spent' UX. Pool reserves are never touched on failure (atomic via match-on-Result in apply_tx).",
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
        desc: "EVM standard — wei = 1e-18 ZBX",
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
        name: "Dynamic gas pricing (USD-pegged, on-chain oracle)",
        desc: "Gas price auto-adjusts based on pool ZBX/USD spot price. Target $0.001/transfer. Floor 1 gwei (spam protection), cap 10,000 gwei (crash safety). Phase 1: read-only; Phase 3 will enforce in mempool.",
        status: "wip",
        version: "v0.1.2",
        files: ["src/pool.rs", "src/tokenomics.rs", "src/rpc.rs"],
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
    group: "Smart Contracts",
    icon: "📜",
    features: [
      {
        name: "EVM via revm",
        desc: "Solidity contract execution — full EVM compatibility",
        status: "planned",
        version: "v0.2",
      },
      {
        name: "Precompiles (ecrecover, sha256, etc)",
        desc: "Standard Ethereum precompiles",
        status: "planned",
        version: "v0.2",
      },
    ],
  },
  {
    group: "Decentralization",
    icon: "🌐",
    features: [
      {
        name: "P2P networking (libp2p)",
        desc: "Multi-node gossip + block propagation",
        status: "planned",
        version: "v0.2",
      },
      {
        name: "Multi-validator BFT consensus",
        desc: "Tendermint/HotStuff-style BFT for >1 validator",
        status: "planned",
        version: "v0.2",
      },
      {
        name: "Validator staking + slashing",
        desc: "PoS economic security",
        status: "planned",
        version: "v0.3",
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
