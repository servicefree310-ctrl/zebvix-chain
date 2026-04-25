import React, { useEffect, useState } from "react";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import {
  Coins,
  Building2,
  Droplets,
  Pickaxe,
  Flame,
  Receipt,
  Clock,
  TrendingDown,
  Layers,
  Lock,
} from "lucide-react";

interface SupplyInfo {
  height: number;
  minted_wei: string;
  max_wei: string;
  current_block_reward_wei?: string;
  burned_wei?: string;
  premine_wei?: string;
  pool_seed_wei?: string;
  pool_reserve_wei?: string;
  circulating_wei?: string;
}

const FOUNDER_ADDR = "0x40907000ac0a1a73e4cd89889b4d7ee8980c0315";
const POOL_ADDR = "0x7a73776170000000000000000000000000000000";
const REWARDS_POOL_ADDR = "0x7277647300000000000000000000000000000000";
const BURN_ADDR = "0x6275726e0000000000000000000000000000dead";

const HALVING_INTERVAL = 25_000_000;
const BLOCK_TIME_SECS = 5;
const REWARDS_DISTRIBUTION_INTERVAL = 100;
const REWARDS_COMMISSION_BPS = 1000;
const BURN_CAP_ZBX = 75_000_000;

function pct(num: bigint, denom: bigint): string {
  if (denom === 0n) return "0";
  const bp = Number((num * 10000n) / denom);
  return (bp / 100).toFixed(2);
}

function safeBig(s: string | undefined | null): bigint {
  if (!s) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  if (s < 31536000) return `${(s / 86400).toFixed(1)} days`;
  return `${(s / 31536000).toFixed(2)} years`;
}

function HeroStat({
  icon: Icon,
  label,
  value,
  unit,
  subtext,
  iconColor = "text-cyan-400",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit?: string;
  subtext?: string;
  iconColor?: string;
}) {
  return (
    <div className="p-5 border border-border rounded-lg bg-card/80 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground font-mono">
          {value}
        </span>
        {unit && (
          <span className="text-sm text-muted-foreground font-mono">{unit}</span>
        )}
      </div>
      {subtext && (
        <span className="text-xs text-muted-foreground">{subtext}</span>
      )}
    </div>
  );
}

function BreakdownBar({ supply }: { supply: SupplyInfo }) {
  const max = safeBig(supply.max_wei);
  const premine = safeBig(supply.premine_wei);
  const poolSeed = safeBig(supply.pool_seed_wei);
  const minted = safeBig(supply.minted_wei);
  const burned = safeBig(supply.burned_wei);
  const allocated = premine + poolSeed + minted + burned;
  const remaining = max > allocated ? max - allocated : 0n;

  const pPremine = pct(premine, max);
  const pPool = pct(poolSeed, max);
  const pMinted = pct(minted, max);
  const pBurned = pct(burned, max);
  const pRemaining = pct(remaining, max);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Distribution against max supply (150M ZBX)</span>
        <span className="font-mono">height #{supply.height}</span>
      </div>
      <div className="h-8 w-full rounded-md overflow-hidden flex border border-border">
        <div
          className="bg-violet-500/70 hover:bg-violet-500 transition-colors"
          style={{ width: `${pPremine}%` }}
          title={`Foundation: ${pPremine}%`}
        />
        <div
          className="bg-cyan-500/70 hover:bg-cyan-500 transition-colors"
          style={{ width: `${pPool}%` }}
          title={`Pool seed: ${pPool}%`}
        />
        <div
          className="bg-emerald-500/70 hover:bg-emerald-500 transition-colors"
          style={{ width: `${pMinted}%` }}
          title={`Mined: ${pMinted}%`}
        />
        <div
          className="bg-red-500/70 hover:bg-red-500 transition-colors"
          style={{ width: `${pBurned}%` }}
          title={`Burned: ${pBurned}%`}
        />
        <div
          className="bg-zinc-700/40"
          style={{ width: `${pRemaining}%` }}
          title={`Remaining to mine: ${pRemaining}%`}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-violet-500/70" />
          <span className="text-muted-foreground">Foundation</span>
          <span className="font-mono text-violet-300 ml-auto">{pPremine}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-cyan-500/70" />
          <span className="text-muted-foreground">Pool seed</span>
          <span className="font-mono text-cyan-300 ml-auto">{pPool}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-emerald-500/70" />
          <span className="text-muted-foreground">Mined</span>
          <span className="font-mono text-emerald-300 ml-auto">{pMinted}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-red-500/70" />
          <span className="text-muted-foreground">Burned</span>
          <span className="font-mono text-red-300 ml-auto">{pBurned}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-zinc-700/40" />
          <span className="text-muted-foreground">To mine</span>
          <span className="font-mono text-zinc-400 ml-auto">{pRemaining}%</span>
        </div>
      </div>
    </div>
  );
}

