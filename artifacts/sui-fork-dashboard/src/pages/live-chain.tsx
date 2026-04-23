import React, { useEffect, useState } from "react";
import { rpc, weiHexToZbx, shortAddr, weiToUsd, fmtUsd } from "@/lib/zbx-rpc";
import {
  Activity,
  Box,
  Users,
  DollarSign,
  Zap,
  AlertCircle,
  TrendingUp,
  Coins,
  ArrowLeftRight,
  Gauge,
  Timer,
} from "lucide-react";

interface BlockInfo {
  hash: string;
  height: number;
  proposer: string;
  timestamp_ms: number;
  tx_count: number;
}

interface ChainStats {
  totalTxsWindow: number;
  windowSize: number;
  avgBlockTimeS: number;
  avgTps: number;
  currentTps: number;
  estimatedTotalTxs: number;
}

interface FeeBounds {
  min_fee_wei: string;
  max_fee_wei: string;
  recommended_fee_wei: string;
  min_usd?: number;
  max_usd?: number;
  source?: string;
}

interface VoteStats {
  height?: number;
  votes?: number;
  voting_power?: number;
  quorum?: number;
}

interface ValidatorInfo {
  validators?: Array<{ address: string; voting_power: number }>;
  total_voting_power?: number;
  quorum?: number;
}

interface PriceInfo {
  zbx_usd: string;
  source: string;
}

interface SupplyInfo {
  height: number;
  minted_wei: string;
  max_wei: string;
  current_block_reward_wei: string;
}

interface PoolInfo {
  zbx_reserve_wei: string;
  zusd_reserve: string;
  lp_supply: string;
  spot_price_usd_per_zbx: string;
}

