import React, { useState, useEffect } from "react";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Trophy, Lock } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const STORAGE_KEY = "zebvix-phase-tracker";

const PHASES = [
  {
    id: "P1",
    title: "Binary Build",
    color: "from-green-500 to-emerald-600",
    lightColor: "text-green-400",
    borderColor: "border-green-500/40",
    bgColor: "bg-green-500/8",
    progressColor: "bg-green-500",
    points: [
      { id: "p1_1", text: "Sui repo clone kiya (mainnet-v1.69.2)" },
      { id: "p1_2", text: "Binary naam change kiya: zebvix-node (Cargo.toml [[bin]])" },
      { id: "p1_3", text: "Config dir change kiya: .sui → .zebvix" },
      { id: "p1_4", text: "Token rename kiya: SUI → ZBX (gas_coin.rs)" },
      { id: "p1_5", text: "MIST_PER_SUI → MIST_PER_ZBX (saari files mein)" },
      { id: "p1_6", text: "MIST_PER_ZBX → MIST_PER_ZBX governance.rs fix" },
      { id: "p1_7", text: "cargo build --release -p sui-node --bin zebvix-node" },
      { id: "p1_8", text: "Binary ready: target/release/zebvix-node (114MB)" },
      { id: "p1_9", text: "/usr/local/bin/zebvix-node mein copy kiya" },
    ],
  },
  {
    id: "P2",
    title: "EVM Address Format",
    color: "from-yellow-500 to-orange-500",
    lightColor: "text-yellow-400",
    borderColor: "border-yellow-500/40",
    bgColor: "bg-yellow-500/8",
    progressColor: "bg-yellow-500",
    points: [
      { id: "p2_1", text: "SUI_ADDRESS_LENGTH: 32 → 20 bytes (base_types.rs line 788)" },
      { id: "p2_2", text: "SuiPublicKey derivation: last 20 bytes of hash (line 922)" },
      { id: "p2_3", text: "PublicKey derivation: last 20 bytes of hash (line 932)" },
      { id: "p2_4", text: "MultiSigPublicKey derivation: last 20 bytes (line 954)" },
      { id: "p2_5", text: "ObjectID→SuiAddress: last 20 bytes fix (line 875)" },
      { id: "p2_6", text: "AccountAddress→SuiAddress: last 20 bytes fix (line 881)" },
      { id: "p2_7", text: "SuiAddress→AccountAddress: pad 20→32 bytes fix (line 1811)" },
      { id: "p2_8", text: "sui_sdk_types_conversions.rs fix (line 218)" },
      { id: "p2_9", text: "Rebuild successful — 0 errors" },
    ],
  },
  {
    id: "P3",
    title: "Tokenomics Constants",
    color: "from-blue-500 to-cyan-500",
    lightColor: "text-blue-400",
    borderColor: "border-blue-500/40",
    bgColor: "bg-blue-500/8",
    progressColor: "bg-blue-500",
    points: [
      { id: "p3_1", text: "MAX_TOTAL_SUPPLY_ZBX = 150,000,000 add kiya" },
      { id: "p3_2", text: "GENESIS_SUPPLY_ZBX = 2,000,000 add kiya" },
      { id: "p3_3", text: "FIRST_HALVING_ZBX = 50,000,000 add kiya" },
      { id: "p3_4", text: "SECOND_HALVING_ZBX = 100,000,000 add kiya" },
      { id: "p3_5", text: "INITIAL_BLOCK_REWARD_MIST = 0.1 ZBX add kiya" },
      { id: "p3_6", text: "GAS_VALIDATOR_BPS = 7200 (72%) add kiya" },
      { id: "p3_7", text: "GAS_TREASURY_BPS = 1800 (18%) add kiya" },
      { id: "p3_8", text: "GAS_BURN_BPS = 1000 (10%) add kiya" },
      { id: "p3_9", text: "get_halving_multiplier() function add kiya" },
    ],
  },
  {
    id: "P4",
    title: "CLI Build & Keypairs",
    color: "from-purple-500 to-violet-600",
    lightColor: "text-purple-400",
    borderColor: "border-purple-500/40",
    bgColor: "bg-purple-500/8",
    progressColor: "bg-purple-500",
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
    id: "P5",
    title: "Node Launch",
    color: "from-primary to-cyan-500",
    lightColor: "text-primary",
    borderColor: "border-primary/40",
    bgColor: "bg-primary/8",
    progressColor: "bg-primary",
    points: [
      { id: "p5_1", text: "systemd service file banaya (/etc/systemd/system/zebvix-node.service)" },
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
    id: "P6",
    title: "Move Contracts",
    color: "from-pink-500 to-rose-500",
    lightColor: "text-pink-400",
    borderColor: "border-pink-500/40",
    bgColor: "bg-pink-500/8",
    progressColor: "bg-pink-500",
    points: [
      { id: "p6_1", text: "zebvix-cli client new-env --alias zebvix" },
      { id: "p6_2", text: "Test wallet address mila (ZBX mila faucet se)" },
      { id: "p6_3", text: "Node Runner Rewards contract deploy kiya" },
      { id: "p6_4", text: "Treasury Multisig contract deploy kiya" },
      { id: "p6_5", text: "Staking contract deploy kiya" },
      { id: "p6_6", text: "Contract Package IDs note kiye" },
      { id: "p6_7", text: "Basic transaction test kiya (ZBX transfer)" },
    ],
  },
  {
    id: "P7",
    title: "Ecosystem Launch",
    color: "from-amber-500 to-yellow-500",
    lightColor: "text-amber-400",
    borderColor: "border-amber-500/40",
    bgColor: "bg-amber-500/8",
    progressColor: "bg-amber-500",
    points: [
      { id: "p7_1", text: "GitHub: ZebvixTech/zebvix-node repo banaya" },
      { id: "p7_2", text: "GitHub: sui-explorer fork kiya → ZBX Explorer" },
      { id: "p7_3", text: "GitHub: sui.js fork kiya → zebvix.js SDK" },
      { id: "p7_4", text: "Block Explorer deploy kiya (domain pe)" },
      { id: "p7_5", text: "ZBX Wallet Chrome Extension banaya" },
      { id: "p7_6", text: "Testnet Faucet deploy kiya" },
      { id: "p7_7", text: "zebvix.network domain setup kiya" },
      { id: "p7_8", text: "Documentation publish kiya (docs.zebvix.network)" },
    ],
  },
];

export default function PhaseTracker() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [openPhases, setOpenPhases] = useState<Record<string, boolean>>(
    Object.fromEntries(PHASES.map(p => [p.id, true]))
  );

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
  const isPhaseUnlocked = (idx: number) => idx === 0 || isPhaseComplete(PHASES[idx - 1]);

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
        <button
          onClick={resetAll}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded border border-border hover:border-destructive/50"
        >
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
            <Trophy className="h-4 w-4" />
            Zebvix Chain fully launched! 🎉
          </div>
        )}
      </div>

      {/* Phase grid summary */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {PHASES.map((phase, idx) => {
          const { pct } = phaseProgress(phase);
          const complete = isPhaseComplete(phase);
          return (
            <button
              key={phase.id}
              onClick={() => {
                const el = document.getElementById(`phase-${phase.id}`);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
                setOpenPhases(prev => ({ ...prev, [phase.id]: true }));
              }}
              className={`rounded-lg p-2 text-center border transition-all hover:scale-105 ${
                complete
                  ? "border-green-500/50 bg-green-500/10"
                  : "border-border bg-muted/20"
              }`}
            >
              <div className={`text-xs font-bold ${complete ? "text-green-400" : phase.lightColor}`}>
                {phase.id}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{pct}%</div>
            </button>
          );
        })}
      </div>

      {/* Phase sections */}
      <div className="space-y-3">
        {PHASES.map((phase, idx) => {
          const { done, total, pct } = phaseProgress(phase);
          const unlocked = isPhaseUnlocked(idx);
          const complete = isPhaseComplete(phase);
          const isOpen = openPhases[phase.id];

          return (
            <div
              key={phase.id}
              id={`phase-${phase.id}`}
              className={`rounded-xl border overflow-hidden transition-all ${
                complete
                  ? "border-green-500/40 bg-green-500/5"
                  : unlocked
                  ? `${phase.borderColor} ${phase.bgColor}`
                  : "border-border/30 bg-muted/5 opacity-60"
              }`}
            >
              {/* Phase header */}
              <button
                onClick={() => togglePhase(phase.id)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-white/5 transition-colors"
                disabled={!unlocked}
              >
                {/* Phase badge */}
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${phase.color} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
                  {complete ? "✓" : phase.id.replace("P", "")}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{phase.title}</span>
                    {!unlocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                    {complete && <span className="text-xs text-green-400 font-semibold">Complete!</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <Progress value={pct} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground shrink-0">{done}/{total}</span>
                  </div>
                </div>

                {isOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
              </button>

              {/* Points */}
              {isOpen && unlocked && (
                <div className="px-5 pb-4 space-y-2">
                  {phase.points.map((point, i) => (
                    <button
                      key={point.id}
                      onClick={() => toggle(point.id)}
                      className="w-full flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-white/5 transition-colors text-left group"
                    >
                      <div className="mt-0.5 shrink-0">
                        {checked[point.id]
                          ? <CheckCircle2 className={`h-5 w-5 ${complete ? "text-green-400" : phase.lightColor}`} />
                          : <Circle className="h-5 w-5 text-muted-foreground group-hover:text-foreground/60 transition-colors" />
                        }
                      </div>
                      <span className={`text-sm leading-relaxed ${
                        checked[point.id]
                          ? "line-through text-muted-foreground"
                          : "text-foreground"
                      }`}>
                        <span className="text-muted-foreground text-xs font-mono mr-2">{i + 1}.</span>
                        {point.text}
                      </span>
                    </button>
                  ))}

                  {/* Phase complete message */}
                  {complete && (
                    <div className={`mt-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold flex items-center gap-2`}>
                      <Trophy className="h-4 w-4" />
                      Phase {phase.id} complete! Next phase unlock ho gaya 🎉
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