function AllocationCard({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  amount,
  pct,
  address,
  details,
  badges,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  title: string;
  subtitle: string;
  amount: string;
  pct: string;
  address?: string;
  details: { label: string; value: string }[];
  badges?: string[];
}) {
  return (
    <div className="border border-border rounded-lg bg-card/80 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md bg-card border border-border`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-xl font-bold font-mono ${iconColor}`}>
            {amount}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {pct}% of supply
          </div>
        </div>
      </div>

      {address && (
        <div className="flex items-center justify-between text-xs bg-zinc-900/50 border border-border rounded px-3 py-2">
          <span className="text-muted-foreground">Address</span>
          <code className="font-mono text-foreground">
            {shortAddr(address, 8, 6)}
          </code>
        </div>
      )}

      <div className="space-y-1.5 text-xs">
        {details.map((d) => (
          <div key={d.label} className="flex justify-between">
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-mono text-foreground">{d.value}</span>
          </div>
        ))}
      </div>

      {badges && badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {badges.map((b) => (
            <span
              key={b}
              className="text-[10px] uppercase tracking-wider border border-border bg-card px-2 py-0.5 rounded text-muted-foreground"
            >
              {b}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Tokenomics() {
  const [supply, setSupply] = useState<SupplyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await rpc<SupplyInfo>("zbx_supply");
        if (!cancelled) {
          setSupply(s);
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load supply");
        }
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const halvingYears =
    (HALVING_INTERVAL * BLOCK_TIME_SECS) / (365.25 * 24 * 3600);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
          Zebvix (ZBX) Tokenomics
        </h1>
        <p className="text-muted-foreground">
          Live native-token economics. Supply, distribution, rewards, burn, and
          gas-fee mechanics — all data pulled directly from the running chain.
        </p>
      </div>

      {error && (
        <div className="p-4 border border-red-500/30 bg-red-500/10 rounded-lg text-sm text-red-300">
          ⚠ Supply RPC unreachable: {error}
        </div>
      )}

      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeroStat
          icon={Coins}
          label="Max Supply"
          value="150,000,000"
          unit="ZBX"
          subtext="Hard cap, never exceeded"
          iconColor="text-cyan-400"
        />
        <HeroStat
          icon={Layers}
          label="Decimals"
          value="18"
          subtext="1 ZBX = 10^18 wei (ZVM standard)"
          iconColor="text-violet-400"
        />
        <HeroStat
          icon={Clock}
          label="Block Time"
          value="5"
          unit="sec"
          subtext={`Reward dist every ${REWARDS_DISTRIBUTION_INTERVAL} blocks (~${fmtSeconds(REWARDS_DISTRIBUTION_INTERVAL * BLOCK_TIME_SECS)})`}
          iconColor="text-emerald-400"
        />
        <HeroStat
          icon={TrendingDown}
          label="Halving"
          value={`${(HALVING_INTERVAL / 1_000_000).toFixed(0)}M`}
          unit="blocks"
          subtext={`~${halvingYears.toFixed(2)} years per halving`}
          iconColor="text-amber-400"
        />
      </div>

      {/* Live supply breakdown */}
      <div className="border border-border rounded-lg bg-card/80 p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Coins className="w-5 h-5 text-cyan-400" />
            Live Supply Distribution
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Auto-refreshes every 10 seconds from{" "}
            <code className="text-cyan-300">zbx_supply</code>
          </p>
        </div>

        {supply ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-zinc-900/50 rounded p-3 border border-border">
                <div className="text-xs text-muted-foreground">Circulating</div>
                <div className="text-xl font-bold text-emerald-300 font-mono">
                  {weiHexToZbx(supply.circulating_wei || "0")}
                </div>
                <div className="text-[10px] text-muted-foreground">ZBX in existence</div>
              </div>
              <div className="bg-zinc-900/50 rounded p-3 border border-border">
                <div className="text-xs text-muted-foreground">Foundation Pre-mine</div>
                <div className="text-xl font-bold text-violet-300 font-mono">
                  {weiHexToZbx(supply.premine_wei || "0")}
                </div>
                <div className="text-[10px] text-muted-foreground">Genesis allocation</div>
              </div>
              <div className="bg-zinc-900/50 rounded p-3 border border-border">
                <div className="text-xs text-muted-foreground">AMM Pool Seed</div>
                <div className="text-xl font-bold text-cyan-300 font-mono">
                  {weiHexToZbx(supply.pool_seed_wei || "0")}
                </div>
                <div className="text-[10px] text-muted-foreground">Initial liquidity</div>
              </div>
              <div className="bg-zinc-900/50 rounded p-3 border border-border">
                <div className="text-xs text-muted-foreground">Mined (rewards)</div>
                <div className="text-xl font-bold text-amber-300 font-mono">
                  {weiHexToZbx(supply.minted_wei || "0")}
                </div>
                <div className="text-[10px] text-muted-foreground">From block rewards</div>
              </div>
              <div className="bg-zinc-900/50 rounded p-3 border border-border">
                <div className="text-xs text-muted-foreground">Burned</div>
                <div className="text-xl font-bold text-red-300 font-mono">
                  {weiHexToZbx(supply.burned_wei || "0")}
                </div>
                <div className="text-[10px] text-muted-foreground">Permanently destroyed</div>
              </div>
              <div className="bg-zinc-900/50 rounded p-3 border border-border">
                <div className="text-xs text-muted-foreground">Yet to mine</div>
                <div className="text-xl font-bold text-zinc-300 font-mono">
                  {weiHexToZbx(
                    (() => {
                      const max = safeBig(supply.max_wei);
                      const allocated =
                        safeBig(supply.premine_wei) +
                        safeBig(supply.pool_seed_wei) +
                        safeBig(supply.minted_wei) +
                        safeBig(supply.burned_wei);
                      return (max > allocated
                        ? max - allocated
                        : 0n
                      ).toString();
                    })(),
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">Future block rewards</div>
              </div>
            </div>

            <BreakdownBar supply={supply} />
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Loading live supply…</div>
        )}
      </div>

      {/* Allocation cards */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Genesis Allocations</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <AllocationCard
            icon={Building2}
            iconColor="text-violet-300"
            title="Foundation Treasury"
            subtitle="Development & operations reserve"
            amount="9,990,000 ZBX"
            pct="6.66"
            address={FOUNDER_ADDR}
            details={[
              { label: "Use case", value: "Dev, ops, marketing, grants" },
              { label: "Vesting", value: "Liquid (no lock)" },
              { label: "Industry context", value: "ETH ~10%, SOL ~25%, SUI ~30%" },
              { label: "Status", value: "On-chain, fully disclosed" },
            ]}
            badges={["Genesis", "Liquid", "Foundation"]}
          />

          <AllocationCard
            icon={Droplets}
            iconColor="text-cyan-300"
            title="AMM Pool Seed"
            subtitle="Initial DEX liquidity (zSwap)"
            amount="20,000,000 ZBX"
            pct="13.33"
            address={POOL_ADDR}
            details={[
              { label: "Paired with", value: "10,000,000 zUSD" },
              { label: "Initial spot", value: "$0.50 / ZBX" },
              { label: "Pool TVL", value: "$20.00M (combined)" },
              { label: "Fee", value: "0.30% per swap" },
            ]}
            badges={["Locked in pool", "Permissionless swaps"]}
          />
        </div>
      </div>

      {/* Block reward mechanics */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          Block Reward Mechanics (120.01M ZBX over time)
        </h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-border rounded-lg bg-card/80 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Pickaxe className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-semibold">Mint Schedule</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Initial reward</span>
                <span className="font-mono text-foreground">3 ZBX/block</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Halving interval</span>
                <span className="font-mono text-foreground">25M blocks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Halving period</span>
                <span className="font-mono text-foreground">
                  ~{halvingYears.toFixed(2)} years
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mineable budget</span>
                <span className="font-mono text-foreground text-xs">
                  150M − 30M genesis = 120.01M
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Bitcoin-style geometric halving with a hard cap. Genesis allocates
              9.99M (Foundation) + 20M (pool seed); the remaining 120.01M is
              emitted via block rewards until the 150M cap is reached.
            </p>
          </div>

          <div className="border border-border rounded-lg bg-card/80 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-semibold">Reward Distribution</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Every block mints 3 ZBX into the rewards pool. Every{" "}
              <span className="text-foreground font-mono">
                {REWARDS_DISTRIBUTION_INTERVAL}
              </span>{" "}
              blocks (~{fmtSeconds(REWARDS_DISTRIBUTION_INTERVAL * BLOCK_TIME_SECS)})
              the pool drains and splits stake-proportionally.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Operator commission</span>
                <span className="font-mono text-emerald-300">
                  {(REWARDS_COMMISSION_BPS / 100).toFixed(0)}% (liquid)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bonded share</span>
                <span className="font-mono text-foreground">
                  {(100 - REWARDS_COMMISSION_BPS / 100).toFixed(0)}% (locked)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Daily unlock drip</span>
                <span className="font-mono text-foreground">0.50% / day</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bulk release</span>
                <span className="font-mono text-foreground">
                  25% / 5M blocks
                </span>
              </div>
            </div>
            <div className="text-xs bg-zinc-900/50 rounded px-2 py-1.5 border border-border">
              <span className="text-muted-foreground">Holding address: </span>
              <code className="text-amber-300 font-mono">
                {shortAddr(REWARDS_POOL_ADDR, 6, 4)}
              </code>
              <span className="text-muted-foreground"> (rwds magic addr)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Gas fee + burn mechanics */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          Gas Fee Distribution & Burn
        </h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-border rounded-lg bg-card/80 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-cyan-400" />
              <h3 className="text-base font-semibold">Per-tx Fee Split (50/20/20/10)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Aggregated per block, then redistributed to participants.
            </p>
            <div className="space-y-2">
              {[
                { label: "Block proposer (validator)", value: "50%", color: "text-emerald-300" },
                { label: "Its delegators (stake-prop)", value: "20%", color: "text-cyan-300" },
                { label: "Foundation treasury", value: "20%", color: "text-violet-300" },
                { label: "Burn (or AMM at cap)", value: "10%", color: "text-red-300" },
              ].map((row) => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={`font-mono ${row.color}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card/80 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-red-400" />
              <h3 className="text-base font-semibold">Burn Mechanism</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auto burn cap</span>
                <span className="font-mono text-red-300">
                  {BURN_CAP_ZBX.toLocaleString()} ZBX (50%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Burned to date</span>
                <span className="font-mono text-foreground">
                  {supply ? weiHexToZbx(supply.burned_wei || "0") : "—"} ZBX
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">After cap reached</span>
                <span className="font-mono text-cyan-300">→ AMM pool ZBX reserve</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Manual burn</span>
                <span className="font-mono text-foreground">Anyone (uncapped)</span>
              </div>
            </div>
            <div className="text-xs bg-zinc-900/50 rounded px-2 py-1.5 border border-border">
              <span className="text-muted-foreground">Burn address: </span>
              <code className="text-red-300 font-mono">
                {shortAddr(BURN_ADDR, 6, 4)}
              </code>
              <span className="text-muted-foreground"> ("burn"…"dead")</span>
            </div>
          </div>
        </div>
      </div>

      {/* Phase A vs B */}
      <div className="border border-border rounded-lg bg-card/80 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-amber-400" />
          <h2 className="text-base font-semibold">Bootstrap Phases (treasury cut)</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Until the network has ≥500 active validators AND ≥1000 unique
          delegators, the chain runs in Phase A with a higher treasury share.
          Both thresholds together flip the chain to Phase B automatically.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-zinc-900/50 border border-border rounded p-4">
            <div className="text-xs uppercase tracking-wider text-amber-300 mb-1">
              Phase A — Bootstrap
            </div>
            <div className="text-2xl font-bold font-mono text-foreground">50%</div>
            <div className="text-xs text-muted-foreground mt-1">
              of epoch staking reward → Foundation treasury (liquid)
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-border rounded p-4">
            <div className="text-xs uppercase tracking-wider text-emerald-300 mb-1">
              Phase B — Mature
            </div>
            <div className="text-2xl font-bold font-mono text-foreground">10%</div>
            <div className="text-xs text-muted-foreground mt-1">
              of epoch staking reward → Foundation treasury (forever)
            </div>
          </div>
        </div>
      </div>

      {/* Source code reference */}
      <div className="bg-muted/30 border border-border p-5 rounded-lg space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Coins className="w-4 h-4 text-cyan-400" />
          Customizing tokenomics
        </h3>
        <p className="text-xs text-muted-foreground">
          All economic constants live in a single Rust file. Edit, rebuild, and
          deploy via the standard upgrade path:
        </p>
        <div className="bg-background border border-border rounded p-3 font-mono text-xs text-cyan-300">
          zebvix-chain/src/tokenomics.rs
        </div>
        <p className="text-[11px] text-muted-foreground">
          Changes to <code>FOUNDER_PREMINE_ZBX</code>,{" "}
          <code>HALVING_INTERVAL</code>, <code>BURN_CAP_WEI</code>, or any
          <code> GAS_FEE_*_BPS</code> constant take effect after rebuild and
          node restart. The supply RPC reflects values immediately.
        </p>
      </div>
    </div>
  );
}