export default function LiveChain() {
  const [tip, setTip] = useState<BlockInfo | null>(null);
  const [recent, setRecent] = useState<BlockInfo[]>([]);
  const [fee, setFee] = useState<FeeBounds | null>(null);
  const [votes, setVotes] = useState<VoteStats | null>(null);
  const [vals, setVals] = useState<ValidatorInfo | null>(null);
  const [msCount, setMsCount] = useState<number | null>(null);
  const [payIdCount, setPayIdCount] = useState<number | null>(null);
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [supply, setSupply] = useState<SupplyInfo | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [stats, setStats] = useState<ChainStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    async function tick() {
      try {
        const [tipRes, feeRes] = await Promise.all([
          rpc<BlockInfo>("zbx_blockNumber"),
          rpc<FeeBounds>("zbx_feeBounds").catch(() => null),
        ]);
        if (!mounted) return;
        setTip(tipRes);
        if (feeRes) setFee(feeRes);
        setErr(null);

        // Kick off secondary parallel fetches FIRST so they don't queue behind 15 block fetches
        Promise.all([
          rpc<VoteStats>("zbx_voteStats").catch(() => null),
          rpc<ValidatorInfo>("zbx_listValidators").catch(() => null),
          rpc<{ total: number }>("zbx_multisigCount").catch(() => null),
          rpc<{ total: number }>("zbx_payIdCount").catch(() => null),
          rpc<PriceInfo>("zbx_getPriceUSD").catch(() => null),
          rpc<SupplyInfo>("zbx_supply").catch(() => null),
          rpc<PoolInfo>("zbx_getPool").catch(() => null),
        ]).then(([v, va, ms, pid, pr, sup, po]) => {
          if (!mounted) return;
          if (v) setVotes(v);
          if (va) setVals(va);
          if (ms) setMsCount(ms.total);
          if (pid) setPayIdCount(pid.total);
          if (pr) setPrice(pr);
          if (sup) setSupply(sup);
          if (po) setPool(po);
        });

        // Fetch last 15 blocks (for stats), but only display 10 in the table
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
              const txs = Array.isArray(r.txs) ? r.txs : [];
              return {
                hash: r.hash ?? hdr.hash ?? `h${h}`,
                height: hdr.height ?? h,
                proposer: hdr.proposer ?? "",
                timestamp_ms: hdr.timestamp_ms ?? 0,
                tx_count: txs.length,
              } as BlockInfo;
            } catch {
              return null;
            }
          }),
        );
        const validBlocks = blocks.filter((b): b is BlockInfo => !!b);
        if (mounted) setRecent(validBlocks.slice(0, 10));

        // Compute chain stats from window
        if (validBlocks.length >= 2) {
          const sorted = [...validBlocks].sort((a, b) => a.height - b.height);
          const totalTxs = sorted.reduce((s, b) => s + b.tx_count, 0);
          const oldest = sorted[0];
          const newest = sorted[sorted.length - 1];
          const spanS = Math.max(1, (newest.timestamp_ms - oldest.timestamp_ms) / 1000);
          const numBlocks = sorted.length;
          const avgBlockTimeS = spanS / Math.max(1, numBlocks - 1);
          const avgTps = totalTxs / spanS;

          // Current TPS = latest block txs / time-since-prev
          const last = sorted[sorted.length - 1];
          const prev = sorted[sorted.length - 2];
          const lastDtS = Math.max(0.001, (last.timestamp_ms - prev.timestamp_ms) / 1000);
          const currentTps = last.tx_count / lastDtS;

          // Rough estimate of lifetime txs = avgTps * (chain age)
          // Chain age = current_height * avgBlockTimeS
          const estimatedTotalTxs = Math.round(avgTps * tipRes.height * avgBlockTimeS);

          if (mounted)
            setStats({
              totalTxsWindow: totalTxs,
              windowSize: numBlocks,
              avgBlockTimeS,
              avgTps,
              currentTps,
              estimatedTotalTxs,
            });
        }

      } catch (e) {
        if (mounted) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    tick();
    timer = window.setInterval(tick, 5000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            Live Chain Status
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time RPC view of the Zebvix mainnet — auto-refresh every 5s.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${err ? "bg-red-500" : "bg-green-500 animate-pulse"}`} />
          <span className="text-muted-foreground">
            {err ? "RPC unreachable" : loading ? "loading..." : "live"}
          </span>
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-red-500 mb-1">RPC error</div>
            <code className="text-xs text-muted-foreground break-all">{err}</code>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          icon={TrendingUp}
          label="ZBX Price"
          value={price ? `$${parseFloat(price.zbx_usd).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}` : "—"}
          sub={price?.source}
          highlight
        />
        <Stat
          icon={Coins}
          label="Market Cap"
          value={
            price && supply
              ? fmtUsd(
                  weiToUsd(
                    (BigInt(supply.minted_wei) + BigInt(pool?.zbx_reserve_wei ?? "0")).toString(),
                    parseFloat(price.zbx_usd),
                  ),
                )
              : "—"
          }
          sub={
            supply
              ? `${weiHexToZbx(
                  (BigInt(supply.minted_wei) + BigInt(pool?.zbx_reserve_wei ?? "0")).toString(),
                )} ZBX circulating`
              : undefined
          }
        />
        <Stat
          icon={Coins}
          label="Fully Diluted Cap"
          value={
            price && supply
              ? fmtUsd(weiToUsd(supply.max_wei, parseFloat(price.zbx_usd)))
              : "—"
          }
          sub={supply ? `max ${weiHexToZbx(supply.max_wei)} ZBX` : undefined}
        />
        <Stat icon={Box} label="Block Height" value={tip ? `#${tip.height.toLocaleString()}` : "—"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          icon={Gauge}
          label="Avg TPS"
          value={stats ? stats.avgTps.toFixed(2) : "—"}
          sub={stats ? `over last ${stats.windowSize} blocks` : undefined}
          highlight
        />
        <Stat
          icon={Activity}
          label="Current TPS"
          value={stats ? stats.currentTps.toFixed(2) : "—"}
          sub={stats ? `latest block` : undefined}
        />
        <Stat
          icon={Timer}
          label="Avg Block Time"
          value={stats ? `${stats.avgBlockTimeS.toFixed(2)}s` : "—"}
          sub={stats ? `${(60 / stats.avgBlockTimeS).toFixed(1)} blocks/min` : undefined}
        />
        <Stat
          icon={ArrowLeftRight}
          label="Total Transactions"
          value={
            stats
              ? stats.estimatedTotalTxs > 0
                ? stats.estimatedTotalTxs.toLocaleString()
                : "0"
              : "—"
          }
          sub={
            stats
              ? `${stats.totalTxsWindow} in last ${stats.windowSize} blocks`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          icon={Users}
          label="Validators"
          value={vals?.validators?.length ?? "—"}
          sub={vals?.quorum ? `quorum ${vals.quorum}` : undefined}
        />
        <Stat icon={Zap} label="Multisig Wallets" value={msCount ?? "—"} />
        <Stat icon={DollarSign} label="Pay-IDs" value={payIdCount ?? "—"} />
        <Stat
          icon={Coins}
          label="Block Reward"
          value={supply ? `${weiHexToZbx(supply.current_block_reward_wei)} ZBX` : "—"}
          sub={
            price && supply
              ? `${fmtUsd(weiToUsd(supply.current_block_reward_wei, parseFloat(price.zbx_usd)))} per block`
              : undefined
          }
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            Live Fee (USD-pegged)
          </h2>
          {fee ? (
            <div className="space-y-1.5 text-xs">
              <Row label="Min" val={`${weiHexToZbx(fee.min_fee_wei)} ZBX${fee.min_usd ? ` ($${fee.min_usd})` : ""}`} />
              <Row label="Recommended" val={`${weiHexToZbx(fee.recommended_fee_wei)} ZBX`} highlight />
              <Row label="Max" val={`${weiHexToZbx(fee.max_fee_wei)} ZBX${fee.max_usd ? ` ($${fee.max_usd})` : ""}`} />
              {fee.source && <Row label="Source" val={fee.source} />}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">loading…</div>
          )}
        </div>

        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Vote Stats (Tendermint B.2)
          </h2>
          {votes ? (
            <div className="space-y-1.5 text-xs">
              {votes.height !== undefined && <Row label="Height" val={`#${votes.height}`} />}
              {votes.votes !== undefined && <Row label="Votes" val={votes.votes.toString()} />}
              {votes.voting_power !== undefined && <Row label="Voting power" val={votes.voting_power.toString()} highlight />}
              {votes.quorum !== undefined && <Row label="Quorum" val={votes.quorum.toString()} />}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">no vote data</div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold">Recent Blocks (last 10)</h2>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">Height</th>
              <th className="text-left p-2 font-medium">Proposer</th>
              <th className="text-left p-2 font-medium">Hash</th>
              <th className="text-right p-2 font-medium">Txs</th>
              <th className="text-right p-2 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">loading…</td></tr>
            )}
            {recent.map((b) => (
              <tr key={b.hash} className="border-t border-border hover:bg-muted/20">
                <td className="p-2 font-mono text-primary">#{b.height}</td>
                <td className="p-2 font-mono text-muted-foreground">{shortAddr(b.proposer)}</td>
                <td className="p-2 font-mono text-muted-foreground">{shortAddr(b.hash, 8, 6)}</td>
                <td className={`p-2 text-right font-mono ${b.tx_count > 0 ? "text-green-400 font-semibold" : "text-muted-foreground"}`}>{b.tx_count}</td>
                <td className="p-2 text-right text-muted-foreground">{ageStr(b.timestamp_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {vals && vals.validators && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold">Validator Set ({vals.validators.length})</h2>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                <th className="text-left p-2 font-medium">#</th>
                <th className="text-left p-2 font-medium">Address</th>
                <th className="text-right p-2 font-medium">Voting Power</th>
              </tr>
            </thead>
            <tbody>
              {vals.validators.map((v, i) => (
                <tr key={v.address} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2 font-mono">{v.address}</td>
                  <td className="p-2 text-right font-mono text-primary">{v.voting_power}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, highlight }: { icon: React.ElementType; label: string; value: React.ReactNode; sub?: string; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-lg border bg-card ${highlight ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={`h-3.5 w-3.5 ${highlight ? "text-primary" : ""}`} />
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Row({ label, val, highlight }: { label: string; val: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${highlight ? "text-primary font-semibold" : ""}`}>{val}</span>
    </div>
  );
}

function ageStr(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
