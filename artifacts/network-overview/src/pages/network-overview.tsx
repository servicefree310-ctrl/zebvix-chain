import React, { useEffect, useRef, useState } from "react";
import {
  rpc,
  weiHexToZbxNum,
  shortAddr,
  fmtUsd,
  fmtZbx,
  fmtNum,
  ago,
} from "@/lib/zbx-rpc";
import {
  Activity, Box, ListOrdered, Server, Hash, Clock, DollarSign, Flame, Coins,
  Hourglass, TrendingDown, Pickaxe, ShieldCheck, ArrowUpRight, ExternalLink,
  BookOpen, PlayCircle, TerminalSquare, FileJson, Users, Network, Settings, CheckSquare,
  Rocket, Wallet, Shield, AtSign, ListChecks, Calculator, Map as MapIcon, Paintbrush,
  Search, Droplets, ArrowLeftRight, TrendingUp, ArrowUpDown, Layers, FileCode2,
  Code2, Sparkles, GitBranch, Download, Copy, Check, Cpu,
} from "lucide-react";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart,
} from "recharts";

interface BlockInfo {
  hash: string;
  height: number;
  proposer: string;
  timestamp_ms: number;
  tx_count: number;
  txs: TxInfo[];
}
interface TxInfo {
  hash: string;
  from: string;
  to: string;
  amount_wei: string;
  status: "success" | "pending" | "failed";
  ts: number;
}

interface PriceInfo { zbx_usd: string; source: string; }
interface SupplyInfo {
  height: number;
  minted_wei: string;
  max_wei: string;
  current_block_reward_wei: string;
  burned_wei?: string;
  premine_wei?: string;
  pool_seed_wei?: string;
  pool_reserve_wei?: string;
  circulating_wei?: string;
}
interface ValidatorInfo {
  validators?: Array<{ address: string; voting_power: number }>;
  total_voting_power?: number;
}
interface MempoolInfo { size?: number; total?: number; }

const trunc = (s: string, head = 6, tail = 4) =>
  !s ? "" : s.length <= head + tail + 2 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

const tokens = [
  { name: "Zeb Doge", symbol: "ZDOGE", addr: "0x1a2b3c4d5e6f7081", rank: 1, price: 0.0234, mcap: 2_340_000, liq: 145_000, vol: 89_500, swaps: 1_247, holders: 312, live: true, hue: "from-amber-500 to-orange-600" },
  { name: "Pepe Zebra", symbol: "ZPEPE", addr: "0x9f8e7d6c5b4a3928", rank: 2, price: 0.000891, mcap: 891_000, liq: 67_200, vol: 42_100, swaps: 689, holders: 178, live: true, hue: "from-emerald-500 to-teal-600" },
  { name: "Founder Coin", symbol: "FNDR", addr: "0xabcdef0123456789", rank: 3, price: 0.452, mcap: 452_000, liq: 38_500, vol: 21_300, swaps: 412, holders: 95, live: true, hue: "from-indigo-500 to-purple-600" },
  { name: "Rocket Token", symbol: "ROCK", addr: "0x5544332211009988", rank: 4, price: 0.0089, mcap: 89_000, liq: 12_100, vol: 8_400, swaps: 156, holders: 42, live: true, hue: "from-rose-500 to-pink-600" },
  { name: "Gas Refund", symbol: "GAS", addr: "0x7766554433221100", rank: 5, price: 1.024, mcap: 1_024_000, liq: 8_900, vol: 3_200, swaps: 78, holders: 31, live: true, hue: "from-cyan-500 to-blue-600" },
  { name: "TestNet", symbol: "TEST", addr: "0x1100ffeeddccbbaa", rank: 6, price: 0, mcap: 0, liq: 0, vol: 0, swaps: 0, holders: 1, live: false, hue: "from-zinc-500 to-zinc-700" },
];

interface TpsPoint { timestamp: number; tps: number; }

