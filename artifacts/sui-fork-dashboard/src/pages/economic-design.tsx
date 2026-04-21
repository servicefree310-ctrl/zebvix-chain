import React, { useState, useMemo } from "react";

const STORAGE_KEY = "zebvix-economic-design";

interface EconomicParams {
  maxSupply: number;
  genesisSupply: number;
  firstHalving: number;
  secondHalving: number;
  blockRewardGenesis: number;
  blockTimeMs: number;
  minValidatorStake: number;
  validatorStakingApr: number;
  validatorMaxRewardEpoch: number;
  nodeRunnerDailyReward: number;
  nodeRunnerPoolCap: number;
  delegatorBaseRate: number;
  gasValidatorPct: number;
  gasTreasuryPct: number;
  gasBurnPct: number;
  maxBurnPct: number;
  minGasPrice: number;
  epochDurationHrs: number;
}

const DEFAULTS: EconomicParams = {
  maxSupply: 150_000_000,
  genesisSupply: 2_000_000,
  firstHalving: 50_000_000,
  secondHalving: 100_000_000,
  blockRewardGenesis: 0.1,
  blockTimeMs: 400,
  minValidatorStake: 10_000,
  validatorStakingApr: 120,
  validatorMaxRewardEpoch: 1_000,
  nodeRunnerDailyReward: 5,
  nodeRunnerPoolCap: 4_000,
  delegatorBaseRate: 8,
  gasValidatorPct: 72,
  gasTreasuryPct: 18,
  gasBurnPct: 10,
  maxBurnPct: 50,
  minGasPrice: 1000,
  epochDurationHrs: 24,
};

