import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Network,
  Zap,
  GitBranch,
  Sparkles,
  CheckCircle2,
  Clock,
  Circle,
  ArrowRight,
  Cpu,
  Database,
  Shield,
  Users,
  AlertTriangle,
  Target,
} from "lucide-react";

type PhaseStatus = "done" | "active" | "next" | "future";

interface SubTask {
  name: string;
  desc: string;
  effort: string;
}

interface Phase {
  id: string;
  level: number;
  name: string;
  algorithm: string;
  icon: typeof Network;
  status: PhaseStatus;
  duration: string;
  tps: string;
  finality: string;
  validators: string;
  complexity: 1 | 2 | 3 | 4 | 5;
  description: string;
  benefits: string[];
  challenges: string[];
  subtasks: SubTask[];
  files?: string[];
}

const PHASES: Phase[] = [
  {
    id: "phase-0",
    level: 1,
    name: "Phase 0 — Single Validator PoA",
    algorithm: "Proof of Authority",
    icon: Shield,
    status: "done",
    duration: "Done (v0.1)",
    tps: "~200",
    finality: "5 sec",
    validators: "1 (founder)",
    complexity: 1,
    description:
      "Current state. Founder ki keyfile se signed blocks, koi voting nahi, sirf trust. Foundation laid for everything ahead.",
    benefits: [
      "Simplest possible — works today",
      "Zero networking complexity",
      "Predictable block production",
    ],
    challenges: [
      "Single point of failure",
      "Centralized — founder can censor",
      "No Byzantine tolerance",
    ],
    subtasks: [],
    files: ["src/consensus.rs", "src/main.rs"],
  },
  {
    id: "phase-a",
    level: 2,
    name: "Phase A — P2P Networking Foundation",
    algorithm: "libp2p Gossip",
    icon: Network,
    status: "done",
    duration: "Done (Apr 22, 2026)",
    tps: "~200",
    finality: "5 sec",
    validators: "1 producer + 1 follower (VPS)",
    complexity: 2,
    description:
      "✅ SHIPPED & VERIFIED on VPS. 2-node libp2p setup running — Node-1 (founder/producer, RPC 8545) + Node-2 (follower, RPC 8546). Gossipsub for blocks/heartbeat/votes, mDNS + bootstrap peer. Both nodes stay in sync, exchange heartbeats every block.",
    benefits: [
      "Multi-node testing infra ready",
      "Block + tx propagation working",
      "RPC nodes can sync from producer",
      "Foundation for Phase B-D",
    ],
    challenges: [
      "Peer discovery (mDNS local, DHT prod)",
      "NAT traversal for public nodes",
      "Eclipse attack prevention",
    ],
    subtasks: [
      { name: "✅ libp2p crate integration", desc: "tokio + gossipsub + identify + mdns wired up", effort: "Done" },
      { name: "✅ Peer discovery", desc: "mDNS + bootstrap peer multiaddr (--peers flag)", effort: "Done" },
      { name: "✅ Gossipsub topics", desc: "zebvix/7878/{blocks,heartbeat,votes}/v1", effort: "Done" },
      { name: "✅ Block sync protocol", desc: "Follower catches up by replaying blocks from height 0", effort: "Done" },
      { name: "✅ Heartbeat protocol", desc: "Latest block hash gossiped per tick — sync detection", effort: "Done" },
      { name: "✅ VPS deployment", desc: "Node-1 systemd + Node-2 nohup, both healthy", effort: "Done" },
    ],
    files: ["src/p2p.rs", "src/main.rs", "Cargo.toml"],
  },
  {
    id: "phase-b",
    level: 3,
    name: "Phase B — Validator Set + Votes + Governance",
    algorithm: "On-Chain Registry + Ed25519 Votes + TxKind Governance",
    icon: Users,
    status: "done",
    duration: "Done (Apr 22, 2026) — staking deferred to Phase D",
    tps: "Same (~200)",
    finality: "5 sec",
    validators: "2 active (founder + Node-2)",
    complexity: 3,
    description:
      "✅ B.1 + B.2 + B.3.1 ALL SHIPPED. Three milestones merged: (1) RocksDB validator registry with admin-gated CLI/RPC, (2) Ed25519-signed vote messages with VotePool + double-sign detection + 2/2 quorum verified per block, (3) On-chain validator updates via TxKind enum — both nodes apply same governance tx independently, no manual mirroring. Staking + delegation deferred to Phase D (after Tendermint).",
    benefits: [
      "Validator set replicates via block-apply (no manual sync)",
      "Vote double-sign detection ready for slashing (Phase D)",
      "Admin-gated governance — founder pubkey hardcoded",
      "2/2 quorum proven on every block (VPS)",
    ],
    challenges: [
      "✅ Genesis divergence FIXED in B.3.1.5 (FOUNDER_PUBKEY_HEX hardcoded)",
      "✅ CLI lock issue FIXED — validator-list ab RPC call karta hai by default",
      "Stake unbonding + slashing pushed to Phase D",
    ],
    subtasks: [
      { name: "✅ B.1 — ValidatorRegistry (RocksDB)", desc: "Power, pubkey, address fields; admin-gated CLI", effort: "Done" },
      { name: "✅ B.1 — RPC: zbx_validatorList + zbx_validatorInfo", desc: "Read endpoints", effort: "Done" },
      { name: "✅ B.2 — Ed25519 Vote messages", desc: "Domain-tagged signing { height, round, block_hash, voter_pubkey }", effort: "Done" },
      { name: "✅ B.2 — VotePool + double-sign detection", desc: "Per-(height,round) tracking, slashing-ready", effort: "Done" },
      { name: "✅ B.2 — Gossipsub votes topic + zbx_voteStats RPC", desc: "Live quorum tracking", effort: "Done" },
      { name: "✅ B.3.1 — TxKind enum (Transfer/ValidatorAdd/ValidatorRemove)", desc: "Typed tx body", effort: "Done" },
      { name: "✅ B.3.1 — apply_tx dispatch + admin gating", desc: "Last-validator removal blocked", effort: "Done" },
      { name: "✅ B.3.1 — CLI submits via RPC + submit_tx_strict", desc: "No fake-success on RPC errors", effort: "Done" },
      { name: "🎯 VPS PROOF: tx 0xdf109d69... → both nodes log 'validator-add applied'", desc: "Replication verified", effort: "Done" },
    ],
    files: [
      "src/state.rs (registry + apply_tx)",
      "src/vote.rs (Vote/VotePool)",
      "src/types.rs (TxKind)",
      "src/main.rs (CLI + RPC)",
      "src/p2p.rs (votes topic)",
    ],
  },
  {
    id: "phase-c",
    level: 4,
    name: "Phase C — Tendermint BFT State Machine (B.3.2)",
    algorithm: "Classic 3-Phase BFT",
    icon: Cpu,
    status: "next",
    duration: "5-7 din (NEXT UP)",
    tps: "1,000-3,000",
    finality: "1-2 sec",
    validators: "2-25 active",
    complexity: 3,
    description:
      "🎯 NEXT UP. B.2 ke vote infrastructure ke upar full Tendermint state machine: round-robin proposer rotation, propose→prevote→precommit→commit timeouts, 2/3+ voting-power commit gate, LastCommit field in block header. Replaces single-validator PoA producer — chain HALT karega agar quorum nahi mila (correct BFT behaviour). Tolerates up to 1/3 malicious validators. Instant finality.",
    benefits: [
      "Instant finality (no reorgs ever)",
      "Tolerates 1/3 malicious validators",
      "Battle-tested (Cosmos, BNB Chain)",
      "Production-ready in 1 week",
    ],
    challenges: [
      "O(n²) message complexity",
      "Leader bottleneck per round",
      "View-change protocol complexity",
      "Round timeout tuning",
    ],
    subtasks: [
      { name: "Vote message types (PreVote, PreCommit, Proposal)", desc: "Signed structs + serialization", effort: "1 din" },
      { name: "Round state machine", desc: "Propose → PreVote → PreCommit → Commit phases", effort: "2 din" },
      { name: "2f+1 vote aggregation", desc: "Power-weighted vote counting", effort: "1 din" },
      { name: "Round timeouts + view-change", desc: "Skip offline leaders", effort: "1 din" },
      { name: "Block commit + state finalization", desc: "Atomic chain extension", effort: "0.5 din" },
      { name: "Multi-node integration test", desc: "4 validators on VPS, kill 1, verify 3 continue", effort: "1 din" },
    ],
    files: ["src/bft/mod.rs (new)", "src/bft/round.rs (new)", "src/bft/votes.rs (new)"],
  },
  {
    id: "phase-d",
    level: 5,
    name: "Phase D — Slashing + Reward Distribution",
    algorithm: "Economic Security",
    icon: AlertTriangle,
    status: "future",
    duration: "2-3 din",
    tps: "Same",
    finality: "Same",
    validators: "25 active",
    complexity: 2,
    description:
      "Cryptoeconomic security layer. Detect double-signing via signed evidence, slash 5% stake. Liveness slashing for offline validators. Block rewards split among signers.",
    benefits: [
      "Economic disincentive for attacks",
      "Auto-removal of offline validators",
      "Fair reward distribution",
    ],
    challenges: [
      "Evidence detection algorithm",
      "Double-sign vs reorg edge cases",
      "Reward formula (commission, delegators)",
    ],
    subtasks: [
      { name: "Double-sign evidence tx", desc: "Two conflicting votes from same validator", effort: "1 din" },
      { name: "Slashing engine", desc: "Burn % of stake + jail period", effort: "0.5 din" },
      { name: "Liveness tracking", desc: "Missed-blocks counter per validator", effort: "0.5 din" },
      { name: "Reward distribution", desc: "Per-block split: 90% validators, 10% community", effort: "1 din" },
    ],
    files: ["src/slashing.rs (new)", "src/rewards.rs (new)"],
  },
  {
    id: "phase-e",
    level: 6,
    name: "Phase E — HotStuff Pipelined BFT",
    algorithm: "Linear-Complexity BFT",
    icon: Zap,
    status: "future",
    duration: "2-3 mahine",
    tps: "30,000-100,000",
    finality: "500ms",
    validators: "100+ active",
    complexity: 4,
    description:
      "Aptos-grade pipelined BFT. Voting messages chain ho jaate hain (CPU pipeline style). O(n) complexity instead of O(n²). 10-30x throughput jump.",
    benefits: [
      "Linear message complexity",
      "Scales to 200+ validators",
      "30-100x throughput vs Tendermint",
      "500ms finality",
    ],
    challenges: [
      "Pipeline race conditions",
      "Higher implementation complexity",
      "Garbage collection of old views",
      "Three-chain rule debugging hard",
    ],
    subtasks: [
      { name: "QC (Quorum Certificate) data structure", desc: "Aggregated 2f+1 signatures", effort: "1 week" },
      { name: "Pipelined chain state machine", desc: "Track 3 chained QCs (prepare, precommit, commit)", effort: "2 weeks" },
      { name: "Pacemaker (round advancement)", desc: "Async timeout + view sync", effort: "1 week" },
      { name: "Threshold signature aggregation (BLS)", desc: "Single sig instead of n sigs", effort: "2 weeks" },
      { name: "Migration from Tendermint", desc: "Hard fork at block N, validator opt-in", effort: "1 week" },
      { name: "Stress testing", desc: "100-validator testnet, fault injection", effort: "2 weeks" },
    ],
    files: ["src/hotstuff/ (new directory, ~10 files)"],
  },
  {
    id: "phase-f",
    level: 7,
    name: "Phase F — Narwhal-Style DAG Mempool",
    algorithm: "Reliable Broadcast DAG",
    icon: GitBranch,
    status: "future",
    duration: "3-4 mahine",
    tps: "100,000-200,000",
    finality: "500ms",
    validators: "100+ active",
    complexity: 5,
    description:
      "Mempool ko DAG mein convert karo. Sab validators parallel mein txs propose karte hain. Consensus sirf 'order' decide karta hai, 'data' DAG already store karta hai. Sui ka secret sauce!",
    benefits: [
      "Bandwidth fully utilized (no leader bottleneck)",
      "2-5x throughput vs HotStuff",
      "Censorship-resistant (no single proposer)",
      "Foundation for Mysticeti",
    ],
    challenges: [
      "Reliable broadcast protocol",
      "DAG garbage collection",
      "Causal ordering enforcement",
      "Storage explosion if not pruned",
    ],
    subtasks: [
      { name: "Worker/Primary architecture", desc: "Tx batching + cert generation", effort: "3 weeks" },
      { name: "Reliable broadcast (Bracha)", desc: "Echo-Ready 3-phase protocol", effort: "3 weeks" },
      { name: "DAG construction + storage", desc: "Vertices + parent pointers in RocksDB", effort: "2 weeks" },
      { name: "Causal commit ordering", desc: "DFS traversal of finalized DAG", effort: "2 weeks" },
      { name: "Integration with HotStuff (Phase E)", desc: "DAG provides data, HS provides order", effort: "2 weeks" },
    ],
    files: ["src/narwhal/ (new directory, ~15 files)"],
  },
  {
    id: "phase-g",
    level: 8,
    name: "Phase G — Mysticeti DAG-BFT (Sui-Style)",
    algorithm: "DAG-Based BFT, 3-Leader",
    icon: Sparkles,
    status: "future",
    duration: "6-12 mahine",
    tps: "200,000-300,000",
    finality: "390ms",
    validators: "150+ active",
    complexity: 5,
    description:
      "Sui mainnet ka actual algorithm. Multi-leader (3 parallel) DAG consensus. Yahan tak pahunchne ke baad tumhari chain Sui-class TPS dega. Bahut bada engineering effort.",
    benefits: [
      "297K+ TPS (Sui benchmark)",
      "390ms finality",
      "3-leader parallel = no single bottleneck",
      "World-class scale",
    ],
    challenges: [
      "PhD-level DAG protocol",
      "Mysten Labs research papers (2023-2024)",
      "Massive testing burden",
      "Equivocation detection",
      "Realistic only with 4-6 senior engineers",
    ],
    subtasks: [
      { name: "Study Mysticeti paper deeply", desc: "MystenLabs/sui repo + papers", effort: "1 month" },
      { name: "3-leader DAG protocol", desc: "Parallel proposer logic", effort: "2 months" },
      { name: "Voting + commit waves", desc: "Threshold-based DAG commit", effort: "2 months" },
      { name: "Equivocation slashing", desc: "Detect conflicting proposals", effort: "1 month" },
      { name: "Migration from Phase F", desc: "Hard fork, careful state migration", effort: "1 month" },
      { name: "Production hardening + audit", desc: "External audit ($500K+)", effort: "3-6 months" },
    ],
    files: ["src/mysticeti/ (new directory, ~30 files, 50K+ LOC)"],
  },
];