export default function NetworkOverview() {
  const [tip, setTip] = useState<BlockInfo | null>(null);
  const [recentBlocks, setRecentBlocks] = useState<BlockInfo[]>([]);
  const [recentTxs, setRecentTxs] = useState<TxInfo[]>([]);
  const [price, setPrice] = useState<number>(1);
  const [priceSource, setPriceSource] = useState<string>("amm-pool-spot");
  const [supply, setSupply] = useState<SupplyInfo | null>(null);
  const [vals, setVals] = useState<ValidatorInfo | null>(null);
  const [mempoolSize, setMempoolSize] = useState<number>(0);
  const [tpsHistory, setTpsHistory] = useState<TpsPoint[]>([]);
  const [stats, setStats] = useState<{ avgTps: number; currentTps: number; peakTps: number; avgBlockTimeS: number; estimatedTotalTxs: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tpsRef = useRef<TpsPoint[]>([]);
  const epochRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let cancelled = false;

    async function tick() {
      const myEpoch = ++epochRef.current;
      const isLatest = () => mounted && myEpoch === epochRef.current;
      try {
        const tipRes = await rpc<{ height: number; hash?: string }>("zbx_blockNumber");
        if (!isLatest()) return;
        setErr(null);

        // Secondary fetches in parallel
        Promise.all([
          rpc<ValidatorInfo>("zbx_listValidators").catch(() => null),
          rpc<PriceInfo>("zbx_getPriceUSD").catch(() => null),
          rpc<SupplyInfo>("zbx_supply").catch(() => null),
          rpc<MempoolInfo>("zbx_mempool").catch(() => null),
        ]).then(([va, pr, sup, mp]) => {
          if (!isLatest()) return;
          if (va) setVals(va);
          if (pr) {
            const p = parseFloat(pr.zbx_usd);
            if (!isNaN(p) && p > 0) setPrice(p);
            if (pr.source) setPriceSource(pr.source);
          }
          if (sup) setSupply(sup);
          if (mp) setMempoolSize(mp.size ?? mp.total ?? 0);
        }).catch(() => {});

        // Last 15 blocks
        const WINDOW = 15;
        const heights: number[] = [];
        for (let i = 0; i < WINDOW; i++) {
          const h = tipRes.height - i;
          if (h >= 0) heights.push(h);
        }
        const blocks = await Promise.all(
          heights.map(async (h) => {
            try {
              const r = await rpc<any>("zbx_getBlockByNumber", [h]);
              if (!r) return null;
              const hdr = r.header ?? r;
              const rawTxs = Array.isArray(r.txs) ? r.txs : [];
              const txs: TxInfo[] = rawTxs.map((t: any, idx: number) => ({
                hash: t.hash ?? `${hdr.hash ?? h}-${idx}`,
                from: t.from ?? t.sender ?? "",
                to: t.to ?? t.recipient ?? "",
                amount_wei: t.amount_wei ?? t.amount ?? t.value ?? "0",
                status: (t.status as any) ?? "success",
                ts: hdr.timestamp_ms ?? Date.now(),
              }));
              return {
                hash: r.hash ?? hdr.hash ?? `h${h}`,
                height: hdr.height ?? h,
                proposer: hdr.proposer ?? "",
                timestamp_ms: hdr.timestamp_ms ?? 0,
                tx_count: txs.length,
                txs,
              } as BlockInfo;
            } catch {
              return null;
            }
          })
        );
        const valid = blocks.filter((b): b is BlockInfo => !!b);
        if (!isLatest()) return;
        setTip(valid[0] ?? null);
        setRecentBlocks(valid.slice(0, 6));

        // Aggregate recent txs (latest 8)
        const allTxs: TxInfo[] = [];
        for (const b of valid) {
          for (const t of b.txs) allTxs.push(t);
          if (allTxs.length >= 12) break;
        }
        setRecentTxs(allTxs.slice(0, 8));

        // Stats
        if (valid.length >= 2) {
          const sorted = [...valid].sort((a, b) => a.height - b.height);
          const totalTxs = sorted.reduce((s, b) => s + b.tx_count, 0);
          const oldest = sorted[0];
          const newest = sorted[sorted.length - 1];
          const spanS = Math.max(1, (newest.timestamp_ms - oldest.timestamp_ms) / 1000);
          const numBlocks = sorted.length;
          const avgBlockTimeS = spanS / Math.max(1, numBlocks - 1);
          const avgTps = totalTxs / spanS;
          const last = sorted[sorted.length - 1];
          const prev = sorted[sorted.length - 2];
          const lastDtS = Math.max(0.001, (last.timestamp_ms - prev.timestamp_ms) / 1000);
          const currentTps = last.tx_count / lastDtS;

          // Append to TPS history (keep last 60 points)
          const next = [...tpsRef.current, { timestamp: Date.now(), tps: currentTps }].slice(-60);
          tpsRef.current = next;
          const peakTps = next.reduce((m, p) => Math.max(m, p.tps), 0);
          setTpsHistory(next);

          const estimatedTotalTxs = Math.round(avgTps * tipRes.height * avgBlockTimeS);
          setStats({ avgTps, currentTps, peakTps, avgBlockTimeS, estimatedTotalTxs });
        }
      } catch (e) {
        if (isLatest()) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (isLatest()) setLoading(false);
      }
    }

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    (async () => {
      while (mounted && !cancelled) {
        await tick();
        if (!mounted || cancelled) break;
        await sleep(5000);
      }
    })();
    return () => {
      mounted = false;
      cancelled = true;
      epochRef.current++;
    };
  }, []);

  // Tokenomics derived
  const minted = supply ? weiHexToZbxNum(supply.minted_wei) : 0;
  const maxSupply = supply ? weiHexToZbxNum(supply.max_wei) : 150_000_000;
  const burned = supply?.burned_wei ? weiHexToZbxNum(supply.burned_wei) : 0;
  const premine = supply?.premine_wei ? weiHexToZbxNum(supply.premine_wei) : 0;
  const poolSeed = supply?.pool_seed_wei ? weiHexToZbxNum(supply.pool_seed_wei) : 0;
  const poolReserve = supply?.pool_reserve_wei ? weiHexToZbxNum(supply.pool_reserve_wei) : 0;
  // Prefer chain-computed circulating; fall back to (minted + premine + pool_seed - burned)
  // for older nodes that don't expose `circulating_wei` yet.
  const circulating = supply?.circulating_wei
    ? weiHexToZbxNum(supply.circulating_wei)
    : Math.max(0, minted + premine + poolSeed - burned);
  const blockReward = supply ? weiHexToZbxNum(supply.current_block_reward_wei) : 3;
  const supplyPercentMined = maxSupply > 0 ? (minted / maxSupply) * 100 : 0;
  const remainingSupply = Math.max(0, maxSupply - minted);
  const maxBurnSupply = maxSupply * 0.5;
  const burnPercentOfMax = maxBurnSupply > 0 ? (burned / maxBurnSupply) * 100 : 0;

  // Halving math (Bitcoin-style: every 50M ZBX mined)
  const HALVING_INTERVAL = 50_000_000;
  const halvingEra = Math.floor(minted / HALVING_INTERVAL);
  const nextHalvingAt = (halvingEra + 1) * HALVING_INTERVAL;
  const zbxUntilNextHalving = Math.max(0, nextHalvingAt - minted);
  const nextHalvingReward = blockReward / 2;
  const avgBlockTimeS = stats?.avgBlockTimeS ?? 5;
  const avgTps = stats?.avgTps ?? 0;
  const blocksPerSecond = avgBlockTimeS > 0 ? 1 / avgBlockTimeS : 0.2;
  const zbxPerSecond = blocksPerSecond * blockReward;
  const secsUntilNextHalving = zbxPerSecond > 0 ? zbxUntilNextHalving / zbxPerSecond : 0;
  const daysUntilNextHalving = secsUntilNextHalving / 86400;
  const yearsUntilFullSupply = zbxPerSecond > 0 ? remainingSupply / zbxPerSecond / (86400 * 365) : 0;

  const totalTransactions = stats?.estimatedTotalTxs ?? 0;
  const currentTps = stats?.currentTps ?? 0;
  const peakTps = stats?.peakTps ?? 0;
  const blockHeight = tip?.height ?? 0;
  const activeValidators = vals?.validators?.length ?? 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans flex">
      <AppSidebar />
      <main className="flex-1 min-w-0 p-6 space-y-6">
        {/* HEADER */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-3">
              Network Overview
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${err ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${err ? "bg-rose-400" : "bg-emerald-400 animate-pulse"}`} />
                {err ? "OFFLINE" : "LIVE"}
              </span>
              {loading && <span className="text-xs text-neutral-500 font-normal">loading…</span>}
            </h1>
            <p className="text-neutral-400 text-sm">Live statistics and recent network activity • Chain ID 7878 • Zebvix L1</p>
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

        {err && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-200 font-mono">
            RPC error: {err}
          </div>
        )}

        {/* PRICE NOTE BANNER */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80 flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5 text-amber-400" />
          Prices indicative — derived from on-chain ZBX/zUSD AMM pool spot rate. Updates every 5s.
        </div>

        {/* TOP STATS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/30 rounded-xl col-span-1 md:col-span-2 xl:col-span-2 p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-amber-400">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wider font-semibold">ZBX Price</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">{priceSource}</span>
            </div>
            <div className="text-3xl font-mono font-bold text-amber-300">
              {fmtUsd(price)}
              <span className="text-sm text-neutral-500 ml-2 font-sans font-normal">per ZBX</span>
            </div>
            <div className="text-xs text-neutral-400 mt-1 font-mono">
              Market Cap (circulating): {fmtUsd(circulating * price)}
            </div>
          </div>
          <DataCard title="Current TPS" value={currentTps.toFixed(2)} icon={Activity} subValue={`Peak: ${peakTps.toFixed(2)}`} pulse />
          <DataCard title="Block Height" value={fmtNum(blockHeight)} icon={Box} />
          <DataCard title="Total Txs" value={fmtNum(totalTransactions)} icon={ListOrdered} />
          <DataCard title="Active Validators" value={activeValidators} icon={Server} />
          <DataCard title="Avg Block Time" value={`${avgBlockTimeS.toFixed(2)}s`} icon={Clock} />
          <DataCard title="Mempool Size" value={fmtNum(mempoolSize)} icon={Hash} />
        </div>

        {/* VPS UPGRADE COMMAND */}
        <VpsUpgradeCard />

        {/* TOKENOMICS SECTION */}
        <TokenomicsSection
          minted={minted}
          maxSupply={maxSupply}
          remainingSupply={remainingSupply}
          supplyPercentMined={supplyPercentMined}
          circulating={circulating}
          premine={premine}
          poolSeed={poolSeed}
          poolReserve={poolReserve}
          burned={burned}
          maxBurnSupply={maxBurnSupply}
          burnPercentOfMax={burnPercentOfMax}
          blockReward={blockReward}
          halvingEra={halvingEra}
          nextHalvingAt={nextHalvingAt}
          nextHalvingReward={nextHalvingReward}
          zbxUntilNextHalving={zbxUntilNextHalving}
          daysUntilNextHalving={daysUntilNextHalving}
          yearsUntilFullSupply={yearsUntilFullSupply}
          price={price}
        />

        {/* ZFL TOP TOKENS */}
        <ZflTopTokens />

        {/* TPS CHART + RECENT BLOCKS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="col-span-1 lg:col-span-2 bg-neutral-900/80 border border-neutral-800 rounded-xl">
            <div className="p-4 pb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Activity className="w-5 h-5 text-emerald-400" />
                TPS History
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 ml-1">live · last {tpsHistory.length} samples</span>
              </h3>
              <div className="text-xs text-neutral-400 font-mono">avg {avgTps.toFixed(2)} · peak {peakTps.toFixed(2)}</div>
            </div>
            <div className="p-4 pt-0">
              <div className="h-[280px] w-full">
                {tpsHistory.length < 2 ? (
                  <div className="h-full grid place-items-center text-neutral-500 text-sm">Collecting samples…</div>
                ) : (
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
                )}
              </div>
            </div>
          </div>

          <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl">
            <div className="p-4 pb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Box className="w-5 h-5 text-emerald-400" />
                Recent Blocks
              </h3>
              <span className="text-xs text-neutral-500">live</span>
            </div>
            <div className="p-4 pt-0 space-y-2">
              {recentBlocks.length === 0 && (
                <div className="text-sm text-neutral-500 py-6 text-center">Waiting for blocks…</div>
              )}
              {recentBlocks.map((b) => (
                <div key={b.height} className="flex flex-col p-3 rounded-md bg-neutral-800/40 border border-neutral-800 hover:border-emerald-500/40 transition-colors">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-mono text-emerald-400 font-bold">#{fmtNum(b.height)}</span>
                    <span className="text-xs text-neutral-500">{ago(b.timestamp_ms)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-neutral-400">Txs: <span className="text-neutral-200 font-mono">{b.tx_count}</span></span>
                    <span className="text-neutral-400">Reward: <span className="text-neutral-200 font-mono">{blockReward} ZBX</span></span>
                  </div>
                  {b.proposer && (
                    <div className="text-[10px] text-neutral-500 font-mono mt-1 truncate">
                      by {trunc(b.proposer, 8, 6)}
                    </div>
                  )}
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
            <span className="text-xs text-neutral-500 flex items-center gap-1">
              <ExternalLink className="w-3.5 h-3.5" /> live from chain
            </span>
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
                {recentTxs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No recent transactions in the latest blocks.</td>
                  </tr>
                )}
                {recentTxs.map((tx) => {
                  const amtZbx = weiHexToZbxNum(tx.amount_wei);
                  return (
                    <tr key={tx.hash} className="hover:bg-neutral-800/30 transition-colors">
                      <td className="px-4 py-3 font-mono">
                        <span className="text-emerald-400">{trunc(tx.hash, 8, 6)}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-300">{shortAddr(tx.from) || "—"}</td>
                      <td className="px-4 py-3 font-mono text-neutral-300">{shortAddr(tx.to) || "—"}</td>
                      <td className="px-4 py-3 font-mono text-right">
                        <div className="font-medium">{fmtZbx(amtZbx)} <span className="text-xs text-neutral-500">ZBX</span></div>
                        <div className="text-[10px] text-amber-400/80">{fmtUsd(amtZbx * price)}</div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={tx.status} /></td>
                      <td className="px-4 py-3 text-right text-neutral-500 whitespace-nowrap">{ago(tx.ts)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

function AppSidebar() {
  const CORE_NAV = [
    { label: "Overview", icon: BookOpen },
    { label: "Quick Start Script", icon: PlayCircle },
    { label: "Environment Setup", icon: TerminalSquare },
    { label: "Genesis Config", icon: FileJson },
    { label: "Validator Setup", icon: Users },
    { label: "Network Config", icon: Network },
    { label: "Tokenomics", icon: Coins },
    { label: "Customization", icon: Settings },
    { label: "Launch Checklist", icon: CheckSquare },
    { label: "Production Chain", icon: Rocket },
  ];
  const LIVE_NAV = [
    { label: "Network Overview", icon: Activity, active: true },
    { label: "Live Chain Status", icon: Activity },
    { label: "Balance Lookup", icon: Wallet },
    { label: "Multisig Explorer", icon: Shield },
    { label: "Pay-ID Resolver", icon: AtSign },
  ];
  const ADDON_NAV = [
    { label: "Phase Tracker", icon: ListChecks },
    { label: "Economic Designer", icon: Calculator },
    { label: "Implementation Roadmap", icon: MapIcon },
    { label: "Rebranding Guide", icon: Paintbrush },
    { label: "ZBX Tokenomics Design", icon: Coins },
    { label: "Block Explorer", icon: Search },
    { label: "ZBX Wallet", icon: Wallet },
    { label: "Testnet Faucet", icon: Droplets },
    { label: "Cross-Chain Bridge", icon: ArrowLeftRight },
    { label: "Staking Dashboard", icon: TrendingUp },
    { label: "DEX / Swap", icon: ArrowUpDown },
    { label: "Zebvix Fabric Layer", icon: Layers },
    { label: "Code Review — What Changed", icon: FileCode2 },
    { label: "Chain Source Code", icon: Code2 },
    { label: "Chain Features", icon: Sparkles },
    { label: "Consensus Roadmap (DAG-BFT)", icon: GitBranch },
    { label: "Downloads", icon: Download },
  ];

  const NavItem = ({ label, icon: Icon, active }: { label: string; icon: any; active?: boolean }) => (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
      active ? "bg-emerald-500/10 text-emerald-400" : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50"
    }`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );

  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-neutral-800 bg-neutral-900/40 h-screen sticky top-0 overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.35)]">
            <div className="w-3 h-3 bg-neutral-950 rounded-sm" />
          </div>
          <span className="font-bold text-lg text-neutral-100 tracking-tight">Zebvix Dev</span>
        </div>
        <p className="text-[10px] text-neutral-500 font-mono pl-9 mb-5 tracking-wide">Zebvix Technologies Pvt Ltd</p>
        <nav className="space-y-0.5">
          {CORE_NAV.map((item) => <NavItem key={item.label} {...item} />)}
          <div className="pt-3 pb-1 px-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-500/80">● Live (VPS RPC)</span>
          </div>
          {LIVE_NAV.map((item) => <NavItem key={item.label} {...item} />)}
          <div className="pt-3 pb-1 px-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-500/60">Addons</span>
          </div>
          {ADDON_NAV.map((item) => <NavItem key={item.label} {...item} />)}
        </nav>
        <div className="p-4 mt-6 bg-neutral-900 border border-neutral-800 rounded-lg shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-neutral-400">Launch Readiness</span>
            <span className="text-xs font-mono text-emerald-400">82%</span>
          </div>
          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: "82%" }} />
          </div>
        </div>
      </div>
    </aside>
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

