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
  Info,
} from "lucide-react";

type StageStatus = "live" | "next" | "planned" | "research";

interface SubTask {
  name: string;
  desc: string;
  status: "done" | "todo";
}

interface Stage {
  id: string;
  level: number;
  name: string;
  algorithm: string;
  icon: typeof Network;
  status: StageStatus;
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

const STAGES: Stage[] = [
  {
    id: "stage-0",
    level: 1,
    name: "Stage 0 — Single-Validator PoA + Round-Bump Safety Net",
    algorithm: "Proof of Authority + B.3.2.1/2 timeout-bumping",
    icon: Shield,
    status: "live",
    duration: "LIVE today",
    tps: "Not benchmarked",
    finality: "5 sec (BLOCK_TIME_SECS)",
    validators: "1 (founder, deterministic)",
    complexity: 1,
    description:
      "Today's actual block production. Founder validator (address derived deterministically from compiled-in tokenomics::FOUNDER_PUBKEY_HEX) signs every block with its secp256k1 keyfile. consensus.rs::Producer paces round 0 to BLOCK_TIME_SECS=5s; if the elected proposer at (height H, round 0) does not commit within PROPOSE_TIMEOUT_SECS=8s, every node bumps to round 1 and re-elects via who_proposes(H, 1, sorted_validators) — selection idx = (height + round) % validators.len(). State-machine wakes every TICK_INTERVAL_MS=500ms. With 1 active validator the round bump is a no-op; with ≥2 it rotates through the set so liveness is preserved when one is offline.",
    benefits: [
      "Single-binary block production already running",
      "Zero quorum complexity — single signer",
      "Round-bumping already in place for future multi-validator liveness",
      "Predictable 5-sec block production",
    ],
    challenges: [
      "Single point of failure (founder key)",
      "No Byzantine fault tolerance — founder can censor or double-sign with no on-chain penalty yet",
      "Throughput unbenchmarked — no published TPS number",
    ],
    subtasks: [
      { name: "consensus.rs::Producer single-validator block production", desc: "BLOCK_TIME_SECS=5 paced", status: "done" },
      { name: "B.3.2.1 — round counter + bump timeout", desc: "PROPOSE_TIMEOUT_SECS=8, TICK_INTERVAL_MS=500", status: "done" },
      { name: "B.3.2.2 — round-robin proposer election", desc: "who_proposes(h, r, sorted_vals) → addr", status: "done" },
    ],
    files: ["src/consensus.rs", "src/main.rs", "src/tokenomics.rs (BLOCK_TIME_SECS, FOUNDER_PUBKEY_HEX)"],
  },
  {
    id: "stage-1",
    level: 2,
    name: "Stage 1 — P2P Networking Foundation (Phase A)",
    algorithm: "libp2p 0.54 + Gossipsub strict + mDNS",
    icon: Network,
    status: "live",
    duration: "LIVE since Apr 22, 2026",
    tps: "Not benchmarked",
    finality: "5 sec",
    validators: "1 producer + N followers",
    complexity: 2,
    description:
      "Networking layer (Phase A in zebvix-chain phase ladder). libp2p 0.54 with TCP+Noise+Yamux. Gossipsub strict mode (2s heartbeat, 1MiB max, DefaultHasher dedupe) on 4 chain-id-namespaced topics: zebvix/7878/{blocks,txs,heartbeat,votes}/v1. Block-sync via request_response::cbor on /zebvix/sync/1.0.0 with SYNC_BATCH_MAX=256, 15s timeout, one-in-flight. Peer discovery: mDNS LAN-only (disable with --no-mdns). Bootstrap peers via repeatable --peer <multiaddr> flag (singular long name, Vec<String> backing — pass it multiple times). PeerId is derived from an ed25519 identity generated fresh at every node start (SwarmBuilder::with_new_identity) — INDEPENDENT of the secp256k1 chain key, so peer-id rotates per restart. Pinning via with_existing_identity is on the hardening list.",
    benefits: [
      "Multi-node infra ready (validators + RPC nodes)",
      "Block + tx + vote propagation working",
      "Followers catch up by replaying from height 0",
    ],
    challenges: [
      "mDNS only works on LAN — production needs static --peer multiaddrs",
      "PeerId rotates per restart (no with_existing_identity wiring yet)",
      "No NAT traversal, no DHT discovery, no eclipse-attack mitigation",
    ],
    subtasks: [
      { name: "libp2p 0.54 + tokio + gossipsub + mdns", desc: "tcp::Config nodelay, noise XX, yamux", status: "done" },
      { name: "4 gossipsub topics (chain-id-namespaced)", desc: "blocks/txs/heartbeat/votes v1", status: "done" },
      { name: "Block sync protocol", desc: "request_response cbor /zebvix/sync/1.0.0, 256-batch", status: "done" },
      { name: "Heartbeat ({ tip: u64 }) every 8s", desc: "out-of-band sync detection", status: "done" },
      { name: "PeerId pinning via with_existing_identity", desc: "Avoid per-restart rotation", status: "todo" },
    ],
    files: ["src/p2p.rs", "src/main.rs (--peer flag, --no-mdns flag)"],
  },
  {
    id: "stage-2",
    level: 3,
    name: "Stage 2 — Validator Set, Vote Pool & TxKind Governance (Phase B.1–B.12 feature modules)",
    algorithm: "On-chain registry + secp256k1 votes + 11 TxKinds + staking",
    icon: Users,
    status: "live",
    duration: "Feature modules LIVE — B.3.2.3/B.3.2.4 still pending (see Stage 3)",
    tps: "Not benchmarked",
    finality: "5 sec (still single-validator pacing — full BFT finality lands in Stage 3)",
    validators: "Set membership replicates via apply_tx",
    complexity: 3,
    description:
      "Phase B in the zebvix-chain ladder is an umbrella for twelve numbered FEATURE modules, all of which have shipped as marked by their //! Phase B.* source markers — but the consensus sub-tree B.3.2 is itself only partially complete: B.3.2.1 (round counter + bump) and B.3.2.2 (round-robin proposer) are LIVE, while B.3.2.3 (2/3+ commit gate) and B.3.2.4 (LastCommit) are explicitly called out as \"come next\" in consensus.rs:14 — those are Stage 3 below. The feature modules in scope here: validator registry persisted in CF_META, secp256k1-signed Vote messages with VotePool double-sign detection, eleven TxKind variants dispatched by state.rs::apply_tx, share-based delegated staking, Pay-ID alias registration, multisig wallets, ZBX/zUSD AMM pool, secp256k1 chain crypto, Phase B.12 cross-chain bridge. NOTE on votes: the pool tracks (height, round, vote_type) per validator and computes a reached_quorum flag (logged as ✅ QUORUM in main.rs:1051), but the producer in consensus.rs does NOT yet wait on quorum before extending the tip — today votes are gossiped + verified + recorded as slashing evidence only; block commit is still single-validator PoA pacing.",
    benefits: [
      "All validator-set mutations replicate via TxKind — no manual sync",
      "Vote pool already collects double-sign evidence (ready for slashing)",
      "Staking, multisig, AMM, bridge, governance all running on top of the same module set",
      "Two-tier validator onboarding: StakeOp::CreateValidator (self-bond ≥100 ZBX) + governor-only ValidatorAdd (consensus seat)",
    ],
    challenges: [
      "Quorum is COMPUTED but does NOT yet GATE block commits",
      "Slashing primitives exist (slash_double_sign 5%, slash_downtime 0.10%) but auto-enforcement is missing",
      "Validators sorted by address — no power-weighted leader rotation yet",
    ],
    subtasks: [
      { name: "B.1 — Validator registry in CF_META", desc: "types::Validator { pubkey: [u8;33], voting_power: u64 }", status: "done" },
      { name: "B.2 — secp256k1-signed Vote + VotePool", desc: "Domain-tagged signing, double-sign returns AddVoteResult::DoubleSign { previous }", status: "done" },
      { name: "B.3.1 — TxKind dispatch in apply_tx", desc: "11 variants: Transfer / ValidatorAdd / ValidatorRemove / ValidatorEdit / GovernorChange / Staking / RegisterPayId / Multisig / Swap / Bridge / Proposal", status: "done" },
      { name: "B.3.2.1+2 — round bumping + round-robin proposer", desc: "consensus.rs PROPOSE_TIMEOUT_SECS, who_proposes()", status: "done" },
      { name: "B.4 — Share-based delegated staking", desc: "MIN_SELF_BOND_WEI=100 ZBX, MIN_DELEGATION_WEI=10 ZBX, EPOCH_BLOCKS=17280, UNBONDING_EPOCHS=7", status: "done" },
      { name: "B.7 — Pay-ID alias (RegisterPayId)", desc: "<handle>@zbx, permanent; zbx_lookupPayId / zbx_getPayIdOf / zbx_payIdCount RPCs", status: "done" },
      { name: "B.8 — Multisig wallet (5 ops)", desc: "Create/Propose/Approve/Revoke/Execute, 2..=10 owners, MultisigAction::Transfer (v1 only)", status: "done" },
      { name: "B.10 — ZBX/zUSD AMM pool", desc: "x·y=k, 0.3% fee, 10M zUSD genesis loan repayment then 50/50 protocol-treasury / LP split", status: "done" },
      { name: "B.11 — secp256k1 chain crypto (k256)", desc: "MetaMask-compatible; SignedTx { body, pubkey:[u8;33], signature:[u8;64] } — sender RECOMPUTED, no recovery byte", status: "done" },
      { name: "B.12 — Cross-chain bridge", desc: "single-trusted-oracle MVP, lock-and-mint + burn-and-release, MAX_OUT_EVENTS=4096 ring", status: "done" },
      { name: "RPCs: zbx_listValidators / zbx_voteStats", desc: "Live registry + per-validator vote rate", status: "done" },
    ],
    files: [
      "src/state.rs (registry + apply_tx)",
      "src/vote.rs (Vote/VotePool, secp256k1)",
      "src/types.rs (TxKind)",
      "src/staking.rs (B.4)",
      "src/multisig.rs (B.8)",
      "src/pool.rs (B.10)",
      "src/bridge.rs (B.12)",
      "src/main.rs (CLI + RPC bootstrap)",
    ],
  },
  {
    id: "stage-3",
    level: 4,
    name: "Stage 3 — Quorum Commit Gate + LastCommit (B.3.2.3 / B.3.2.4)",
    algorithm: "Tendermint-style 2/3+ voting-power finality",
    icon: Cpu,
    status: "next",
    duration: "Next consensus milestone (per consensus.rs //! comment)",
    tps: "TBD",
    finality: "Target: 1 block (~5s) with instant finality on commit",
    validators: "2/3+ voting power required",
    complexity: 3,
    description:
      "The literal next two milestones called out in src/consensus.rs (line 14): (B.3.2.3) Producer must wait for ≥2/3 voting-power Precommit votes before extending the tip — chain HALTS if quorum not reached (correct BFT liveness/safety trade-off, tolerates up to 1/3 Byzantine). (B.3.2.4) Embed a LastCommit field in BlockHeader containing the aggregated Precommit votes that finalized height H-1 — gives full historical verifiability. Vote infrastructure (signing, gossip, pool, double-sign detection, reached_quorum flag) is ALREADY in place from B.2; this milestone is about WIRING the producer to consume it.",
    benefits: [
      "True instant finality (no reorgs after commit)",
      "Tolerates ⌊(n-1)/3⌋ Byzantine validators",
      "Builds directly on existing VotePool — minimal new code",
      "Standard Tendermint behaviour — battle-tested design space",
    ],
    challenges: [
      "Chain halts if quorum lost (acceptable BFT safety choice)",
      "Need to handle round timeouts properly (already partially in B.3.2.1)",
      "LastCommit verification adds ~32 + 64*n bytes per header",
      "Multi-node test on VPS: spin up 4 validators, kill 1, verify the other 3 still commit",
    ],
    subtasks: [
      { name: "B.3.2.3 — 2/3+ voting-power commit gate", desc: "Producer waits on VotePool.reached_quorum for Precommits before applying block", status: "todo" },
      { name: "B.3.2.4 — LastCommit field in BlockHeader", desc: "Aggregated Precommit set for height H-1 stored in block H header", status: "todo" },
      { name: "Header signing-bytes update for LastCommit", desc: "header_signing_bytes() in crypto.rs must include the new field", status: "todo" },
      { name: "Followers verify LastCommit on block apply", desc: "Reject block H if its LastCommit doesn't reach 2/3 of H-1's validator set", status: "todo" },
      { name: "Multi-validator VPS integration test", desc: "4-node testnet, kill one, expect liveness on remaining 3", status: "todo" },
    ],
    files: [
      "src/consensus.rs (Producer wait-for-quorum)",
      "src/types.rs (BlockHeader::last_commit)",
      "src/crypto.rs (header_signing_bytes)",
      "src/state.rs (apply_block verifies LastCommit)",
    ],
  },
  {
    id: "stage-4",
    level: 5,
    name: "Stage 4 — Slashing Auto-Enforcement",
    algorithm: "Wire existing primitives to evidence",
    icon: AlertTriangle,
    status: "planned",
    duration: "After Stage 3",
    tps: "Same as Stage 3",
    finality: "Same",
    validators: "Same",
    complexity: 2,
    description:
      "The cryptoeconomic security layer. The PRIMITIVES already exist in staking.rs as slash_double_sign (5% of bonded stake) and slash_downtime (0.10%) — what's missing is the wiring from evidence to invocation. Stage 4 hooks (a) the AddVoteResult::DoubleSign { previous } emitted by VotePool into a SlashEvidence tx that any node can broadcast (with verifiable conflicting-vote bytes), processed via apply_tx; and (b) a missed-block counter per validator (incremented when its slot in who_proposes is skipped on round bump) that triggers downtime slashing once a threshold is crossed.",
    benefits: [
      "No new cryptography needed — primitives already audited",
      "Closes the \"votes ready for slashing\" loop noted on the Validators page",
      "Removes founder ability to silently double-sign without economic penalty",
    ],
    challenges: [
      "Evidence-tx format: must be self-verifiable (two conflicting Vote messages, same (height, round, vote_type, voter) but different block_hash)",
      "Reorg vs equivocation distinction (legitimate fork on round timeout is NOT double-sign)",
      "Jail/unjail flow + downtime threshold tuning",
    ],
    subtasks: [
      { name: "TxKind::SlashEvidence variant + apply_tx dispatch", desc: "Verify two Vote messages on-chain, slash + jail validator", status: "todo" },
      { name: "Auto-broadcast on AddVoteResult::DoubleSign", desc: "main.rs vote-pool sink → broadcast SlashEvidence", status: "todo" },
      { name: "Missed-block counter per validator", desc: "Increment when slot skipped on round bump; threshold-trigger slash_downtime", status: "todo" },
      { name: "Jail / unjail (waiting period) flow", desc: "Jailed validators are excluded from who_proposes until manual unjail tx", status: "todo" },
    ],
    files: [
      "src/staking.rs (slash_* already present)",
      "src/types.rs (SlashEvidence variant)",
      "src/state.rs (apply_tx + missed-block tracker)",
    ],
  },
  {
    id: "stage-5",
    level: 6,
    name: "Stage 5 — HotStuff-Style Pipelined BFT",
    algorithm: "Linear-complexity BFT with QC chaining",
    icon: Zap,
    status: "research",
    duration: "Long-term research (estimate 2-3 months FT engineering)",
    tps: "Aspirational: 30k–100k",
    finality: "Aspirational: ~500ms",
    validators: "100+",
    complexity: 4,
    description:
      "Aptos-grade pipelined BFT. Voting messages chain together (Quorum Certificates feed the next view's proposal), reducing message complexity from O(n²) to O(n) per height. Threshold signature aggregation (BLS) collapses 2/3 signatures into one. Estimates here are aspirational ceilings cited from public benchmarks, NOT a Zebvix measurement.",
    benefits: [
      "Linear message complexity per round",
      "Scales to 200+ validators in published benchmarks",
      "10–30x throughput vs classic Tendermint in published benchmarks",
    ],
    challenges: [
      "Pipeline race conditions (3-chain rule debugging is notoriously hard)",
      "Garbage collection of old views",
      "Requires BLS threshold signature library + key ceremony",
      "Hard fork from Stage 3/4 chain — careful migration",
    ],
    subtasks: [
      { name: "QC (Quorum Certificate) data structure", desc: "Aggregated 2f+1 signatures, threshold-signed", status: "todo" },
      { name: "Pipelined chain state machine", desc: "Track 3 chained QCs (prepare, precommit, commit)", status: "todo" },
      { name: "Pacemaker (round advancement)", desc: "Async timeout + view sync", status: "todo" },
      { name: "BLS threshold signature aggregation", desc: "Single sig instead of n sigs", status: "todo" },
      { name: "Migration from Stage 3/4", desc: "Hard fork at block N, validator opt-in", status: "todo" },
    ],
    files: ["src/hotstuff/ (new directory)"],
  },
  {
    id: "stage-6",
    level: 7,
    name: "Stage 6 — Narwhal-Style DAG Mempool",
    algorithm: "Reliable broadcast DAG, decoupled from consensus",
    icon: GitBranch,
    status: "research",
    duration: "Long-term research (estimate 3-4 months FT engineering)",
    tps: "Aspirational: 100k–200k",
    finality: "Aspirational: ~500ms",
    validators: "100+",
    complexity: 5,
    description:
      "Decouple data dissemination from consensus. All validators propose tx batches in parallel via reliable broadcast (Bracha-style 3-phase echo-ready); the BFT layer above only commits an ORDERING over already-disseminated DAG vertices. This eliminates the leader-bandwidth bottleneck and is the foundation Mysticeti builds on.",
    benefits: [
      "Bandwidth fully utilised across all validators (no leader bottleneck)",
      "Censorship-resistance — no single proposer can drop a tx",
      "Foundation for Stage 7 (Mysticeti)",
    ],
    challenges: [
      "Reliable broadcast protocol must be implemented correctly (Bracha)",
      "DAG garbage collection and pruning",
      "Storage explosion if DAG isn't aggressively pruned post-commit",
      "Causal ordering enforcement at commit time",
    ],
    subtasks: [
      { name: "Worker / Primary architecture", desc: "Tx batching + cert generation per validator", status: "todo" },
      { name: "Reliable broadcast (Bracha)", desc: "Echo-Ready 3-phase protocol", status: "todo" },
      { name: "DAG construction + storage", desc: "Vertices + parent pointers in RocksDB", status: "todo" },
      { name: "Causal commit ordering", desc: "DFS traversal of finalized DAG", status: "todo" },
      { name: "Integration with Stage 5 (HotStuff)", desc: "DAG provides data, HotStuff provides order", status: "todo" },
    ],
    files: ["src/narwhal/ (new directory)"],
  },
  {
    id: "stage-7",
    level: 8,
    name: "Stage 7 — Mysticeti DAG-BFT (END GOAL)",
    algorithm: "Multi-leader DAG-based BFT",
    icon: Sparkles,
    status: "research",
    duration: "Multi-year research / large-team effort",
    tps: "Aspirational: published Sui benchmarks ~297k",
    finality: "Aspirational: ~390ms",
    validators: "150+",
    complexity: 5,
    description:
      "Sui mainnet's actual algorithm. Multi-leader (3 parallel proposers per round) DAG consensus with threshold-based commit waves. This is the stated north star — but reaching production-grade Mysticeti would require a sustained multi-engineer research effort; this stage is included for direction-of-travel transparency, not as a near-term commitment.",
    benefits: [
      "297K+ TPS in Sui's published benchmarks",
      "~390ms finality in Sui's published benchmarks",
      "3-leader parallel commits — no single-proposer bottleneck",
    ],
    challenges: [
      "PhD-level protocol — multiple Mysten Labs research papers (2023–2024)",
      "Equivocation detection across parallel leaders",
      "Massive testing burden + external audit before any production deployment",
      "Realistic only with a dedicated multi-engineer team and audit budget",
    ],
    subtasks: [
      { name: "Study Mysticeti paper + Sui reference impl", desc: "Multiple research papers + MystenLabs/sui repo", status: "todo" },
      { name: "3-leader parallel proposal logic", desc: "Per-round multi-leader DAG construction", status: "todo" },
      { name: "Threshold-based commit waves", desc: "DAG commit rules with multi-leader voting", status: "todo" },
      { name: "Equivocation slashing", desc: "Detect conflicting parallel-leader proposals", status: "todo" },
      { name: "Migration from Stage 5/6", desc: "Hard fork, careful state migration", status: "todo" },
      { name: "Production hardening + external audit", desc: "Multi-month audit + bug-bounty cycle", status: "todo" },
    ],
    files: ["src/mysticeti/ (new directory)"],
  },
];

const STATUS_META: Record<StageStatus, { icon: typeof CheckCircle2; color: string; badge: string; label: string }> = {
  live: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    label: "LIVE",
  },
  next: {
    icon: Target,
    color: "text-blue-400",
    badge: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    label: "Next",
  },
  planned: {
    icon: Clock,
    color: "text-amber-400",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    label: "Planned",
  },
  research: {
    icon: Circle,
    color: "text-slate-500",
    badge: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    label: "Research",
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
  const live = STAGES.filter((p) => p.status === "live").length;
  const next = STAGES.filter((p) => p.status === "next").length;
  const planned = STAGES.filter((p) => p.status === "planned").length;
  const research = STAGES.filter((p) => p.status === "research").length;

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
          <GitBranch className="h-7 w-7 text-purple-400" /> Consensus Roadmap — Path to DAG-BFT
        </h1>
        <p className="text-slate-400 max-w-3xl">
          A step-by-step evolution plan for the Zebvix L1{" "}
          <strong className="text-slate-300">consensus engine</strong> — from today's
          single-validator PoA with round-bump safety net all the way to the long-term
          DAG-BFT research goal. Each stage is a concrete milestone with the source-file
          references listed below.
        </p>
      </div>

      {/* Disambiguation callout — IMPORTANT */}
      <Card className="bg-blue-950/20 border-blue-500/30">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-300 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-blue-200 mb-1">
                "Stage" here is not the same as "Phase" in the Implementation Roadmap
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                The zebvix-chain source uses Phase-letter markers (
                <code className="text-blue-300 font-mono">//! Phase A / B.* / C.* / D</code>) to label
                feature areas — Phase A = p2p, Phase B = core chain modules including B.3.2.x consensus
                sub-milestones, Phase C = ZVM, Phase D = forkless governance. This page uses{" "}
                <strong className="text-blue-200">"Stage" labels</strong> for the consensus-engine evolution
                narrative so it does not collide with chain feature phase letters. Cross-reference the{" "}
                <strong className="text-blue-200">Implementation Roadmap</strong> page for the full list of
                what shipped under each chain phase letter.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-emerald-950/30 border-emerald-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-emerald-400">{live}</div>
            <div className="text-xs text-emerald-300/80 mt-1">LIVE Stages</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-950/30 border-blue-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-blue-400">{next}</div>
            <div className="text-xs text-blue-300/80 mt-1">Next consensus milestone</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-950/30 border-amber-500/30">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-amber-400">{planned}</div>
            <div className="text-xs text-amber-300/80 mt-1">Planned (after Next)</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/40 border-slate-700/50">
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-slate-300">{research}</div>
            <div className="text-xs text-slate-400 mt-1">Long-term research</div>
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
                DAG-BFT (Sui's Mysticeti) is the directional north star, but we cannot skip foundations. Each
                stage builds the infrastructure the next one needs. The next concrete consensus work is{" "}
                <strong className="text-purple-300">Stage 3 (B.3.2.3 quorum gate + B.3.2.4 LastCommit)</strong>{" "}
                — wiring the producer to consume the existing VotePool — followed by{" "}
                <strong className="text-purple-300">Stage 4 (slashing auto-enforcement)</strong> which only
                needs to wire already-existing primitives. Stages 5–7 (HotStuff / Narwhal / Mysticeti) are
                research-track and require dedicated team + audit budget; they are listed for transparency,
                not as near-term commitments.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Source-grounded reality summary */}
      <Card className="bg-slate-900/40 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Database className="h-4 w-4 text-amber-400" /> What's Actually In <code className="text-amber-300 font-mono">consensus.rs</code> Today
          </CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Quoted/paraphrased directly from the source comments — no benchmarks, no estimates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 text-xs">
            <div className="p-3 rounded-md bg-emerald-950/30 border border-emerald-500/20">
              <div className="text-emerald-300 font-semibold mb-1">Done (B.3.2.1 + B.3.2.2)</div>
              <div className="text-slate-300">Round counter + timeout-bumping + round-robin proposer election</div>
              <div className="text-slate-500 mt-1 font-mono">PROPOSE_TIMEOUT_SECS = 8</div>
              <div className="text-slate-500 font-mono">TICK_INTERVAL_MS = 500</div>
              <div className="text-slate-500 font-mono">BLOCK_TIME_SECS = 5</div>
            </div>
            <div className="p-3 rounded-md bg-blue-950/30 border border-blue-500/20">
              <div className="text-blue-300 font-semibold mb-1">Next (B.3.2.3 + B.3.2.4)</div>
              <div className="text-slate-300">2/3+ commit gate (Producer waits on VotePool quorum) + LastCommit field in BlockHeader</div>
              <div className="text-slate-500 mt-1">Source says: "come next"</div>
            </div>
            <div className="p-3 rounded-md bg-rose-950/30 border border-rose-500/20">
              <div className="text-rose-300 font-semibold mb-1">Today's Reality</div>
              <div className="text-slate-300">Vote pool collects + computes <code className="font-mono">reached_quorum</code> flag, but Producer does NOT wait on it. Block commit is still single-validator pacing.</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stage cards */}
      <div className="space-y-4">
        {STAGES.map((p, idx) => {
          const meta = STATUS_META[p.status];
          const Icon = p.icon;
          const StatusIcon = meta.icon;
          return (
            <div key={p.id}>
              <Card
                className={`bg-slate-900/40 border-slate-700/50 ${
                  p.status === "next" ? "ring-2 ring-blue-500/30" : ""
                }`}
                data-testid={`stage-${p.id}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3">
                      <div
                        className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                          p.status === "live"
                            ? "bg-emerald-500/15"
                            : p.status === "next"
                              ? "bg-blue-500/15"
                              : p.status === "planned"
                                ? "bg-amber-500/15"
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
                      <div className="text-slate-500">Status / Timing</div>
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
                        Benefits
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
                        Open Challenges
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
                        Sub-tasks ({p.subtasks.filter((t) => t.status === "done").length}/{p.subtasks.length} done)
                      </div>
                      <div className="space-y-1.5">
                        {p.subtasks.map((t, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 p-2 rounded bg-slate-950/40 border border-slate-800/40"
                          >
                            {t.status === "done" ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-1 shrink-0" />
                            ) : (
                              <Circle className="h-3 w-3 text-slate-600 mt-1 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-xs font-medium text-slate-200">{t.name}</span>
                                <Badge
                                  className={`text-[9px] border ${
                                    t.status === "done"
                                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                      : "bg-slate-800 text-slate-400 border-slate-700"
                                  }`}
                                >
                                  {t.status === "done" ? "done" : "todo"}
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
                      <span className="text-[10px] text-slate-500 mr-1">Source files:</span>
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
              {idx < STAGES.length - 1 && (
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
                Sui's Mysticeti was built by Mysten Labs over multiple years with a research team and large
                engineering org. Reaching production-grade Mysticeti-class consensus on Zebvix would require
                a sustained dedicated team plus an external audit cycle — it is the directional goal, not a
                near-term promise. <br />
                <br />
                <strong className="text-emerald-300">Practical near-term path:</strong> finish Stage 3
                (B.3.2.3 quorum gate + B.3.2.4 LastCommit) and Stage 4 (slashing auto-enforcement). That
                gives Zebvix true Tendermint-class instant finality with cryptoeconomic security on top of
                the existing Phase B.1–B.12 + Phase D foundations — production-ready for the vast majority
                of L1 use cases without any of the Stage 5–7 research dependencies.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-600">
        <Database className="h-3 w-3" />
        <span>
          Maintained as canonical reference for Zebvix consensus evolution — every stage cites source files
          in <code className="font-mono">zebvix-chain/src/</code>
        </span>
      </div>
    </div>
  );
}