const STATUS_META: Record<PhaseStatus, { icon: typeof CheckCircle2; color: string; badge: string; label: string }> = {
  done: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    label: "Done",
  },
  active: {
    icon: Clock,
    color: "text-amber-400",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    label: "Active",
  },
  next: {
    icon: Target,
    color: "text-blue-400",
    badge: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    label: "Next Up",
  },
  future: {
    icon: Circle,
    color: "text-slate-500",
    badge: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    label: "Future",
  },
};

function ComplexityDots({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i <= level
              ? level <= 2
                ? "bg-emerald-400"
                : level === 3
                  ? "bg-amber-400"
                  : "bg-rose-400"
              : "bg-slate-700"
          }`}
        />
      ))}
    </div>
  );
}

export default function ConsensusRoadmap() {
  const done = PHASES.filter((p) => p.status === "done").length;
  const next = PHASES.filter((p) => p.status === "next").length;
  const future = PHASES.filter((p) => p.status === "future").length;

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
          <GitBranch className="h-7 w-7 text-purple-400" /> Consensus Roadmap — DAG-BFT Tak Ka Safar
        </h1>
        <p className="text-slate-400 max-w-3xl">
          Zebvix L1 ka step-by-step consensus evolution plan — current PoA se Sui-style Mysticeti DAG-BFT
          tak. Har phase ek concrete milestone hai with realistic effort estimates.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-emerald-950/30 border-emerald-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-emerald-400">{done}</div>
            <div className="text-xs text-emerald-300/80 mt-1">Completed Phases</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-950/30 border-blue-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-blue-400">{next}</div>
            <div className="text-xs text-blue-300/80 mt-1">Next Up</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-slate-300">{future}</div>
            <div className="text-xs text-slate-400 mt-1">Future Phases</div>
          </CardContent>
        </Card>
        <Card className="bg-purple-950/30 border-purple-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-purple-300">DAG-BFT</div>
            <div className="text-xs text-purple-300/80 mt-1">Final Goal (Phase G)</div>
          </CardContent>
        </Card>
      </div>

      {/* Strategy banner */}
      <Card className="bg-gradient-to-r from-purple-950/40 to-blue-950/40 border-purple-500/30">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <Target className="h-5 w-5 text-purple-300 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-purple-200 mb-1">
                Strategy: Phased Climb (NOT a Direct Jump)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                DAG-BFT (Sui's Mysticeti) is the destination, but we cannot skip foundations. Each phase
                builds the infrastructure the next one needs. Phase A (P2P) is mandatory before any BFT.
                Phase C (Tendermint) gives a production-ready chain in ~3 weeks while we work toward
                Phase G. Realistic timeline: <span className="text-purple-300 font-semibold">6-18 months</span>{" "}
                to reach DAG-BFT, deploying intermediate chains along the way.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Total effort summary */}
      <Card className="bg-slate-900/40 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" /> Total Effort Estimate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 text-xs">
            <div className="p-3 rounded-md bg-emerald-950/30 border border-emerald-500/20">
              <div className="text-emerald-300 font-semibold mb-1">Short Term (Phases A-D)</div>
              <div className="text-slate-300">~3 weeks → Production Tendermint BFT</div>
              <div className="text-slate-500 mt-1">Solo dev possible. 25 validators, 3K TPS.</div>
            </div>
            <div className="p-3 rounded-md bg-amber-950/30 border border-amber-500/20">
              <div className="text-amber-300 font-semibold mb-1">Medium Term (Phase E)</div>
              <div className="text-slate-300">~3 months → HotStuff BFT</div>
              <div className="text-slate-500 mt-1">2-3 devs ideal. 100 validators, 50K TPS.</div>
            </div>
            <div className="p-3 rounded-md bg-rose-950/30 border border-rose-500/20">
              <div className="text-rose-300 font-semibold mb-1">Long Term (Phases F-G)</div>
              <div className="text-slate-300">~12-18 months → DAG-BFT (Mysticeti)</div>
              <div className="text-slate-500 mt-1">4-6 senior engineers. 297K TPS, 390ms finality.</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase cards */}
      <div className="space-y-4">
        {PHASES.map((p, idx) => {
          const meta = STATUS_META[p.status];
          const Icon = p.icon;
          const StatusIcon = meta.icon;
          return (
            <div key={p.id}>
              <Card
                className={`bg-slate-900/40 border-slate-700/50 ${
                  p.status === "next" ? "ring-2 ring-blue-500/30" : ""
                }`}
                data-testid={`phase-${p.id}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3">
                      <div
                        className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                          p.status === "done"
                            ? "bg-emerald-500/15"
                            : p.status === "next"
                              ? "bg-blue-500/15"
                              : "bg-slate-800/60"
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${meta.color}`} />
                      </div>
                      <div>
                        <CardTitle className="text-lg text-white flex items-center gap-2 flex-wrap">
                          {p.name}
                          <Badge className={`text-[10px] border ${meta.badge}`}>
                            <StatusIcon className="h-2.5 w-2.5 mr-1 inline" />
                            {meta.label}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="text-slate-400 text-xs mt-1">
                          {p.algorithm} · Level {p.level}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span>Complexity:</span>
                      <ComplexityDots level={p.complexity} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Stats grid */}
                  <div className="grid gap-2 grid-cols-2 md:grid-cols-4 text-xs">
                    <div className="p-2 rounded bg-slate-950/40 border border-slate-800/60">
                      <div className="text-slate-500">Duration</div>
                      <div className="text-slate-200 font-mono mt-0.5">{p.duration}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-950/40 border border-slate-800/60">
                      <div className="text-slate-500">Throughput</div>
                      <div className="text-slate-200 font-mono mt-0.5">{p.tps}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-950/40 border border-slate-800/60">
                      <div className="text-slate-500">Finality</div>
                      <div className="text-slate-200 font-mono mt-0.5">{p.finality}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-950/40 border border-slate-800/60">
                      <div className="text-slate-500">Validators</div>
                      <div className="text-slate-200 font-mono mt-0.5">{p.validators}</div>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-slate-300 leading-relaxed">{p.description}</p>

                  {/* Benefits + Challenges */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="p-3 rounded bg-emerald-950/20 border border-emerald-500/20">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-2">
                        ✓ Benefits
                      </div>
                      <ul className="space-y-1">
                        {p.benefits.map((b, i) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2">
                            <span className="text-emerald-400 shrink-0">•</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3 rounded bg-rose-950/20 border border-rose-500/20">
                      <div className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold mb-2">
                        ⚠ Challenges
                      </div>
                      <ul className="space-y-1">
                        {p.challenges.map((c, i) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2">
                            <span className="text-rose-400 shrink-0">•</span>
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Sub-tasks */}
                  {p.subtasks.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
                        🔧 Sub-Tasks ({p.subtasks.length})
                      </div>
                      <div className="space-y-1.5">
                        {p.subtasks.map((t, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 p-2 rounded bg-slate-950/40 border border-slate-800/40"
                          >
                            <Circle className="h-3 w-3 text-slate-600 mt-1 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-xs font-medium text-slate-200">{t.name}</span>
                                <Badge className="text-[9px] bg-slate-800 text-slate-400 border-slate-700 border">
                                  {t.effort}
                                </Badge>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">{t.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Files */}
                  {p.files && p.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[10px] text-slate-500 mr-1">Files:</span>
                      {p.files.map((f) => (
                        <span
                          key={f}
                          className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Arrow connector */}
              {idx < PHASES.length - 1 && (
                <div className="flex justify-center py-2">
                  <ArrowRight className="h-5 w-5 text-slate-700 rotate-90" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer reality check */}
      <Card className="bg-amber-950/20 border-amber-500/30">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-amber-200 mb-1">Honest Reality Check</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Sui ki Mysticeti ko Mysten Labs ne <strong className="text-amber-300">$300M+ funding</strong>{" "}
                aur <strong className="text-amber-300">150+ engineers</strong> ke saath{" "}
                <strong className="text-amber-300">4 saal</strong> mein build kiya hai. Solo dev + AI assistant
                ke saath same level production-ready Mysticeti realistic nahi hai. <br />
                <br />
                <strong className="text-emerald-300">Practical path:</strong> Phase C (Tendermint BFT) tak
                jaake stop karo — 3 weeks mein 3,000 TPS chain ready, jo 99% real-world use cases ke liye
                kaafi hai. Phase E-G ko long-term roadmap rakho, jab funding + team available ho.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Database icon footer */}
      <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-600">
        <Database className="h-3 w-3" />
        <span>Roadmap maintained as canonical reference for Zebvix consensus evolution</span>
      </div>
    </div>
  );
}