interface TokenomicsProps {
  minted: number; maxSupply: number; remainingSupply: number; supplyPercentMined: number;
  circulating: number; premine: number; poolSeed: number; poolReserve: number;
  burned: number; maxBurnSupply: number; burnPercentOfMax: number;
  blockReward: number; halvingEra: number; nextHalvingAt: number; nextHalvingReward: number;
  zbxUntilNextHalving: number; daysUntilNextHalving: number; yearsUntilFullSupply: number;
  price: number;
}

function TokenomicsSection(s: TokenomicsProps) {
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
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono normal-case">on-chain</span>
          </div>
          <div className="p-4 pt-2 space-y-3">
            <div>
              <div className="text-2xl font-mono font-bold text-neutral-100">
                {fmtZbx(s.minted)} <span className="text-sm text-neutral-500">ZBX</span>
              </div>
              <div className="text-xs text-amber-400 font-mono">≈ {fmtUsd(s.minted * s.price)}</div>
            </div>
            <ProgressBar percent={s.supplyPercentMined} color="bg-emerald-500" />
            <div className="flex justify-between text-xs font-mono">
              <span className="text-neutral-500">{s.supplyPercentMined.toFixed(4)}% mined</span>
              <span className="text-neutral-500">Max: {fmtZbx(s.maxSupply)}</span>
            </div>
            <div className="pt-2 border-t border-neutral-800 space-y-1">
              <Row label="Total Supply" value={`${fmtZbx(s.maxSupply)} ZBX`} bold />
              <Row label="Mined (block rewards)" value={`${fmtZbx(s.minted)} ZBX`} />
              {s.poolSeed > 0 && <Row label="AMM Pool Seed (genesis)" value={`+${fmtZbx(s.poolSeed)} ZBX`} />}
              {s.premine > 0 && <Row label="Founder Premine" value={`+${fmtZbx(s.premine)} ZBX`} />}
              {s.burned > 0 && <Row label="Burned" value={`-${fmtZbx(s.burned)} ZBX`} />}
              <Row label="Circulating" value={`${fmtZbx(s.circulating)} ZBX`} bold />
              {s.poolReserve > 0 && <Row label="↳ in AMM Pool" value={`${fmtZbx(s.poolReserve)} ZBX`} />}
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
                {fmtZbx(s.burned)} <span className="text-sm text-neutral-500">ZBX burned</span>
              </div>
              <div className="text-xs text-amber-400 font-mono">≈ {fmtUsd(s.burned * s.price)} destroyed</div>
            </div>
            <ProgressBar percent={s.burnPercentOfMax} color="bg-orange-500" />
            <div className="flex justify-between text-xs font-mono">
              <span className="text-neutral-500">{s.burnPercentOfMax.toFixed(4)}% of cap</span>
              <span className="text-neutral-500">Cap: {fmtZbx(s.maxBurnSupply)}</span>
            </div>
            <div className="pt-2 border-t border-neutral-800 space-y-1">
              <Row label="Burn Cap (50% of supply)" value={`${fmtZbx(s.maxBurnSupply)} ZBX`} bold />
              <Row label="Total Burned (forever)" value={`${fmtZbx(s.burned)} ZBX`} />
              <Row label="Burn Capacity Left" value={`${fmtZbx(Math.max(0, s.maxBurnSupply - s.burned))} ZBX`} />
            </div>
            <div className="mt-2 p-2 rounded border border-orange-500/30 bg-orange-500/10 text-orange-200 text-xs leading-snug">
              <div className="font-semibold mb-0.5">Current Fee Policy:</div>
              <div className="font-mono">10% burned, 90% to validator</div>
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
              <div className="text-xs text-amber-400 font-mono">≈ {fmtUsd(s.blockReward * s.price)} per block</div>
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
              Full supply ({fmtZbx(s.maxSupply)}) in ~{s.yearsUntilFullSupply.toFixed(1)} years
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
            Showcase
          </span>
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-500">{tokens.length} tokens on chain</span>
          <span className="text-fuchsia-300">View all →</span>
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
            <div key={t.addr} className="block rounded-lg border border-neutral-800 bg-neutral-900/80 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5 transition-colors p-3 cursor-pointer">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VPS Upgrade Card — one-line installer for chain patches
// ─────────────────────────────────────────────────────────────────────────────
function VpsUpgradeCard() {
  const installerUrl =
    `${window.location.origin}/api/downloads/install-zbx-supply-v0.2.sh`;
  const cmd = `curl -fsSL ${installerUrl} | sudo bash`;
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="bg-gradient-to-br from-indigo-500/10 via-fuchsia-500/5 to-neutral-950 border border-indigo-500/30 rounded-xl">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Cpu className="w-4 h-4 text-indigo-400" />
          VPS Node Upgrade — Supply RPC Patch
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono normal-case">
            v0.2
          </span>
        </h3>
        <a
          href={installerUrl}
          download
          className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1"
        >
          <Download className="w-3.5 h-3.5" /> raw script
        </a>
      </div>
      <div className="px-4 pb-4 space-y-3">
        <p className="text-xs text-neutral-400 leading-relaxed">
          Apne Zebvix VPS node pe SSH karke ye <span className="text-indigo-300 font-mono">ek-line command</span> chalao.
          v0.2 fix: <span className="text-amber-300 font-mono">pool_seed_wei</span> +{" "}
          <span className="text-amber-300 font-mono">pool_reserve_wei</span> add hue, aur{" "}
          <span className="text-emerald-300 font-mono">circulating_wei</span> ab 10M AMM pool seed include karta hai.
          Script khud hi backup, build, install aur restart kar dega.
        </p>
        <div className="relative">
          <pre className="bg-neutral-950 border border-neutral-800 rounded-md p-3 pr-12 text-xs font-mono text-emerald-300 overflow-x-auto whitespace-pre">
{cmd}
          </pre>
          <button
            onClick={onCopy}
            className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-200"
            title="Copy"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy
              </>
            )}
          </button>
        </div>
        <details className="text-xs text-neutral-400">
          <summary className="cursor-pointer hover:text-neutral-200">
            Custom paths (chain dir / service names alag hain?)
          </summary>
          <pre className="mt-2 bg-neutral-950 border border-neutral-800 rounded-md p-3 text-xs font-mono text-neutral-300 overflow-x-auto whitespace-pre">
{`export CHAIN_DIR=/your/path/to/zebvix-chain
export NODE_SVCS="your-svc-1 your-svc-2"
curl -fsSL ${installerUrl} | sudo -E bash`}
          </pre>
        </details>
      </div>
    </div>
  );
}