function loadParams(): EconomicParams {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

function NumInput({ label, value, onChange, min, max, step, unit, note }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string; note?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
      />
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={`rounded-lg border ${color ?? "border-border"} bg-muted/10 p-4`}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-bold text-foreground font-mono">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function EconomicDesign() {
  const [p, setP] = useState<EconomicParams>(loadParams);

  const update = (key: keyof EconomicParams, val: number) => {
    setP(prev => {
      const next = { ...prev, [key]: val };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const resetAll = () => {
    setP(DEFAULTS);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Computed values
  const computed = useMemo(() => {
    const blocksPerDay = (86400 * 1000) / p.blockTimeMs;
    const blocksPerEpoch = (p.epochDurationHrs * 3600 * 1000) / p.blockTimeMs;
    const halvingAmt = p.blockRewardGenesis / 2;
    const halvingAmt2 = halvingAmt / 2;

    const phase1Supply = p.firstHalving - p.genesisSupply;
    const phase2Supply = p.secondHalving - p.firstHalving;
    const phase3Supply = p.maxSupply - p.secondHalving;

    const phase1Blocks = phase1Supply / p.blockRewardGenesis;
    const phase2Blocks = phase2Supply / halvingAmt;
    const phase3Blocks = phase3Supply / halvingAmt2;

    const phase1Days = (phase1Blocks * p.blockTimeMs) / (86400 * 1000);
    const phase2Days = (phase2Blocks * p.blockTimeMs) / (86400 * 1000);
    const phase3Days = (phase3Blocks * p.blockTimeMs) / (86400 * 1000);

    const totalDays = phase1Days + phase2Days + phase3Days;
    const totalYears = totalDays / 365;

    const gasBurnCheck = p.gasValidatorPct + p.gasTreasuryPct + p.gasBurnPct;
    const maxBurnZBX = Math.floor(p.maxSupply * (p.maxBurnPct / 100));
    const afterBurnValidatorPct = p.gasValidatorPct + p.gasBurnPct; // burn redistributed to validators after cap

    return {
      blocksPerDay: Math.round(blocksPerDay).toLocaleString(),
      blocksPerEpoch: Math.round(blocksPerEpoch).toLocaleString(),
      halvingAmt: halvingAmt.toFixed(4),
      halvingAmt2: halvingAmt2.toFixed(4),
      phase1Days: Math.round(phase1Days).toLocaleString(),
      phase2Days: Math.round(phase2Days).toLocaleString(),
      phase3Days: Math.round(phase3Days).toLocaleString(),
      totalDays: Math.round(totalDays).toLocaleString(),
      totalYears: totalYears.toFixed(1),
      gasBurnCheck,
      isValidFee: gasBurnCheck === 100,
      maxBurnZBX,
      afterBurnValidatorPct,
    };
  }, [p]);

  const phases = [
    {
      name: "Genesis Phase",
      range: `${(p.genesisSupply / 1e6).toFixed(0)}M – ${(p.firstHalving / 1e6).toFixed(0)}M ZBX`,
      blockReward: `${p.blockRewardGenesis} ZBX`,
      halvingReward: `${p.blockRewardGenesis} ZBX/block`,
      validatorMax: `${p.validatorMaxRewardEpoch.toLocaleString()} ZBX/epoch`,
      nodeRunner: `${p.nodeRunnerDailyReward} ZBX/day`,
      delegator: `${p.delegatorBaseRate}% APR`,
      duration: `~${computed.phase1Days} days`,
      color: "border-green-500/30 bg-green-500/5",
      badge: "bg-green-500",
    },
    {
      name: "After 1st Halving",
      range: `${(p.firstHalving / 1e6).toFixed(0)}M – ${(p.secondHalving / 1e6).toFixed(0)}M ZBX`,
      blockReward: `${computed.halvingAmt} ZBX`,
      halvingReward: `${computed.halvingAmt} ZBX/block`,
      validatorMax: `${(p.validatorMaxRewardEpoch / 2).toLocaleString()} ZBX/epoch`,
      nodeRunner: `${p.nodeRunnerDailyReward / 2} ZBX/day`,
      delegator: `${p.delegatorBaseRate / 2}% APR`,
      duration: `~${computed.phase2Days} days`,
      color: "border-yellow-500/30 bg-yellow-500/5",
      badge: "bg-yellow-500",
    },
    {
      name: "After 2nd Halving",
      range: `${(p.secondHalving / 1e6).toFixed(0)}M – ${(p.maxSupply / 1e6).toFixed(0)}M ZBX`,
      blockReward: `${computed.halvingAmt2} ZBX`,
      halvingReward: `${computed.halvingAmt2} ZBX/block`,
      validatorMax: `${(p.validatorMaxRewardEpoch / 4).toLocaleString()} ZBX/epoch`,
      nodeRunner: `${p.nodeRunnerDailyReward / 4} ZBX/day`,
      delegator: `${p.delegatorBaseRate / 4}% APR`,
      duration: `~${computed.phase3Days} days`,
      color: "border-orange-500/30 bg-orange-500/5",
      badge: "bg-orange-500",
    },
    {
      name: "After Hard Cap",
      range: `${(p.maxSupply / 1e6).toFixed(0)}M+ ZBX`,
      blockReward: "0 ZBX",
      halvingReward: "Gas fees only",
      validatorMax: "Gas share only",
      nodeRunner: "Gas share only",
      delegator: "Gas share only",
      duration: "Forever",
      color: "border-red-500/30 bg-red-500/5",
      badge: "bg-red-500",
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Economic Design</h1>
          <p className="text-muted-foreground">ZBX tokenomics — parameters change karo, live results dekho</p>
        </div>
        <button
          onClick={resetAll}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded border border-border hover:border-destructive/50"
        >
          Reset Defaults
        </button>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Max Supply" value={`${(p.maxSupply / 1e6).toFixed(0)}M ZBX`} sub="Hard cap — kabhi exceed nahi" color="border-primary/30" />
        <StatCard label="Genesis Supply" value={`${(p.genesisSupply / 1e6).toFixed(1)}M ZBX`} sub="Chain start mein" color="border-green-500/30" />
        <StatCard label="Blocks / Day" value={computed.blocksPerDay} sub={`${p.blockTimeMs}ms block time`} color="border-blue-500/30" />
        <StatCard label="Full Emission" value={`~${computed.totalYears} years`} sub={`${computed.totalDays} days total`} color="border-yellow-500/30" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Parameters */}
        <div className="space-y-5">

          {/* Supply */}
          <div className="rounded-xl border border-border bg-muted/5 p-5 space-y-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">1</span>
              Supply Parameters
            </h3>
            <NumInput label="Max Total Supply (Hard Cap)" value={p.maxSupply} onChange={v => update("maxSupply", v)} min={10_000_000} step={1_000_000} unit="ZBX" note="Kabhi bhi exceed nahi hoga — permanent limit" />
            <NumInput label="Genesis Supply" value={p.genesisSupply} onChange={v => update("genesisSupply", v)} min={100_000} step={100_000} unit="ZBX" note="Chain start hone pe kitna ZBX mint hoga" />
            <NumInput label="1st Halving at" value={p.firstHalving} onChange={v => update("firstHalving", v)} min={p.genesisSupply} step={1_000_000} unit="ZBX minted" />
            <NumInput label="2nd Halving at" value={p.secondHalving} onChange={v => update("secondHalving", v)} min={p.firstHalving} step={1_000_000} unit="ZBX minted" />
          </div>

          {/* Block rewards */}
          <div className="rounded-xl border border-border bg-muted/5 p-5 space-y-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center justify-center font-bold">2</span>
              Block & Time Settings
            </h3>
            <NumInput label="Genesis Block Reward" value={p.blockRewardGenesis} onChange={v => update("blockRewardGenesis", v)} min={0.001} step={0.01} unit="ZBX/block" note="Halving ke baad automatically half hoga" />
            <NumInput label="Block Time" value={p.blockTimeMs} onChange={v => update("blockTimeMs", v)} min={100} max={10000} step={100} unit="milliseconds" note={`= ${(p.blockTimeMs / 1000).toFixed(1)}s per block, ${computed.blocksPerDay} blocks/day`} />
            <NumInput label="Epoch Duration" value={p.epochDurationHrs} onChange={v => update("epochDurationHrs", v)} min={1} max={168} unit="hours" note={`${computed.blocksPerEpoch} blocks per epoch`} />
          </div>

          {/* Rewards */}
          <div className="rounded-xl border border-border bg-muted/5 p-5 space-y-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 text-xs flex items-center justify-center font-bold">3</span>
              Validator & Node Rewards
            </h3>
            <NumInput label="Min Validator Stake" value={p.minValidatorStake} onChange={v => update("minValidatorStake", v)} min={100} step={1000} unit="ZBX" note="Koi bhi isse stake + node chalaye → validator ban jaye" />
            <NumInput label="Validator Staking APR" value={p.validatorStakingApr} onChange={v => update("validatorStakingApr", v)} min={1} max={500} step={5} unit="% APR" note={`${p.minValidatorStake.toLocaleString()} ZBX stake pe = ${Math.round(p.minValidatorStake * p.validatorStakingApr / 100).toLocaleString()} ZBX/year reward`} />
            <NumInput label="Node Runner Daily Reward" value={p.nodeRunnerDailyReward} onChange={v => update("nodeRunnerDailyReward", v)} min={0.1} step={0.5} unit="ZBX/day" note="Staking APR ke upar alag se — node run karne ka bonus" />
            <NumInput label="Node Runner Pool Cap" value={p.nodeRunnerPoolCap} onChange={v => update("nodeRunnerPoolCap", v)} min={100} step={100} unit="ZBX/day total" note="Sabhi node runners milake max yeh le sakte hain" />
            <NumInput label="Validator Max Reward / Epoch" value={p.validatorMaxRewardEpoch} onChange={v => update("validatorMaxRewardEpoch", v)} min={10} step={100} unit="ZBX" note="Genesis phase mein — halving ke baad half hoga" />
            <NumInput label="Delegator Base APR" value={p.delegatorBaseRate} onChange={v => update("delegatorBaseRate", v)} min={0.1} max={100} step={0.5} unit="% APR" note="Genesis phase mein — halving ke baad half hoga" />

            {/* Pre-validator & Founder Treasury rule */}
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 space-y-2 mt-1">
              <div className="text-xs font-semibold text-amber-400">Founder Treasury Rules:</div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex gap-2"><span className="text-amber-400">•</span><span><strong className="text-foreground">Pre-validator period:</strong> Jab tak koi validator active nahi — saari staking rewards founder treasury mein jaati hain</span></div>
                <div className="flex gap-2"><span className="text-amber-400">•</span><span><strong className="text-foreground">Validator active hone ke baad:</strong> 120% APR validator ko, remaining surplus → founder treasury</span></div>
                <div className="flex gap-2"><span className="text-amber-400">•</span><span><strong className="text-foreground">Founder Admin Cap:</strong> Core chain change nahi kar sakta — sirf naye features add kar sakta hai (MultiSig 4/6)</span></div>
                <div className="flex gap-2"><span className="text-green-400">→</span><span>Founder wallet = Admin MultiSig, akele kuch nahi badal sakta — supermajority required</span></div>
              </div>
            </div>
          </div>

          {/* Gas fee split */}
          <div className="rounded-xl border border-border bg-muted/5 p-5 space-y-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 text-xs flex items-center justify-center font-bold">4</span>
              Gas Fee Distribution
              <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded ${computed.isValidFee ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"}`}>
                Total: {computed.gasBurnCheck}% {computed.isValidFee ? "✓" : "≠ 100%"}
              </span>
            </h3>
            <NumInput label="Validators Share" value={p.gasValidatorPct} onChange={v => update("gasValidatorPct", v)} min={0} max={100} unit="%" note="Saare active validators mein split hoga" />
            <NumInput label="Treasury Share" value={p.gasTreasuryPct} onChange={v => update("gasTreasuryPct", v)} min={0} max={100} unit="%" note="Zebvix Technologies founder treasury" />
            <NumInput label="Burn Share 🔥" value={p.gasBurnPct} onChange={v => update("gasBurnPct", v)} min={0} max={100} unit="%" note="Automatically deducted from every transaction gas fee" />
            <NumInput label="Min Gas Price" value={p.minGasPrice} onChange={v => update("minGasPrice", v)} min={100} step={100} unit="MIST" note={`= ${(p.minGasPrice / 1e9).toFixed(6)} ZBX minimum per transaction`} />

            {/* Burn Cap Section */}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-orange-400">🔥 Max Burn Cap</span>
                <span className="text-xs text-muted-foreground">— burn isse zyada kabhi nahi hoga</span>
              </div>
              <NumInput
                label="Max Burn (% of total supply)"
                value={p.maxBurnPct}
                onChange={v => update("maxBurnPct", Math.min(v, 100))}
                min={1} max={100} step={5} unit="%"
                note={`= ${(computed.maxBurnZBX / 1e6).toFixed(1)}M ZBX maximum burn — phir burn permanently band`}
              />
              <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3 space-y-2">
                <div className="text-xs font-semibold text-orange-400">Burn Cap Rules:</div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex gap-2"><span className="text-orange-400">•</span><span>Har transaction mein gas fee ka <strong className="text-foreground">{p.gasBurnPct}%</strong> automatically burn hoga</span></div>
                  <div className="flex gap-2"><span className="text-orange-400">•</span><span>Koi bhi user burn trigger kar sakta hai — sirf fee se hoga, manually nahi</span></div>
                  <div className="flex gap-2"><span className="text-orange-400">•</span><span>Jab total burned = <strong className="text-foreground">{(computed.maxBurnZBX / 1e6).toFixed(1)}M ZBX</strong> ho jaye → burn permanently stop</span></div>
                  <div className="flex gap-2"><span className="text-green-400">→</span><span>After cap: burn share validators ko milega (<strong className="text-foreground">{computed.afterBurnValidatorPct}% total</strong>)</span></div>
                </div>
              </div>
            </div>

            {!computed.isValidFee && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">
                ⚠️ Fee split {computed.gasBurnCheck}% hai — exactly 100% hona chahiye!
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Results */}
        <div className="space-y-5">

          {/* Halving schedule table */}
          <div className="rounded-xl border border-border bg-muted/5 p-5">
            <h3 className="font-bold text-foreground mb-4">Halving Schedule</h3>
            <div className="space-y-3">
              {phases.map((phase, i) => (
                <div key={i} className={`rounded-lg border p-4 ${phase.color}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${phase.badge}`} />
                    <span className="font-semibold text-sm text-foreground">{phase.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{phase.duration}</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mb-2">{phase.range}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="text-muted-foreground">Block Reward:</div>
                    <div className="text-foreground font-mono font-semibold">{phase.blockReward}</div>
                    <div className="text-muted-foreground">Validator Max:</div>
                    <div className="text-foreground font-mono">{phase.validatorMax}</div>
                    <div className="text-muted-foreground">Node Runner:</div>
                    <div className="text-foreground font-mono">{phase.nodeRunner}</div>
                    <div className="text-muted-foreground">Delegator APR:</div>
                    <div className="text-foreground font-mono">{phase.delegator}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fee split visual */}
          <div className="rounded-xl border border-border bg-muted/5 p-5">
            <h3 className="font-bold text-foreground mb-4">Gas Fee Split Visual</h3>
            <div className="space-y-3">
              {[
                { label: "Validators", pct: p.gasValidatorPct, color: "bg-primary", textColor: "text-primary" },
                { label: "Treasury", pct: p.gasTreasuryPct, color: "bg-blue-500", textColor: "text-blue-400" },
                { label: "Burn 🔥", pct: p.gasBurnPct, color: "bg-orange-500", textColor: "text-orange-400" },
              ].map(item => (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className={item.textColor}>{item.label}</span>
                    <span className="font-mono font-bold text-foreground">{item.pct}%</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${item.color}`}
                      style={{ width: `${Math.min(item.pct, 100)}%` }}
                    />
                  </div>
                </div>
              ))}

              {/* Stacked bar */}
              <div className="mt-4">
                <div className="text-xs text-muted-foreground mb-1">Combined view</div>
                <div className="h-5 rounded-full overflow-hidden flex">
                  <div className="bg-primary transition-all" style={{ width: `${p.gasValidatorPct}%` }} />
                  <div className="bg-blue-500 transition-all" style={{ width: `${p.gasTreasuryPct}%` }} />
                  <div className="bg-orange-500 transition-all" style={{ width: `${p.gasBurnPct}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Validators {p.gasValidatorPct}%</span>
                  <span>Treasury {p.gasTreasuryPct}%</span>
                  <span>Burn {p.gasBurnPct}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Emission timeline */}
          <div className="rounded-xl border border-border bg-muted/5 p-5">
            <h3 className="font-bold text-foreground mb-4">Emission Timeline</h3>
            <div className="space-y-2">
              {[
                { label: "Genesis Supply", zbx: p.genesisSupply, pct: (p.genesisSupply / p.maxSupply) * 100 },
                { label: "Phase 1 (Genesis → 1st Halving)", zbx: p.firstHalving - p.genesisSupply, pct: ((p.firstHalving - p.genesisSupply) / p.maxSupply) * 100 },
                { label: "Phase 2 (1st → 2nd Halving)", zbx: p.secondHalving - p.firstHalving, pct: ((p.secondHalving - p.firstHalving) / p.maxSupply) * 100 },
                { label: "Phase 3 (2nd → Hard Cap)", zbx: p.maxSupply - p.secondHalving, pct: ((p.maxSupply - p.secondHalving) / p.maxSupply) * 100 },
              ].map((item, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground truncate">{item.label}</span>
                    <span className="font-mono text-foreground shrink-0 ml-2">{(item.zbx / 1e6).toFixed(1)}M</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${["bg-green-500", "bg-primary", "bg-yellow-500", "bg-orange-500"][i]}`}
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t border-border flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">Total</span>
                <span className="text-foreground font-mono">{(p.maxSupply / 1e6).toFixed(0)}M ZBX</span>
              </div>
            </div>
          </div>

          {/* Rust code snippet */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
            <h3 className="font-bold text-foreground mb-3 text-sm">Rust Constants (gas_coin.rs)</h3>
            <pre className="text-xs text-primary/90 font-mono overflow-x-auto leading-relaxed">
{`// ── Supply ───────────────────────────────────────────
pub const MAX_TOTAL_SUPPLY_ZBX: u64 = ${p.maxSupply.toLocaleString()};
pub const GENESIS_SUPPLY_ZBX: u64   = ${p.genesisSupply.toLocaleString()};
pub const FIRST_HALVING_ZBX: u64    = ${p.firstHalving.toLocaleString()};
pub const SECOND_HALVING_ZBX: u64   = ${p.secondHalving.toLocaleString()};

// ── Block Reward ─────────────────────────────────────
pub const INITIAL_BLOCK_REWARD_MIST: u64 
    = ${(p.blockRewardGenesis * 1e9).toFixed(0)}; // ${p.blockRewardGenesis} ZBX

// ── Gas Fee Split (basis points, 100 bps = 1%) ───────
pub const GAS_VALIDATOR_BPS: u64    = ${p.gasValidatorPct * 100};
pub const GAS_TREASURY_BPS: u64     = ${p.gasTreasuryPct * 100};
pub const GAS_BURN_BPS: u64         = ${p.gasBurnPct * 100};

// ── Burn Cap ─────────────────────────────────────────
/// Maximum ZBX that can EVER be burned (${p.maxBurnPct}% of max supply).
/// Once total_burned >= MAX_BURN_SUPPLY_MIST, all future burn
/// share is redirected to validators instead.
pub const MAX_BURN_SUPPLY_MIST: u64 
    = ${(computed.maxBurnZBX * 1e9).toFixed(0)}; // ${(computed.maxBurnZBX / 1e6).toFixed(1)}M ZBX

/// Call before every gas-burn to check if burn is still allowed.
pub fn is_burn_allowed(total_burned_mist: u64) -> bool {
    total_burned_mist < MAX_BURN_SUPPLY_MIST
}

// ── Staking ──────────────────────────────────────────
pub const MIN_VALIDATOR_STAKE_MIST: u64 
    = ${(p.minValidatorStake * 1e9).toFixed(0)};`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
