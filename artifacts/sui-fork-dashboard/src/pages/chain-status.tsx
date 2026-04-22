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
        name: "10M founder pre-mine",
        desc: "Genesis allocation to founder address",
        status: "done",
        version: "v0.1",
        files: ["src/main.rs"],
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
