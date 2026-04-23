import React from "react";
import {
  Activity, Box, ListOrdered, Server, Hash, Clock, DollarSign, Flame, Coins,
  Hourglass, TrendingDown, Pickaxe, ShieldCheck, ArrowUpRight, ExternalLink,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart,
} from "recharts";

const ZBX_PRICE = 1.0;
const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000 ? `$${(n / 1_000).toFixed(2)}K` :
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtZbx = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000 ? `${(n / 1_000).toFixed(2)}K` :
  n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const fmtNum = (n: number) => n.toLocaleString();
const trunc = (s: string, head = 6, tail = 4) =>
  s.length <= head + tail + 2 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
const ago = (ts: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

const tpsHistory = Array.from({ length: 60 }, (_, i) => ({
  timestamp: Date.now() - (60 - i) * 2000,
  tps: 8 + Math.sin(i / 4) * 3 + Math.random() * 4,
}));

const blocks = Array.from({ length: 6 }, (_, i) => ({
  index: 9_403_877 - i,
  txCount: Math.floor(6 + Math.random() * 14),
  reward: 3,
  proposer: "0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc",
  ts: Date.now() - i * 5800,
}));

const txs = [
  { hash: "0x9f12a3b7e4c5d8e2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5", from: "0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc", to: "0xdc28ce35bab2369e5b85c779baf49d05dfb4e8d7", amount: 1250.5, status: "success", ts: Date.now() - 12_000 },
  { hash: "0x7a3b4c5d6e7f8091a2b3c4d5e6f70819a2b3c4d5e6f78091a2b3c4d5e6f70819", from: "0xdc28ce35bab2369e5b85c779baf49d05dfb4e8d7", to: "0xab12cd34ef56789012345678901234567890abcd", amount: 482.0, status: "success", ts: Date.now() - 28_000 },
  { hash: "0x5f6e7d8c9b0a1928374655443322110099887766554433221100ffeeddccbbaa", from: "0x123456789abcdef0123456789abcdef012345678", to: "0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc", amount: 75.25, status: "pending", ts: Date.now() - 45_000 },
  { hash: "0x1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f7081", from: "0xab12cd34ef56789012345678901234567890abcd", to: "0xfedcba9876543210fedcba9876543210fedcba98", amount: 9999.99, status: "success", ts: Date.now() - 78_000 },
  { hash: "0xc0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1", from: "0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc", to: "0x9876543210abcdef9876543210abcdef98765432", amount: 12.0, status: "success", ts: Date.now() - 145_000 },
  { hash: "0xdeadbeefcafebabe1234567890abcdef1234567890abcdef1234567890abcdef", from: "0xfedcba9876543210fedcba9876543210fedcba98", to: "0xdc28ce35bab2369e5b85c779baf49d05dfb4e8d7", amount: 5000, status: "failed", ts: Date.now() - 230_000 },
];

const tokens = [
  { name: "Zeb Doge", symbol: "ZDOGE", addr: "0x1a2b3c4d5e6f7081", rank: 1, price: 0.0234, mcap: 2_340_000, liq: 145_000, vol: 89_500, swaps: 1_247, holders: 312, live: true, hue: "from-amber-500 to-orange-600" },
  { name: "Pepe Zebra", symbol: "ZPEPE", addr: "0x9f8e7d6c5b4a3928", rank: 2, price: 0.000891, mcap: 891_000, liq: 67_200, vol: 42_100, swaps: 689, holders: 178, live: true, hue: "from-emerald-500 to-teal-600" },
  { name: "Founder Coin", symbol: "FNDR", addr: "0xabcdef0123456789", rank: 3, price: 0.452, mcap: 452_000, liq: 38_500, vol: 21_300, swaps: 412, holders: 95, live: true, hue: "from-indigo-500 to-purple-600" },
  { name: "Rocket Token", symbol: "ROCK", addr: "0x5544332211009988", rank: 4, price: 0.0089, mcap: 89_000, liq: 12_100, vol: 8_400, swaps: 156, holders: 42, live: true, hue: "from-rose-500 to-pink-600" },
  { name: "Gas Refund", symbol: "GAS", addr: "0x7766554433221100", rank: 5, price: 1.024, mcap: 1_024_000, liq: 8_900, vol: 3_200, swaps: 78, holders: 31, live: true, hue: "from-cyan-500 to-blue-600" },
  { name: "TestNet", symbol: "TEST", addr: "0x1100ffeeddccbbaa", rank: 6, price: 0, mcap: 0, liq: 0, vol: 0, swaps: 0, holders: 1, live: false, hue: "from-zinc-500 to-zinc-700" },
];

export function Dashboard() {
  const stats = {
    currentTps: 12.4,
    peakTps: 47,
    blockHeight: 9_403_877,
    totalTransactions: 18_472_991,
    activeValidators: 7,
    avgBlockTime: 5.62,
    mempoolSize: 24,
    circulatingSupply: 28_098_000,
    maxSupply: 150_000_000,
    supplyPercentMined: 18.732,
    remainingSupply: 121_902_000,
    totalBurned: 142_337,
    maxBurnSupply: 75_000_000,
    burnPercentOfMax: 0.1898,
    burnCapReached: false,
    feePolicy: "10% burned, 90% to validator",
    blockReward: 3,
    halvingEra: 0,
    nextHalvingAt: 50_000_000,
    nextHalvingReward: 1.5,
    zbxUntilNextHalving: 21_902_000,
    daysUntilNextHalving: 487,
    yearsUntilFullSupply: 12.3,
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 space-y-6 font-sans">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-3">
            Network Overview
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          </h1>
          <p className="text-neutral-400 text-sm">Live statistics and recent network activity • Chain ID 5152</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-fuchsia-600/20 border border-fuchsia-500/40 text-fuchsia-200 text-xs font-medium hover:bg-fuchsia-600/30">
            🪙 Launch a token
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 border border-indigo-500/40 text-indigo-200 text-xs font-medium hover:bg-indigo-600/30">
            🌐 Explore ZFL
          </button>
        </div>
      </div>

      {/* PRICE NOTE BANNER */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80 flex items-center gap-2">
        <DollarSign className="w-3.5 h-3.5 text-amber-400" />
        Prices indicative — derived from on-chain ZBX/zUSD AMM pool spot rate. Updates every 2s.
      </div>

      {/* TOP STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/30 rounded-xl col-span-1 md:col-span-2 xl:col-span-2 p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-amber-400">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider font-semibold">ZBX Price</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">amm-pool-spot</span>
          </div>
          <div className="text-3xl font-mono font-bold text-amber-300">
            {fmtUsd(ZBX_PRICE)}
            <span className="text-sm text-neutral-500 ml-2 font-sans font-normal">per ZBX</span>
          </div>
          <div className="text-xs text-neutral-400 mt-1 font-mono">
            Market Cap (circulating): {fmtUsd(stats.circulatingSupply * ZBX_PRICE)}
          </div>
        </div>
        <DataCard title="Current TPS" value={fmtNum(stats.currentTps)} icon={Activity} subValue={`Peak: ${fmtNum(stats.peakTps)}`} pulse />
        <DataCard title="Block Height" value={fmtNum(stats.blockHeight)} icon={Box} />
        <DataCard title="Total Txs" value={fmtNum(stats.totalTransactions)} icon={ListOrdered} />
        <DataCard title="Active Validators" value={stats.activeValidators} icon={Server} />
        <DataCard title="Avg Block Time" value={`${stats.avgBlockTime.toFixed(2)}s`} icon={Clock} />
        <DataCard title="Mempool Size" value={fmtNum(stats.mempoolSize)} icon={Hash} />
      </div>

      {/* TOKENOMICS SECTION */}
      <TokenomicsSection s={stats} />

      {/* ZFL TOP TOKENS */}
      <ZflTopTokens />

      {/* TPS CHART + RECENT BLOCKS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-1 lg:col-span-2 bg-neutral-900/80 border border-neutral-800 rounded-xl">
          <div className="p-4 pb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Activity className="w-5 h-5 text-emerald-400" />
              TPS History
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 ml-1">last 2 min</span>
            </h3>
            <div className="text-xs text-neutral-400 font-mono">avg 11.2 · peak 17.4</div>
          </div>
          <div className="p-4 pt-0">
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={tpsHistory} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <defs>
                    <linearGradient id="tps-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getMinutes()}:${String(d.getSeconds()).padStart(2, "0")}`;
                    }}
                    stroke="#737373"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis stroke="#737373" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#171717", borderColor: "#404040", color: "#e5e5e5", fontSize: 12 }}
                    formatter={(v: number) => [`${v.toFixed(2)} TPS`, "Throughput"]}
                    labelFormatter={(l) => new Date(l as number).toLocaleTimeString()}
                  />
                  <Area type="monotone" dataKey="tps" stroke="#10b981" strokeWidth={2} fill="url(#tps-grad)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl">
          <div className="p-4 pb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Box className="w-5 h-5 text-emerald-400" />
              Recent Blocks
            </h3>
            <a className="text-xs text-emerald-400 hover:underline cursor-pointer flex items-center gap-1">View All <ArrowUpRight className="w-3 h-3" /></a>
          </div>
          <div className="p-4 pt-0 space-y-2">
            {blocks.map((b) => (
              <div key={b.index} className="flex flex-col p-3 rounded-md bg-neutral-800/40 border border-neutral-800 hover:border-emerald-500/40 transition-colors">
                <div className="flex justify-between items-center mb-1">
                  <a className="font-mono text-emerald-400 font-bold hover:underline cursor-pointer">#{fmtNum(b.index)}</a>
                  <span className="text-xs text-neutral-500">{ago(b.ts)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-neutral-400">Txs: <span className="text-neutral-200 font-mono">{b.txCount}</span></span>
                  <span className="text-neutral-400">Reward: <span className="text-neutral-200 font-mono">{b.reward} ZBX</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RECENT TRANSACTIONS */}
      <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl">
        <div className="p-4 pb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ListOrdered className="w-5 h-5 text-emerald-400" />
            Recent Transactions
          </h3>
          <a className="text-sm text-emerald-400 hover:underline cursor-pointer flex items-center gap-1">View All Transactions <ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-neutral-500 uppercase bg-neutral-800/30">
              <tr>
                <th className="px-4 py-2.5 font-medium">Hash</th>
                <th className="px-4 py-2.5 font-medium">From</th>
                <th className="px-4 py-2.5 font-medium">To</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {txs.map((tx) => (
                <tr key={tx.hash} className="hover:bg-neutral-800/30 transition-colors">
                  <td className="px-4 py-3 font-mono">
                    <a className="text-emerald-400 hover:underline cursor-pointer">{trunc(tx.hash, 8, 6)}</a>
                  </td>
                  <td className="px-4 py-3 font-mono text-neutral-300">{trunc(tx.from)}</td>
                  <td className="px-4 py-3 font-mono text-neutral-300">{trunc(tx.to)}</td>
                  <td className="px-4 py-3 font-mono text-right">
                    <div className="font-medium">{fmtZbx(tx.amount)} <span className="text-xs text-neutral-500">ZBX</span></div>
                    <div className="text-[10px] text-amber-400/80">{fmtUsd(tx.amount * ZBX_PRICE)}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={tx.status} /></td>
                  <td className="px-4 py-3 text-right text-neutral-500 whitespace-nowrap">{ago(tx.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DataCard({ title, value, icon: Icon, subValue, pulse }: { title: string; value: React.ReactNode; icon: any; subValue?: string; pulse?: boolean }) {
  return (
    <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">{title}</span>
        <Icon className={`w-4 h-4 text-neutral-500 ${pulse ? "text-emerald-400 animate-pulse" : ""}`} />
      </div>
      <div className="text-2xl font-mono font-bold text-neutral-100">{value}</div>
      {subValue && <div className="text-[11px] text-neutral-500 mt-0.5 font-mono">{subValue}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "success" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
    status === "pending" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
    "bg-rose-500/15 text-rose-300 border-rose-500/30";
  const label = status === "success" ? "Success" : status === "pending" ? "Pending" : "Failed";
  return <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded border ${cls}`}>{label}</span>;
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct < 0.001 && pct > 0 ? 0.5 : pct}%` }} />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className={`font-mono ${bold ? "font-bold text-neutral-100" : "text-neutral-300"}`}>{value}</span>
    </div>
  );
}

function TokenomicsSection({ s }: { s: any }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Coins className="w-5 h-5 text-emerald-400" />
          Tokenomics &amp; Mining Economics
        </h2>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wider font-semibold">Hard Capped · Immutable Rules</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* SUPPLY */}
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-xl">
          <div className="p-4 pb-2 flex items-center justify-between text-xs uppercase tracking-wider text-emerald-300">
            <span className="flex items-center gap-2"><Pickaxe className="w-4 h-4" /> Supply Mined</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono normal-case">amm-pool-spot</span>
          </div>
          <div className="p-4 pt-2 space-y-3">
            <div>
              <div className="text-2xl font-mono font-bold text-neutral-100">
                {fmtZbx(s.circulatingSupply)} <span className="text-sm text-neutral-500">ZBX</span>
              </div>
              <div className="text-xs text-amber-400 font-mono">≈ {fmtUsd(s.circulatingSupply * ZBX_PRICE)}</div>
            </div>
            <ProgressBar percent={s.supplyPercentMined} color="bg-emerald-500" />
            <div className="flex justify-between text-xs font-mono">
              <span className="text-neutral-500">{s.supplyPercentMined.toFixed(4)}% mined</span>
              <span className="text-neutral-500">Max: {fmtZbx(s.maxSupply)}</span>
            </div>
            <div className="pt-2 border-t border-neutral-800 space-y-1">
              <Row label="Total Supply" value={`${fmtZbx(s.maxSupply)} ZBX`} bold />
              <Row label="Circulating" value={`${fmtZbx(s.circulatingSupply)} ZBX`} />
              <Row label="Remaining to Mine" value={`${fmtZbx(s.remainingSupply)} ZBX`} />
            </div>
          </div>
        </div>

        {/* BURN */}
        <div className="bg-gradient-to-br from-orange-500/10 to-red-500/5 border border-orange-500/30 rounded-xl">
          <div className="p-4 pb-2 flex items-center justify-between text-xs uppercase tracking-wider text-orange-400">
            <span className="flex items-center gap-2"><Flame className="w-4 h-4" /> Burn Tracker</span>
            <span className="text-[10px] text-orange-300 font-mono normal-case">ACTIVE</span>
          </div>
          <div className="p-4 pt-2 space-y-3">
            <div>
              <div className="text-2xl font-mono font-bold text-orange-300">
                {fmtZbx(s.totalBurned)} <span className="text-sm text-neutral-500">ZBX burned</span>
              </div>
              <div className="text-xs text-amber-400 font-mono">≈ {fmtUsd(s.totalBurned * ZBX_PRICE)} destroyed</div>
            </div>
            <ProgressBar percent={s.burnPercentOfMax} color="bg-orange-500" />
            <div className="flex justify-between text-xs font-mono">
              <span className="text-neutral-500">{s.burnPercentOfMax.toFixed(4)}% of cap</span>
              <span className="text-neutral-500">Cap: {fmtZbx(s.maxBurnSupply)}</span>
            </div>
            <div className="pt-2 border-t border-neutral-800 space-y-1">
              <Row label="Burn Cap (50% of supply)" value={`${fmtZbx(s.maxBurnSupply)} ZBX`} bold />
              <Row label="Total Burned (forever)" value={`${fmtZbx(s.totalBurned)} ZBX`} />
              <Row label="Burn Capacity Left" value={`${fmtZbx(Math.max(0, s.maxBurnSupply - s.totalBurned))} ZBX`} />
            </div>
            <div className="mt-2 p-2 rounded border border-orange-500/30 bg-orange-500/10 text-orange-200 text-xs leading-snug">
              <div className="font-semibold mb-0.5">Current Fee Policy:</div>
              <div className="font-mono">{s.feePolicy}</div>
            </div>
          </div>
        </div>

        {/* HALVING */}
        <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border border-cyan-500/30 rounded-xl">
          <div className="p-4 pb-2 flex items-center justify-between text-xs uppercase tracking-wider text-cyan-400">
            <span className="flex items-center gap-2"><Hourglass className="w-4 h-4" /> Halving Countdown</span>
            <span className="text-[10px] font-mono normal-case text-cyan-300">Era {s.halvingEra}</span>
          </div>
          <div className="p-4 pt-2 space-y-3">
            <div>
              <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Current Block Reward</div>
              <div className="text-2xl font-mono font-bold text-cyan-300">
                {s.blockReward} <span className="text-sm text-neutral-500">ZBX / block</span>
              </div>
              <div className="text-xs text-amber-400 font-mono">≈ {fmtUsd(s.blockReward * ZBX_PRICE)} per block</div>
            </div>
            <div className="pt-2 border-t border-neutral-800 space-y-1">
              <Row label="Next Halving At" value={`${fmtZbx(s.nextHalvingAt)} ZBX mined`} />
              <Row label="Next Reward Will Be" value={`${s.nextHalvingReward} ZBX / block`} />
              <Row label="ZBX Until Halving" value={`${fmtZbx(s.zbxUntilNextHalving)} ZBX`} />
            </div>
            <div className="mt-2 p-2 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-xs">
              <div className="flex items-center gap-1.5 mb-0.5">
                <TrendingDown className="w-3 h-3" />
                <span className="font-semibold">~{(s.daysUntilNextHalving / 30.44).toFixed(1)} months</span>
              </div>
              <div className="text-cyan-300/70">at current mining rate</div>
            </div>
            <div className="text-xs text-neutral-500 font-mono">
              Full supply (150M) in ~{s.yearsUntilFullSupply.toFixed(1)} years
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZflTopTokens() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <span className="text-fuchsia-400">🪙</span>
          ZFL Token Launchpad
          <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 font-medium uppercase tracking-wider">
            New
          </span>
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-500">{tokens.length} tokens on chain</span>
          <a className="text-fuchsia-300 hover:text-fuchsia-200 cursor-pointer">View all →</a>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tokens.map((t) => {
          const rankCls =
            t.rank === 1 ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
            t.rank === 2 ? "bg-zinc-400/20 text-zinc-200 border-zinc-400/40" :
            t.rank === 3 ? "bg-orange-700/30 text-orange-300 border-orange-700/50" :
            "bg-neutral-800 text-neutral-400 border-neutral-700";
          return (
            <a key={t.addr} className="block rounded-lg border border-neutral-800 bg-neutral-900/80 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 transition-colors p-3 cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${t.hue} grid place-items-center text-xs font-bold text-white`}>
                    {t.symbol.slice(0, 2)}
                  </div>
                  <span className={`absolute -top-1.5 -left-1.5 text-[10px] font-bold w-5 h-5 grid place-items-center rounded-full border ${rankCls}`}>
                    {t.rank}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold truncate">{t.name}</div>
                    {t.live ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">LIVE</span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">DRY</span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-500 font-mono truncate">
                    {t.symbol} · {t.addr.slice(0, 8)}…{t.addr.slice(-4)}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">Price</div>
                  <div className="font-mono font-semibold tabular-nums text-emerald-300">{t.price > 0 ? t.price.toFixed(4) : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">Mcap</div>
                  <div className="font-mono font-semibold tabular-nums">{t.mcap > 0 ? fmtZbx(t.mcap) : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">Liq</div>
                  <div className="font-mono font-semibold tabular-nums text-fuchsia-300">{t.liq > 0 ? fmtZbx(t.liq) : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">Vol</div>
                  <div className="font-mono font-semibold tabular-nums text-cyan-300">{t.vol > 0 ? fmtZbx(t.vol) : "—"}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-500">
                <span>{t.swaps} swaps</span>
                <span>{t.holders} holders</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
