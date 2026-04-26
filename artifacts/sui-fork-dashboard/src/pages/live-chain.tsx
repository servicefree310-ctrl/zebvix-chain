import React, { useEffect, useRef, useState, useMemo } from "react";
import { useLocation, Link as WLink } from "wouter";
import { rpc, weiHexToZbx, shortAddr, weiToUsd, fmtUsd, getRecommendedFeeWei } from "@/lib/zbx-rpc";
import {
  loadWallets, getActiveAddress, getWallet, sendTransfer, parseNonce,
  type StoredWallet,
} from "@/lib/web-wallet";
import { useWallet } from "@/contexts/wallet-context";
import {
  Activity, Box, Users, Zap, AlertCircle, TrendingUp, Coins,
  ArrowLeftRight, Gauge, Timer, Flame, Layers, Wifi, ShieldCheck,
  Hash, Clock, Cpu, Droplet, ArrowUpRight, ChevronDown, ChevronUp,
  Sparkles, BarChart3, Search, Inbox, Send, Check, RefreshCw, Hourglass,
  Smartphone, Copy, ChevronLeft, ChevronRight, ExternalLink, FileSignature,
  Anchor, ArrowDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface BlockInfo {
  hash: string;
  height: number;
  proposer: string;
  timestamp_ms: number;
  tx_count: number;
}
interface ChainStats {
  totalTxsWindow: number; windowSize: number;
  avgBlockTimeS: number; avgTps: number; currentTps: number;
  estimatedTotalTxs: number;
}
interface FeeBounds {
  min_fee_wei: string; max_fee_wei: string; recommended_fee_wei: string;
  min_usd?: number; max_usd?: number; source?: string;
}
interface VoteStats { height?: number; votes?: number; voting_power?: number; quorum?: number; }
interface ValidatorInfo {
  validators?: Array<{ address: string; voting_power: number }>;
  total_voting_power?: number; quorum?: number;
}
interface PriceInfo { zbx_usd: string; source: string; }
interface SupplyInfo {
  height: number; minted_wei: string; max_wei: string;
  current_block_reward_wei: string;
  burned_wei?: string; premine_wei?: string;
  pool_seed_wei?: string; pool_reserve_wei?: string;
  circulating_wei?: string;
}
interface PoolInfo {
  zbx_reserve_wei: string; zusd_reserve: string;
  lp_supply: string; spot_price_usd_per_zbx: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
const HISTORY_LEN = 60; // ring buffer size for sparklines

export default function LiveChain() {
  const [tip, setTip] = useState<BlockInfo | null>(null);
  const [recent, setRecent] = useState<BlockInfo[]>([]);
  const [fee, setFee] = useState<FeeBounds | null>(null);
  const [votes, setVotes] = useState<VoteStats | null>(null);
  const [vals, setVals] = useState<ValidatorInfo | null>(null);
  const [msCount, setMsCount] = useState<number | null>(null);
  const [payIdCount, setPayIdCount] = useState<number | null>(null);
  const [mempool, setMempool] = useState<{ size: number; max_size: number } | null>(null);
  const [mempoolUnsupported, setMempoolUnsupported] = useState(false);
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [supply, setSupply] = useState<SupplyInfo | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [stats, setStats] = useState<ChainStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flashHeight, setFlashHeight] = useState<number | null>(null);
  const [tab, setTab] = useState<"overview" | "blocks" | "validators" | "economy">("overview");

  // History ring buffers for sparklines
  const [tpsHist, setTpsHist] = useState<number[]>([]);
  const [blockTimeHist, setBlockTimeHist] = useState<number[]>([]);
  const [priceHist, setPriceHist] = useState<number[]>([]);
  const lastHeightRef = useRef<number>(0);

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

        // Flash effect on new block
        if (lastHeightRef.current && tipRes.height > lastHeightRef.current) {
          setFlashHeight(tipRes.height);
          setTimeout(() => mounted && setFlashHeight(null), 800);
        }
        lastHeightRef.current = tipRes.height;

        // Secondary fetches in parallel
        Promise.all([
          rpc<VoteStats>("zbx_voteStats").catch(() => null),
          rpc<ValidatorInfo>("zbx_listValidators").catch(() => null),
          rpc<{ total: number }>("zbx_multisigCount").catch(() => null),
          rpc<{ total: number }>("zbx_payIdCount").catch(() => null),
          rpc<PriceInfo>("zbx_getPriceUSD").catch(() => null),
          rpc<SupplyInfo>("zbx_supply").catch(() => null),
          rpc<PoolInfo>("zbx_getPool").catch(() => null),
          rpc<{ size: number; max_size: number }>("zbx_mempoolStatus").then(
            (r) => ({ ok: true as const, data: r }),
            (e) => ({ ok: false as const, err: String(e?.message || e) }),
          ),
        ]).then(([v, va, ms, pid, pr, sup, po, mp]) => {
          if (!mounted) return;
          if (v) setVotes(v);
          if (va) setVals(va);
          if (ms) setMsCount(ms.total);
          if (pid) setPayIdCount(pid.total);
          if (pr) {
            setPrice(pr);
            const p = parseFloat(pr.zbx_usd);
            if (isFinite(p)) setPriceHist((h) => pushBuf(h, p));
          }
          if (sup) setSupply(sup);
          if (po) setPool(po);
          if (mp.ok) {
            setMempool(mp.data);
            setMempoolUnsupported(false);
          } else if (/method not found|method.*not.*supported|not.*whitelisted/i.test(mp.err)) {
            setMempoolUnsupported(true);
          }
        });

        // Window of recent block heights, ordered NEWEST-FIRST so the
        // parent_hash chain (block H's hash = block H+1's parent_hash)
        // can be unrolled in one pass with no extra RPC calls.
        const WINDOW = 20;
        const heights: number[] = [];
        for (let i = 0; i < WINDOW; i++) {
          const h = tipRes.height - i;
          if (h >= 0) heights.push(h);
        }
        const rawBlocks = await Promise.all(
          heights.map((h) => rpc<any>("zbx_getBlockByNumber", [h]).catch(() => null)),
        );
        // Derive a real hash for each block: tip's hash comes straight from
        // zbx_blockNumber; every other block's hash is the next-newer block's
        // parent_hash (consensus invariant).
        const derivedHashes = deriveHashesFromChain(
          rawBlocks.map((r) => r ?? {}),
          tipRes.hash,
          tipRes.height,
        );
        const blocks: (BlockInfo | null)[] = rawBlocks.map((r, i) => {
          if (!r) return null;
          const hdr = r.header ?? r;
          const txs = Array.isArray(r.txs) ? r.txs : [];
          const h = hdr.height ?? heights[i];
          return {
            // Fall back to a synthetic key only if BOTH the derived hash AND
            // the (unlikely) inline hash are absent — keeps React keys stable.
            hash: derivedHashes[i] || r.hash || hdr.hash || `h${h}`,
            height: h,
            proposer: hdr.proposer ?? "",
            timestamp_ms: hdr.timestamp_ms ?? 0,
            tx_count: txs.length,
          } as BlockInfo;
        });
        const validBlocks = blocks.filter((b): b is BlockInfo => !!b);
        if (mounted) setRecent(validBlocks.slice(0, 15));

        if (validBlocks.length >= 2) {
          const sorted = [...validBlocks].sort((a, b) => a.height - b.height);
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
          const estimatedTotalTxs = Math.round(avgTps * tipRes.height * avgBlockTimeS);

          if (mounted) {
            setStats({ totalTxsWindow: totalTxs, windowSize: numBlocks, avgBlockTimeS, avgTps, currentTps, estimatedTotalTxs });
            setTpsHist((h) => pushBuf(h, currentTps));
            setBlockTimeHist((h) => pushBuf(h, avgBlockTimeS));
          }
        }
      } catch (e) {
        if (mounted) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    tick();
    timer = window.setInterval(tick, 5000);
    return () => { mounted = false; if (timer) clearInterval(timer); };
  }, []);

  const priceNum = price ? parseFloat(price.zbx_usd) : 0;

  // Derived supply numbers
  const supplyDerived = useMemo(() => {
    if (!supply) return null;
    const minted = bigSafe(supply.minted_wei);
    const premine = bigSafe(supply.premine_wei ?? "0");
    const poolSeed = bigSafe(supply.pool_seed_wei ?? "0");
    const burned = bigSafe(supply.burned_wei ?? "0");
    const max = bigSafe(supply.max_wei);
    const circulating = supply.circulating_wei
      ? bigSafe(supply.circulating_wei)
      : minted + premine + poolSeed - burned;
    const pct = max > 0n ? Number((circulating * 10000n) / max) / 100 : 0;
    return { minted, premine, poolSeed, burned, max, circulating, pct };
  }, [supply]);

  const marketCap = supplyDerived && priceNum
    ? weiToUsd(supplyDerived.circulating.toString(), priceNum) : 0;
  const fdvCap = supplyDerived && priceNum
    ? weiToUsd(supplyDerived.max.toString(), priceNum) : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* HERO */}
      <Hero
        tip={tip}
        flash={flashHeight === tip?.height}
        err={err}
        loading={loading}
        price={price}
        priceHist={priceHist}
        validatorCount={vals?.validators?.length ?? 0}
      />

      {/* ADDRESS SEARCH BAR */}
      <AddressSearch />

      {err && (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/5 text-sm flex gap-2 backdrop-blur">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-red-500 mb-1">RPC error</div>
            <code className="text-xs text-muted-foreground break-all">{err}</code>
          </div>
        </div>
      )}

      {/* KPI ROW */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={TrendingUp}
          tone="emerald"
          label="ZBX Price"
          value={price ? `$${formatPrice(parseFloat(price.zbx_usd))}` : "—"}
          sub={price?.source ?? ""}
          spark={priceHist}
        />
        <KpiCard
          icon={Coins}
          tone="violet"
          label="Market Cap"
          value={marketCap ? fmtUsd(marketCap) : "—"}
          sub={supplyDerived ? `${weiHexToZbx(supplyDerived.circulating.toString())} ZBX` : ""}
        />
        <KpiCard
          icon={Layers}
          tone="amber"
          label="FDV"
          value={fdvCap ? fmtUsd(fdvCap) : "—"}
          sub={supplyDerived ? `max ${weiHexToZbx(supplyDerived.max.toString())} ZBX` : ""}
        />
        <KpiCard
          icon={Box}
          tone="cyan"
          label="Block Height"
          value={tip ? `#${tip.height.toLocaleString()}` : "—"}
          sub={tip ? `proposer ${shortAddr(tip.proposer, 4, 4)}` : ""}
          flash={flashHeight === tip?.height}
        />
      </div>

      {/* TABS */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl border border-border bg-card/40 backdrop-blur w-fit">
        {(
          [
            ["overview", "Overview", Activity],
            ["blocks", "Blocks", Box],
            ["validators", "Validators", Users],
            ["economy", "Economy", Coins],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              tab === key
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          stats={stats}
          tpsHist={tpsHist}
          blockTimeHist={blockTimeHist}
          recent={recent}
          fee={fee}
          votes={votes}
          vals={vals}
          msCount={msCount}
          payIdCount={payIdCount}
          supply={supply}
          price={price}
          flashHeight={flashHeight}
          mempool={mempool}
          mempoolUnsupported={mempoolUnsupported}
        />
      )}
      {tab === "blocks" && <BlocksTab recent={recent} flashHeight={flashHeight} />}
      {tab === "validators" && <ValidatorsTab vals={vals} votes={votes} />}
      {tab === "economy" && (
        <EconomyTab supply={supply} pool={pool} price={price} supplyDerived={supplyDerived} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────────────────────
function Hero({
  tip, flash, err, loading, price, priceHist, validatorCount,
}: {
  tip: BlockInfo | null; flash: boolean; err: string | null; loading: boolean;
  price: PriceInfo | null; priceHist: number[]; validatorCount: number;
}) {
  const priceChangePct = useMemo(() => {
    if (priceHist.length < 2) return 0;
    const first = priceHist[0]; const last = priceHist[priceHist.length - 1];
    return first > 0 ? ((last - first) / first) * 100 : 0;
  }, [priceHist]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-violet-500/5 to-cyan-500/10 p-6">
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{
        background: "radial-gradient(circle at 80% 20%, rgba(124,58,237,.18), transparent 50%), radial-gradient(circle at 10% 90%, rgba(34,211,238,.12), transparent 50%)",
      }} />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge tone="emerald" pulse={!err}>
              <Wifi className="h-3 w-3" />
              {err ? "OFFLINE" : loading ? "CONNECTING" : "MAINNET LIVE"}
            </Badge>
            <Badge tone="violet"><Hash className="h-3 w-3" />chain_id 7878</Badge>
            <Badge tone="cyan"><ShieldCheck className="h-3 w-3" />{validatorCount} validators</Badge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground to-foreground/60 flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary" />
            Zebvix Live Chain
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            Real-time on-chain telemetry • auto-refresh every 5s • streaming blocks, validators, supply, AMM &amp; fees.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 min-w-[220px]">
          <div className={`text-5xl font-bold tabular-nums transition-all ${flash ? "text-emerald-400 scale-110" : "text-foreground"}`}>
            {tip ? `#${tip.height.toLocaleString()}` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">current block</div>
          {tip?.hash && (
            <div className="flex items-center gap-1.5 group">
              <code
                className="text-[11px] font-mono text-cyan-400/90 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-0.5"
                title={tip.hash}
                data-testid="text-hero-tip-hash"
              >
                {shortAddr(tip.hash, 8, 6)}
              </code>
              <CopyBtn value={tip.hash} label="tip hash" />
            </div>
          )}
          {price && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xl font-semibold tabular-nums">${formatPrice(parseFloat(price.zbx_usd))}</span>
              {priceChangePct !== 0 && (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${priceChangePct > 0 ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
                  {priceChangePct > 0 ? "▲" : "▼"} {Math.abs(priceChangePct).toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({
  stats, tpsHist, blockTimeHist, recent, fee, votes, vals, msCount, payIdCount,
  supply, price, flashHeight, mempool, mempoolUnsupported,
}: any) {
  const priceNum = price ? parseFloat(price.zbx_usd) : 0;
  return (
    <div className="space-y-4">
      {/* Performance row */}
      <div className="grid lg:grid-cols-3 gap-4">
        <ChartCard
          title="TPS (last 60 ticks)"
          icon={Gauge}
          big={stats ? stats.currentTps.toFixed(2) : "—"}
          small={stats ? `avg ${stats.avgTps.toFixed(2)}` : ""}
          data={tpsHist}
          color="#22d3ee"
          accent="cyan"
        />
        <ChartCard
          title="Avg Block Time"
          icon={Timer}
          big={stats ? `${stats.avgBlockTimeS.toFixed(2)}s` : "—"}
          small={stats ? `${(60 / stats.avgBlockTimeS).toFixed(1)} blocks/min` : ""}
          data={blockTimeHist}
          color="#a78bfa"
          accent="violet"
          inverted
        />
        <BlockRibbon recent={recent} flashHeight={flashHeight} />
      </div>

      {/* Counters row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MiniStat icon={ArrowLeftRight} label="Total Txs (est)" value={stats ? stats.estimatedTotalTxs.toLocaleString() : "—"} sub={stats ? `${stats.totalTxsWindow} in last ${stats.windowSize}` : ""} />
        <MiniStat
          icon={Hourglass}
          label="Mempool"
          value={
            mempoolUnsupported
              ? "n/a"
              : mempool
                ? mempool.size.toLocaleString()
                : "—"
          }
          sub={
            mempoolUnsupported
              ? "RPC not on this node"
              : mempool
                ? `pending · cap ${mempool.max_size.toLocaleString()}`
                : "loading…"
          }
        />
        <MiniStat icon={Users} label="Validators" value={vals?.validators?.length ?? "—"} sub={vals?.quorum ? `quorum ${vals.quorum}` : ""} />
        <MiniStat icon={Zap} label="Multisigs" value={msCount ?? "—"} />
        <MiniStat icon={Sparkles} label="Pay-IDs" value={payIdCount ?? "—"} />
      </div>

      {/* Fee + Vote panels */}
      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Live Fee (USD-pegged)" icon={Flame} accent="orange">
          {fee ? (
            <div className="space-y-2">
              <FeeBar fee={fee} />
              <div className="grid grid-cols-3 gap-2 text-xs pt-2">
                <FeePill label="Min" zbx={weiHexToZbx(fee.min_fee_wei)} usd={fee.min_usd} />
                <FeePill label="Recommended" zbx={weiHexToZbx(fee.recommended_fee_wei)} usd={
                  priceNum ? weiToUsd(fee.recommended_fee_wei, priceNum) : undefined
                } highlight />
                <FeePill label="Max" zbx={weiHexToZbx(fee.max_fee_wei)} usd={fee.max_usd} />
              </div>
              {fee.source && <div className="text-[10px] text-muted-foreground mt-1">source: <span className="font-mono">{fee.source}</span></div>}
            </div>
          ) : <Empty>loading fee bounds…</Empty>}
        </Panel>

        <Panel title="Tendermint Vote (B.2)" icon={ShieldCheck} accent="emerald">
          {votes ? (
            <div className="space-y-3">
              {votes.quorum && votes.voting_power !== undefined ? (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Voting power</span>
                    <span className="font-mono font-semibold text-emerald-400">{votes.voting_power} / {votes.quorum}</span>
                  </div>
                  <ProgressBar value={(votes.voting_power / votes.quorum) * 100} color="emerald" />
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2 text-xs">
                {votes.height !== undefined && <Cell label="Height" value={`#${votes.height}`} />}
                {votes.votes !== undefined && <Cell label="Votes" value={votes.votes} />}
                {votes.quorum !== undefined && <Cell label="Quorum" value={votes.quorum} />}
              </div>
            </div>
          ) : <Empty>no vote data</Empty>}
        </Panel>
      </div>

      {/* Quick send + Recent Transactions */}
      <QuickSendAndRecent tipHeight={recent[0]?.height ?? 0} />

      {/* Supply ring */}
      {supply && <SupplyOverview supply={supply} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKS TAB
// ─────────────────────────────────────────────────────────────────────────────
function BlocksTab({ recent, flashHeight }: { recent: BlockInfo[]; flashHeight: number | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <BlockRibbon recent={recent} flashHeight={flashHeight} large />
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Box className="h-4 w-4 text-primary" />Recent Blocks ({recent.length})</h2>
          <span className="text-[10px] text-muted-foreground">click row to expand</span>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              <th className="text-left p-2.5 font-medium w-20">Height</th>
              <th className="text-left p-2.5 font-medium">Proposer</th>
              <th className="text-left p-2.5 font-medium">Hash</th>
              <th className="text-right p-2.5 font-medium w-16">Txs</th>
              <th className="text-right p-2.5 font-medium w-24">Age</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">loading blocks…</td></tr>
            )}
            {recent.map((b) => {
              const isNew = flashHeight === b.height;
              const isExp = expanded === b.hash;
              return (
                <React.Fragment key={b.hash}>
                  <tr
                    onClick={() => setExpanded(isExp ? null : b.hash)}
                    className={`border-t border-border cursor-pointer transition ${isNew ? "bg-emerald-500/10" : "hover:bg-muted/30"}`}
                  >
                    <td className="p-2.5 font-mono text-primary font-semibold">
                      {isNew && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5 align-middle" />}
                      <WLink
                        href={explorerHref(b.height)}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline underline-offset-2"
                        data-testid={`link-blocks-height-${b.height}`}
                      >
                        #{b.height}
                      </WLink>
                    </td>
                    <td className="p-2.5 font-mono text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <ProposerAvatar addr={b.proposer} />
                        <WLink
                          href={explorerHref(b.proposer)}
                          onClick={(e) => e.stopPropagation()}
                          title={b.proposer}
                          className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
                          data-testid={`link-blocks-proposer-${b.height}`}
                        >
                          {shortAddr(b.proposer, 6, 4)}
                        </WLink>
                      </span>
                    </td>
                    <td className="p-2.5 font-mono">
                      <WLink
                        href={explorerHref(b.hash)}
                        onClick={(e) => e.stopPropagation()}
                        title={b.hash}
                        className="text-cyan-400/80 hover:text-cyan-300 hover:underline underline-offset-2"
                        data-testid={`link-blocks-hash-${b.height}`}
                      >
                        {shortAddr(b.hash, 8, 6)}
                      </WLink>
                    </td>
                    <td className="p-2.5 text-right font-mono">
                      <TxBadge n={b.tx_count} />
                    </td>
                    <td className="p-2.5 text-right text-muted-foreground tabular-nums">{ageStr(b.timestamp_ms)}</td>
                    <td className="p-2.5 text-muted-foreground">{isExp ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</td>
                  </tr>
                  {isExp && (
                    <tr className="bg-muted/20">
                      <td colSpan={6} className="p-3">
                        <div className="grid md:grid-cols-2 gap-3 text-xs">
                          <KV k="Full Hash" v={b.hash} mono />
                          <KV k="Full Proposer" v={b.proposer} mono />
                          <KV k="Timestamp" v={new Date(b.timestamp_ms).toISOString()} mono />
                          <KV k="Tx Count" v={b.tx_count.toString()} mono />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATORS TAB
// ─────────────────────────────────────────────────────────────────────────────
function ValidatorsTab({ vals, votes }: { vals: ValidatorInfo | null; votes: VoteStats | null }) {
  if (!vals?.validators) return <Empty>no validator data</Empty>;
  const total = vals.total_voting_power ?? vals.validators.reduce((s, v) => s + v.voting_power, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat icon={Users} label="Validator Set" value={vals.validators.length} />
        <MiniStat icon={ShieldCheck} label="Total Voting Power" value={total} />
        <MiniStat icon={Cpu} label="Quorum" value={vals.quorum ?? "—"} />
        <MiniStat icon={Activity} label="Active Votes" value={votes?.votes ?? "—"} sub={votes?.height ? `@ #${votes.height}` : ""} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {vals.validators.map((v, i) => {
          const sharePct = total > 0 ? (v.voting_power / total) * 100 : 0;
          return (
            <div key={v.address} className="p-4 rounded-xl border border-border bg-card hover:border-primary/40 transition group">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <ProposerAvatar addr={v.address} size={36} />
                  <div>
                    <div className="text-xs text-muted-foreground">Validator #{i + 1}</div>
                    <div className="font-mono text-xs font-semibold">{shortAddr(v.address, 6, 6)}</div>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded text-[10px] font-bold ${i === 0 ? "bg-amber-500/20 text-amber-400" : i === 1 ? "bg-zinc-400/20 text-zinc-300" : i === 2 ? "bg-orange-700/20 text-orange-400" : "bg-muted text-muted-foreground"}`}>
                  RANK {i + 1}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Voting Power</span>
                  <span className="font-mono font-semibold text-primary">{v.voting_power}</span>
                </div>
                <ProgressBar value={sharePct} color="violet" />
                <div className="text-[10px] text-right text-muted-foreground">{sharePct.toFixed(2)}% of total</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ECONOMY TAB
// ─────────────────────────────────────────────────────────────────────────────
function EconomyTab({ supply, pool, price, supplyDerived }: any) {
  const priceNum = price ? parseFloat(price.zbx_usd) : 0;
  return (
    <div className="space-y-4">
      {supply && <SupplyOverview supply={supply} />}

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="AMM Pool" icon={Droplet} accent="cyan">
          {pool ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Cell label="ZBX Reserve" value={`${weiHexToZbx(pool.zbx_reserve_wei)} ZBX`} />
                <Cell label="zUSD Reserve" value={`${weiHexToZbx(pool.zusd_reserve)} zUSD`} />
                <Cell label="LP Supply" value={weiHexToZbx(pool.lp_supply)} />
                <Cell label="Spot Price" value={`$${formatPrice(parseFloat(pool.spot_price_usd_per_zbx))}`} />
              </div>
              <PoolRatioBar zbx={pool.zbx_reserve_wei} zusd={pool.zusd_reserve} pricePerZbx={priceNum} />
            </div>
          ) : <Empty>pool data unavailable</Empty>}
        </Panel>

        <Panel title="Block Reward" icon={Coins} accent="amber">
          {supply ? (
            <div className="space-y-3">
              <div className="text-3xl font-bold tabular-nums text-amber-400">
                {weiHexToZbx(supply.current_block_reward_wei)} <span className="text-sm font-normal text-muted-foreground">ZBX</span>
              </div>
              {priceNum > 0 && (
                <div className="text-sm text-muted-foreground">
                  ≈ <span className="font-mono text-foreground">{fmtUsd(weiToUsd(supply.current_block_reward_wei, priceNum))}</span> per block
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                <Cell label="Height" value={`#${supply.height.toLocaleString()}`} />
                <Cell label="Minted" value={`${weiHexToZbx(supply.minted_wei)} ZBX`} />
              </div>
            </div>
          ) : <Empty>—</Empty>}
        </Panel>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon, tone, label, value, sub, spark, flash,
}: {
  icon: React.ElementType; tone: "emerald" | "violet" | "amber" | "cyan";
  label: string; value: React.ReactNode; sub?: string; spark?: number[]; flash?: boolean;
}) {
  const toneCls = {
    emerald: "from-emerald-500/15 to-transparent border-emerald-500/30 text-emerald-400",
    violet: "from-violet-500/15 to-transparent border-violet-500/30 text-violet-400",
    amber: "from-amber-500/15 to-transparent border-amber-500/30 text-amber-400",
    cyan: "from-cyan-500/15 to-transparent border-cyan-500/30 text-cyan-400",
  }[tone];
  return (
    <div className={`relative overflow-hidden p-4 rounded-xl border bg-gradient-to-br ${toneCls} ${flash ? "ring-2 ring-emerald-400/60" : ""} transition-all`}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      {spark && spark.length > 1 && (
        <div className="absolute right-2 bottom-2 opacity-60">
          <Sparkline data={spark} width={56} height={20} color="currentColor" />
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: React.ReactNode; sub?: string; }) {
  return (
    <div className="p-3 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, icon: Icon, big, small, data, color, accent, inverted }: {
  title: string; icon: React.ElementType; big: string; small?: string;
  data: number[]; color: string; accent: "cyan" | "violet" | "emerald"; inverted?: boolean;
}) {
  const accentBg = {
    cyan: "from-cyan-500/10",
    violet: "from-violet-500/10",
    emerald: "from-emerald-500/10",
  }[accent];
  return (
    <div className={`relative overflow-hidden p-4 rounded-xl border border-border bg-gradient-to-br ${accentBg} to-card`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{title}</div>
        <BarChart3 className="h-3 w-3 text-muted-foreground/40" />
      </div>
      <div className="text-3xl font-bold tabular-nums">{big}</div>
      {small && <div className="text-[11px] text-muted-foreground">{small}</div>}
      <div className="mt-2">
        <Sparkline data={data} width={280} height={48} color={color} fill inverted={inverted} />
      </div>
    </div>
  );
}

function BlockRibbon({ recent, flashHeight, large }: { recent: BlockInfo[]; flashHeight: number | null; large?: boolean }) {
  const display = recent.slice(0, large ? 30 : 15).reverse();
  const maxTx = Math.max(1, ...display.map((b) => b.tx_count));
  return (
    <div className={`p-4 rounded-xl border border-border bg-card ${large ? "" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Box className="h-3.5 w-3.5" />Recent Blocks</div>
        <span className="text-[10px] text-muted-foreground">tx volume</span>
      </div>
      <div className="flex items-end gap-1 h-24">
        {display.length === 0 && <div className="text-xs text-muted-foreground self-center mx-auto">…</div>}
        {display.map((b) => {
          const h = Math.max(8, (b.tx_count / maxTx) * 100);
          const isNew = flashHeight === b.height;
          return (
            <div
              key={b.hash}
              className="flex-1 group relative cursor-default"
              title={`#${b.height} • ${b.tx_count} txs`}
            >
              <div
                className={`w-full rounded-t transition-all ${
                  b.tx_count === 0 ? "bg-muted-foreground/20"
                  : b.tx_count < 5 ? "bg-cyan-500/60"
                  : b.tx_count < 20 ? "bg-violet-500/70"
                  : "bg-amber-500/80"
                } ${isNew ? "ring-2 ring-emerald-400 animate-pulse" : ""} group-hover:opacity-80`}
                style={{ height: `${h}%` }}
              />
              {large && (
                <div className="text-[9px] text-center text-muted-foreground mt-1 font-mono truncate">#{b.height % 1000}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({ data, width, height, color, fill, inverted }: {
  data: number[]; width: number; height: number; color: string; fill?: boolean; inverted?: boolean;
}) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data); const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const norm = (v - min) / range;
    const y = inverted ? norm * height : height - norm * height;
    return [x, y];
  });
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const id = `g-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
      )}
    </svg>
  );
}

function SupplyOverview({ supply }: { supply: SupplyInfo }) {
  const minted = bigSafe(supply.minted_wei);
  const premine = bigSafe(supply.premine_wei ?? "0");
  const poolSeed = bigSafe(supply.pool_seed_wei ?? "0");
  const burned = bigSafe(supply.burned_wei ?? "0");
  const max = bigSafe(supply.max_wei);
  const circulating = supply.circulating_wei
    ? bigSafe(supply.circulating_wei)
    : minted + premine + poolSeed - burned;
  const pct = max > 0n ? Number((circulating * 10000n) / max) / 100 : 0;
  const mintedPct = max > 0n ? Number((minted * 10000n) / max) / 100 : 0;

  return (
    <Panel title="Supply Overview" icon={Coins} accent="violet">
      <div className="grid md:grid-cols-[160px_1fr] gap-6 items-center">
        <div className="flex justify-center">
          <SupplyRing pct={pct} label={`${pct.toFixed(2)}%`} sub="circulating" />
        </div>
        <div className="space-y-2">
          <SupplyRow label="Max Supply" value={`${weiHexToZbx(max.toString())} ZBX`} bold />
          <SupplyRow label="Mined (rewards)" value={`${weiHexToZbx(minted.toString())} ZBX`} pct={mintedPct} />
          {poolSeed > 0n && <SupplyRow label="AMM Pool Seed" value={`+${weiHexToZbx(poolSeed.toString())} ZBX`} accent="cyan" />}
          {premine > 0n && <SupplyRow label="Founder Premine" value={`+${weiHexToZbx(premine.toString())} ZBX`} accent="amber" />}
          {burned > 0n && <SupplyRow label="Burned 🔥" value={`-${weiHexToZbx(burned.toString())} ZBX`} accent="red" />}
          <div className="border-t border-border pt-2">
            <SupplyRow label="Circulating" value={`${weiHexToZbx(circulating.toString())} ZBX`} bold accent="emerald" />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SupplyRing({ pct, label, sub }: { pct: number; label: string; sub: string }) {
  const r = 56; const c = 2 * Math.PI * r;
  const dash = (Math.min(100, pct) / 100) * c;
  return (
    <svg width={140} height={140} viewBox="0 0 140 140">
      <circle cx={70} cy={70} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={10} />
      <defs>
        <linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <circle
        cx={70} cy={70} r={r} fill="none" stroke="url(#ringg)" strokeWidth={10}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x={70} y={70} textAnchor="middle" dominantBaseline="middle" className="fill-foreground font-bold" fontSize="20">{label}</text>
      <text x={70} y={92} textAnchor="middle" className="fill-muted-foreground" fontSize="10">{sub}</text>
    </svg>
  );
}

function SupplyRow({ label, value, pct, bold, accent }: { label: string; value: string; pct?: number; bold?: boolean; accent?: "emerald" | "cyan" | "amber" | "red" }) {
  const accentCls = accent ? {
    emerald: "text-emerald-400", cyan: "text-cyan-400", amber: "text-amber-400", red: "text-red-400",
  }[accent] : "";
  return (
    <div>
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono ${bold ? "font-bold" : ""} ${accentCls}`}>{value}</span>
      </div>
      {pct !== undefined && <ProgressBar value={pct} color="violet" small />}
    </div>
  );
}

function PoolRatioBar({ zbx, zusd, pricePerZbx }: { zbx: string; zusd: string; pricePerZbx: number }) {
  const zbxUsd = pricePerZbx ? weiToUsd(zbx, pricePerZbx) : 0;
  const zusdUsd = (() => { try { return Number(BigInt(zusd) / 10n ** 18n); } catch { return 0; } })();
  const total = zbxUsd + zusdUsd;
  const zbxPct = total > 0 ? (zbxUsd / total) * 100 : 50;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>ZBX side ({fmtUsd(zbxUsd)})</span>
        <span>zUSD side ({fmtUsd(zusdUsd)})</span>
      </div>
      <div className="flex h-2 rounded overflow-hidden bg-muted">
        <div className="bg-cyan-500" style={{ width: `${zbxPct}%` }} />
        <div className="bg-emerald-500" style={{ width: `${100 - zbxPct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{zbxPct.toFixed(1)}%</span>
        <span>{(100 - zbxPct).toFixed(1)}%</span>
      </div>
    </div>
  );
}

function FeeBar({ fee }: { fee: FeeBounds }) {
  try {
    const min = BigInt(fee.min_fee_wei); const max = BigInt(fee.max_fee_wei);
    const rec = BigInt(fee.recommended_fee_wei);
    const range = max - min;
    const pct = range > 0n ? Number(((rec - min) * 10000n) / range) / 100 : 50;
    return (
      <div className="relative h-2 rounded bg-gradient-to-r from-emerald-500/30 via-amber-500/30 to-red-500/30">
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 ring-2 ring-background shadow"
          style={{ left: `calc(${Math.max(0, Math.min(100, pct))}% - 6px)` }} />
      </div>
    );
  } catch { return null; }
}

function FeePill({ label, zbx, usd, highlight }: { label: string; zbx: string; usd?: number | string; highlight?: boolean }) {
  const usdNum = usd === undefined || usd === null ? undefined : (typeof usd === "number" ? usd : parseFloat(String(usd)));
  const showUsd = usdNum !== undefined && isFinite(usdNum);
  return (
    <div className={`p-2 rounded ${highlight ? "bg-amber-500/10 border border-amber-500/30" : "bg-muted/40"}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono text-xs ${highlight ? "text-amber-400 font-semibold" : ""}`}>{zbx}</div>
      {showUsd && <div className="text-[10px] text-muted-foreground">{usdNum! < 0.01 ? `$${usdNum!.toFixed(6).replace(/0+$/,'').replace(/\.$/,'')}` : fmtUsd(usdNum!)}</div>}
    </div>
  );
}

function ProgressBar({ value, color, small }: { value: number; color: "emerald" | "violet" | "cyan" | "amber"; small?: boolean }) {
  const cls = { emerald: "bg-emerald-500", violet: "bg-violet-500", cyan: "bg-cyan-500", amber: "bg-amber-500" }[color];
  return (
    <div className={`w-full ${small ? "h-1" : "h-1.5"} bg-muted rounded overflow-hidden`}>
      <div className={`h-full ${cls} transition-all`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function Panel({ title, icon: Icon, accent, children }: { title: string; icon: React.ElementType; accent: "orange" | "emerald" | "cyan" | "violet" | "amber"; children: React.ReactNode }) {
  const accentCls = {
    orange: "text-orange-400", emerald: "text-emerald-400", cyan: "text-cyan-400", violet: "text-violet-400", amber: "text-amber-400",
  }[accent];
  return (
    <div className="p-4 rounded-xl border border-border bg-card space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accentCls}`} />
        {title}
      </h2>
      {children}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-2 rounded bg-muted/30">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</div>
      <div className={`text-xs ${mono ? "font-mono" : ""} break-all`}>{v}</div>
    </div>
  );
}

function Badge({ tone, pulse, children }: { tone: "emerald" | "violet" | "cyan"; pulse?: boolean; children: React.ReactNode }) {
  const cls = {
    emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    violet: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {children}
    </span>
  );
}

function TxBadge({ n }: { n: number }) {
  if (n === 0) return <span className="text-muted-foreground">0</span>;
  const cls = n < 5 ? "bg-cyan-500/15 text-cyan-400" : n < 20 ? "bg-violet-500/15 text-violet-400" : "bg-amber-500/15 text-amber-400";
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${cls}`}>{n}</span>;
}

function ProposerAvatar({ addr, size = 18 }: { addr: string; size?: number }) {
  // Simple deterministic colored gradient avatar from address
  if (!addr) return <div style={{ width: size, height: size }} className="rounded-full bg-muted" />;
  const h1 = simpleHash(addr) % 360;
  const h2 = (h1 + 60) % 360;
  return (
    <div
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, hsl(${h1} 70% 55%), hsl(${h2} 70% 45%))`,
      }}
      className="rounded-full ring-1 ring-border shrink-0"
    />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-muted-foreground py-2">{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Search — supports block numbers, addresses, hashes
// ─────────────────────────────────────────────────────────────────────────────
type Classified =
  | { kind: "block"; value: number }
  | { kind: "address"; value: string }
  | { kind: "hash"; value: string }
  | { kind: "empty" }
  | { kind: "invalid"; reason: string };

export function classifyInput(raw: string): Classified {
  const s = raw.trim();
  if (!s) return { kind: "empty" };
  // Pure number → block height
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (!isFinite(n) || n < 0) return { kind: "invalid", reason: "block height must be a non-negative integer" };
    if (n > 1e12) return { kind: "invalid", reason: "block height too large" };
    return { kind: "block", value: n };
  }
  // Hex strings
  if (/^0x[0-9a-fA-F]+$/.test(s)) {
    const hex = s.slice(2);
    if (hex.length === 40) return { kind: "address", value: s.toLowerCase() };
    if (hex.length === 64) return { kind: "hash", value: s.toLowerCase() };
    return { kind: "invalid", reason: `expected 40 hex chars (address) or 64 hex chars (hash) after 0x — got ${hex.length}` };
  }
  if (/^[0-9a-fA-F]{40}$/.test(s)) return { kind: "address", value: "0x" + s.toLowerCase() };
  if (/^[0-9a-fA-F]{64}$/.test(s)) return { kind: "hash", value: "0x" + s.toLowerCase() };
  return { kind: "invalid", reason: "not a block number, address (0x + 40 hex), or hash (0x + 64 hex)" };
}

function AddressSearch() {
  const [, setLoc] = useLocation();
  const [val, setVal] = useState("");
  const [blockResult, setBlockResult] = useState<any | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockErr, setBlockErr] = useState<string | null>(null);

  const cls = classifyInput(val);
  const isInvalid = cls.kind === "invalid";

  async function submit() {
    setBlockResult(null);
    setBlockErr(null);
    const c = classifyInput(val);
    if (c.kind === "empty" || c.kind === "invalid") return;
    if (c.kind === "address") {
      setLoc(`/balance-lookup?addr=${encodeURIComponent(c.value)}`);
      return;
    }
    if (c.kind === "block") {
      setBlockLoading(true);
      try {
        // Derive the canonical block hash by also fetching block H+1
        // (its parent_hash == block H's hash). For the tip block (no H+1),
        // fall back to zbx_blockNumber's own hash field.
        const { block, hash, tipHeight } = await fetchBlockWithDerivedHash(c.value);
        if (!block) setBlockErr(`block #${c.value} not found`);
        else setBlockResult({ ...block, _height: c.value, _hash: hash, _tipHeight: tipHeight });
      } catch (e) {
        setBlockErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBlockLoading(false);
      }
      return;
    }
    if (c.kind === "hash") {
      // Look up a block by its hash by walking the recent-block window and
      // matching against the *derived* hash (block H's hash = block H+1's
      // parent_hash). This is the only way given the chain currently doesn't
      // expose a `getBlockByHash` RPC for native blocks.
      setBlockLoading(true);
      setBlockErr(null);
      try {
        const tip = await rpc<{ height: number; hash: string }>("zbx_blockNumber");
        const W = 500;
        // Fetch newest-first batch (also fetch tip+0 so the chain head's
        // hash comes from the tip RPC, not parent_hash of a non-existent
        // block above it).
        const heights: number[] = [];
        for (let i = 0; i < W; i++) {
          const h = tip.height - i;
          if (h < 0) break;
          heights.push(h);
        }
        const rawBlocks = await Promise.all(
          heights.map((h) => rpc<any>("zbx_getBlockByNumber", [h]).catch(() => null)),
        );
        const derived = deriveHashesFromChain(
          rawBlocks.map((r) => r ?? {}),
          tip.hash,
          tip.height,
        );
        let hitIdx = -1;
        for (let i = 0; i < derived.length; i++) {
          if (derived[i] && derived[i].toLowerCase() === c.value) { hitIdx = i; break; }
        }
        if (hitIdx >= 0 && rawBlocks[hitIdx]) {
          const hit = rawBlocks[hitIdx];
          setBlockResult({ ...hit, _height: hit.header?.height ?? heights[hitIdx], _hash: derived[hitIdx], _tipHeight: tip.height });
        } else {
          setBlockErr(`block hash ${shortAddr(c.value, 8, 6)} not found in last ${W} blocks. If this is a tx hash, paste it into the Block Explorer instead.`);
        }
      } catch (e) {
        setBlockErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBlockLoading(false);
      }
    }
  }

  // Allow BlockResultCard's prev/next nav to swap in another block without
  // closing the card. Same derivation path as the search button.
  async function navigateToBlock(height: number) {
    if (height < 0) return;
    setBlockLoading(true);
    setBlockErr(null);
    try {
      const { block, hash, tipHeight } = await fetchBlockWithDerivedHash(height);
      if (!block) setBlockErr(`block #${height} not found`);
      else {
        setBlockResult({ ...block, _height: height, _hash: hash, _tipHeight: tipHeight });
        setVal(String(height));
      }
    } catch (e) {
      setBlockErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBlockLoading(false);
    }
  }

  const hint = (() => {
    switch (cls.kind) {
      case "empty": return "";
      case "block": return `Block #${cls.value}`;
      case "address": return "Address";
      case "hash": return "Hash (block / tx)";
      case "invalid": return cls.reason;
    }
  })();
  const hintTone = isInvalid ? "text-red-400" :
    cls.kind === "block" ? "text-cyan-400" :
    cls.kind === "address" ? "text-emerald-400" :
    cls.kind === "hash" ? "text-violet-400" : "text-muted-foreground";

  return (
    <div className="space-y-2">
      <div className={`rounded-xl border p-3 flex items-center gap-2 transition ${isInvalid ? "border-red-500/40 bg-red-500/5" : "border-border bg-gradient-to-r from-card via-card to-primary/5"}`}>
        <Search className={`h-4 w-4 shrink-0 ml-1 ${isInvalid ? "text-red-400" : "text-primary"}`} />
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Search block number, address (0x + 40 hex), or hash (0x + 64 hex)"
          className="flex-1 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/60"
        />
        {hint && (
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${hintTone} ${isInvalid ? "bg-red-500/10" : "bg-muted/50"}`}>
            {hint}
          </span>
        )}
        <button
          onClick={submit}
          disabled={cls.kind === "empty" || isInvalid || blockLoading}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 hover:bg-primary/90 transition flex items-center gap-1"
        >
          {blockLoading ? "…" : "Search"} <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>

      {blockErr && (
        <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/5 text-xs flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <span className="text-red-300">{blockErr}</span>
        </div>
      )}

      {blockResult && (
        <BlockResultCard
          block={blockResult}
          onClose={() => { setBlockResult(null); setBlockErr(null); }}
          onNavigate={navigateToBlock}
          loading={blockLoading}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BlockResultCard — Etherscan-style full block detail panel.
// Renders all header fields with copy buttons, computes total ZBX moved /
// total fees burned across the block, gives prev/next block navigation,
// and a one-click "Open in Block Explorer" deep link.
// ─────────────────────────────────────────────────────────────────────────────
function BlockResultCard({
  block, onClose, onNavigate, loading,
}: {
  block: any;
  onClose: () => void;
  onNavigate: (h: number) => void;
  loading: boolean;
}) {
  const hdr = block.header ?? block;
  const height: number = hdr.height ?? block._height ?? 0;
  // Prefer the derived hash (set by the search/nav handlers) — `block.hash`
  // was historically empty because the chain's Block JSON has no hash field.
  const hash: string = block._hash || block.hash || hdr.hash || "";
  const tipHeight: number = block._tipHeight ?? 0;
  const txs: any[] = Array.isArray(block.txs) ? block.txs : [];
  const isTip = tipHeight > 0 && height >= tipHeight;
  const canPrev = height > 0;
  const canNext = !isTip;

  // Aggregate ZBX moved and fees paid in this block.
  const totals = useMemo(() => {
    let amtWei = 0n;
    let feeWei = 0n;
    let withAmount = 0;
    for (const t of txs) {
      const b = t.body ?? t;
      try {
        if (b.amount) { amtWei += BigInt(String(b.amount)); withAmount++; }
        if (b.fee) feeWei += BigInt(String(b.fee));
      } catch { /* skip malformed */ }
    }
    return { amtWei: amtWei.toString(), feeWei: feeWei.toString(), withAmount };
  }, [txs]);

  // 64-byte secp256k1 sig over header bytes (proposer signature).
  const sigHex: string = useMemo(() => {
    const s = block.signature;
    if (!s) return "";
    if (typeof s === "string") return s.startsWith("0x") ? s : `0x${s}`;
    if (Array.isArray(s)) {
      try { return "0x" + s.map((n: number) => n.toString(16).padStart(2, "0")).join(""); }
      catch { return ""; }
    }
    return "";
  }, [block.signature]);

  return (
    <div className="rounded-xl border border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 via-card to-transparent overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Header strip */}
      <div className="p-4 border-b border-cyan-500/20 flex items-center justify-between gap-3 flex-wrap bg-cyan-500/5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
            <Box className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-cyan-300/80 font-semibold flex items-center gap-2">
              Block detail
              {isTip && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">CHAIN TIP</span>}
            </div>
            <h3 className="text-xl font-bold tabular-nums">
              #{height.toLocaleString()}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {txs.length} tx{txs.length === 1 ? "" : "s"} · {ageStr(hdr.timestamp_ms ?? 0)}
              </span>
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => canPrev && onNavigate(height - 1)}
            disabled={!canPrev || loading}
            className="px-2 py-1.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="button-block-prev"
            title="Previous block"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <button
            type="button"
            onClick={() => canNext && onNavigate(height + 1)}
            disabled={!canNext || loading}
            className="px-2 py-1.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="button-block-next"
            title="Next block"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <WLink
            href={explorerHref(height)}
            className="px-2 py-1.5 rounded-md bg-primary/15 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/25 flex items-center gap-1"
            data-testid="link-block-explorer"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Explorer
          </WLink>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
            aria-label="close"
            data-testid="button-block-close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Quick-stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        <BlockStat label="Transactions" value={txs.length.toString()} icon={ArrowLeftRight} />
        <BlockStat label="Total ZBX moved" value={`${weiHexToZbx(totals.amtWei)} ZBX`} icon={TrendingUp} sub={`${totals.withAmount} of ${txs.length} carry value`} />
        <BlockStat label="Total fees" value={`${weiHexToZbx(totals.feeWei)} ZBX`} icon={Flame} accent="amber" />
        <BlockStat label="Block time" value={hdr.timestamp_ms ? new Date(hdr.timestamp_ms).toLocaleTimeString() : "—"} icon={Clock} sub={hdr.timestamp_ms ? new Date(hdr.timestamp_ms).toISOString().slice(0, 10) : ""} />
      </div>

      {/* Detail rows — each with copy + (where useful) deep link. */}
      <div className="divide-y divide-border">
        <DetailRow icon={Hash} label="Hash" value={hash || "—"} mono accent="cyan" copy />
        <DetailRow
          icon={Anchor}
          label="Parent hash"
          value={hdr.parent_hash ?? "—"}
          mono
          copy
          link={canPrev && hdr.parent_hash ? { href: "#prev-block", onClick: () => onNavigate(height - 1), label: "open prev" } : undefined}
        />
        <DetailRow
          icon={Users}
          label="Proposer"
          value={hdr.proposer ?? "—"}
          mono
          accent="violet"
          copy
          link={hdr.proposer ? { href: explorerHref(hdr.proposer), label: "view address" } : undefined}
        />
        <DetailRow icon={Layers} label="State root" value={hdr.state_root ?? "—"} mono copy />
        <DetailRow icon={ArrowDown} label="Tx root" value={hdr.tx_root ?? "—"} mono copy />
        <DetailRow
          icon={Clock}
          label="Timestamp"
          value={hdr.timestamp_ms
            ? `${new Date(hdr.timestamp_ms).toISOString()}  (${ageStr(hdr.timestamp_ms)})`
            : "—"}
        />
        {sigHex && (
          <DetailRow
            icon={FileSignature}
            label="Signature"
            value={`${sigHex.slice(0, 22)}…${sigHex.slice(-12)}  (64 B secp256k1)`}
            mono
            copy
            copyValue={sigHex}
          />
        )}
      </div>

      {/* Tx table */}
      {txs.length > 0 ? (
        <div className="border-t border-border">
          <div className="p-3 bg-muted/30 text-xs font-semibold flex items-center gap-2">
            <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
            Transactions ({txs.length})
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/20 text-muted-foreground sticky top-0 backdrop-blur">
                <tr>
                  <th className="text-left p-2 w-8 font-medium">#</th>
                  <th className="text-left p-2 w-24 font-medium">Kind</th>
                  <th className="text-left p-2 font-medium">From</th>
                  <th className="text-left p-2 font-medium">To</th>
                  <th className="text-right p-2 font-medium">Amount</th>
                  <th className="text-right p-2 font-medium">Fee</th>
                  <th className="text-right p-2 w-16 font-medium">Nonce</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t: any, i: number) => {
                  const b = t.body ?? t;
                  const txHash = String(t.hash ?? t.tx_hash ?? "");
                  return (
                    <tr key={txHash || i} className="border-t border-border hover:bg-muted/20" data-testid={`row-block-tx-${i}`}>
                      <td className="p-2 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="p-2"><KindBadge kind={kindLabel(b.kind)} /></td>
                      <td className="p-2 font-mono">
                        {b.from
                          ? <WLink href={explorerHref(b.from)} title={b.from} className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2">{shortAddr(b.from, 6, 4)}</WLink>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 font-mono">
                        {b.to
                          ? <WLink href={explorerHref(b.to)} title={b.to} className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2">{shortAddr(b.to, 6, 4)}</WLink>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {b.amount ? <span className="text-foreground">{weiHexToZbx(String(b.amount))}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-right font-mono text-amber-400">{weiHexToZbx(String(b.fee ?? "0"))}</td>
                      <td className="p-2 text-right font-mono text-muted-foreground tabular-nums">{b.nonce !== undefined ? String(b.nonce) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="border-t border-border p-6 text-center text-xs text-muted-foreground">
          <Inbox className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/30" />
          empty block — no transactions
        </div>
      )}
    </div>
  );
}

// Compact stat tile used in the BlockResultCard quick-stat strip.
function BlockStat({
  label, value, sub, icon: Icon, accent = "cyan",
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; accent?: "cyan" | "amber" | "emerald" | "violet";
}) {
  const tone = {
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
    violet: "text-violet-400",
  }[accent];
  return (
    <div className="p-3 bg-card/60 backdrop-blur">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        <Icon className={`h-3 w-3 ${tone}`} />
        {label}
      </div>
      <div className="text-sm font-bold tabular-nums truncate" title={value}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground truncate" title={sub}>{sub}</div>}
    </div>
  );
}

// Etherscan-style label/value row with optional copy button + deep link.
function DetailRow({
  icon: Icon, label, value, mono, copy, copyValue, accent, link,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
  copyValue?: string;
  accent?: "cyan" | "violet";
  link?: { href: string; label: string; onClick?: () => void };
}) {
  const tone = accent === "cyan" ? "text-cyan-400" : accent === "violet" ? "text-violet-400" : "text-foreground";
  return (
    <div className="px-4 py-2.5 flex items-start gap-3 hover:bg-muted/10 transition">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground w-32 shrink-0 pt-0.5">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <code className={`text-xs ${mono ? "font-mono" : ""} ${tone} break-all`} data-testid={`text-block-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </code>
        {copy && value && value !== "—" && <CopyBtn value={copyValue ?? value} label={label} />}
        {link && (
          link.onClick ? (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); link.onClick!(); }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70 shrink-0 inline-flex items-center gap-0.5"
            >
              {link.label} <ArrowUpRight className="h-2.5 w-2.5" />
            </button>
          ) : (
            <WLink
              href={link.href}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70 shrink-0 inline-flex items-center gap-0.5"
            >
              {link.label} <ArrowUpRight className="h-2.5 w-2.5" />
            </WLink>
          )
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RecentTxsPanel — scans last N blocks for any non-empty txs and lists them
// ─────────────────────────────────────────────────────────────────────────────
interface OnchainTx {
  height: number;
  ts: number;
  from: string;
  to: string;
  amount_wei: string;
  fee_wei: string;
  kind: string;
  // Tx hash (32-byte 0x-prefixed). Available on the fast `zbx_recentTxs`
  // path; the legacy block-scan fallback synthesizes it from the SignedTx
  // payload when present, or leaves it empty otherwise. Used to deep-link
  // each row's hash → block-explorer Tx Detail page.
  hash: string;
}

// Build a `/block-explorer?q=<value>` URL that the existing DetailRouter
// auto-resolves (it accepts block heights, block hashes, tx hashes, and
// addresses interchangeably via `detectQueryKind`).
function explorerHref(q: string | number): string {
  const v = typeof q === "number" ? String(q) : q;
  return `/block-explorer?q=${encodeURIComponent(v)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Block-hash derivation
//
// The chain's `Block` JSON shape is `{ header, txs, signature }` — there is
// no `hash` field on the block envelope. The only places where a fully-
// formed block hash is exposed by RPC are:
//   1) `zbx_blockNumber` — returns the *tip* block's hash directly.
//   2) Any block H+1's `header.parent_hash` — equals block H's hash by
//      definition (consensus invariant).
//
// So to know the hash of an arbitrary historical block at height H, we
// fetch H+1 and read its parent_hash. For a contiguous window of recent
// blocks fetched in one batch (e.g. tip..tip-N), every block except the
// oldest has its hash inside the next-newer block's header — meaning we
// can fill in N+1 hashes from N+1 RPC calls (no extra round trips).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given an array of blocks ordered NEWEST-FIRST (idx 0 = highest height),
 * along with the known tip hash from `zbx_blockNumber`, return a parallel
 * array of derived block hashes. Hash at index i is read from the parent_hash
 * of the block at index i-1 (i.e. the next-newer block). Index 0 (the
 * newest block in the window) takes its hash from the supplied tipHash if
 * its height matches `tipHeight`; otherwise we fetch height+1 separately.
 */
function deriveHashesFromChain(
  blocksNewestFirst: Array<{ header?: { parent_hash?: string; height?: number }; height?: number }>,
  tipHash: string | undefined,
  tipHeight: number,
): string[] {
  const out: string[] = new Array(blocksNewestFirst.length).fill("");
  for (let i = 0; i < blocksNewestFirst.length; i++) {
    const b = blocksNewestFirst[i];
    const h = b.header?.height ?? b.height ?? 0;
    if (h === tipHeight && tipHash) {
      out[i] = tipHash;
      continue;
    }
    // Otherwise, the next-newer block in our window (i-1) carries
    // this block's hash as its parent_hash.
    if (i > 0) {
      const newer = blocksNewestFirst[i - 1];
      out[i] = newer.header?.parent_hash ?? "";
    }
  }
  return out;
}

/**
 * For a single arbitrary height H, fetch block H AND block H+1 in parallel,
 * then derive H's hash from H+1's parent_hash. If H is the tip (no H+1),
 * fetch the tip RPC for the hash.
 */
async function fetchBlockWithDerivedHash(height: number): Promise<{ block: any | null; hash: string; tipHeight: number }> {
  const [self, next, tip] = await Promise.all([
    rpc<any>("zbx_getBlockByNumber", [height]).catch(() => null),
    rpc<any>("zbx_getBlockByNumber", [height + 1]).catch(() => null),
    rpc<{ height: number; hash: string }>("zbx_blockNumber").catch(() => null),
  ]);
  if (!self) return { block: null, hash: "", tipHeight: tip?.height ?? 0 };
  let hash = "";
  if (next?.header?.parent_hash) {
    hash = String(next.header.parent_hash);
  } else if (tip && tip.height === height && tip.hash) {
    // Block H is the tip — use the tip RPC's hash directly.
    hash = String(tip.hash);
  }
  return { block: self, hash, tipHeight: tip?.height ?? height };
}

/**
 * Tiny clipboard-copy button used inside expanded block detail / search
 * result cards. Shows a transient checkmark on success; falls back to a
 * toast otherwise. Stops click propagation so it never collapses the row
 * it is rendered inside.
 */
function CopyBtn({ value, label, className = "" }: { value: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  const { toast } = useToast();
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(
          () => {
            setOk(true);
            window.setTimeout(() => setOk(false), 1200);
            toast({ title: `Copied${label ? ` ${label}` : ""}`, duration: 1500 });
          },
          () => toast({ title: "Copy failed", variant: "destructive" }),
        );
      }}
      className={`inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition shrink-0 ${className}`}
      title={`Copy${label ? ` ${label}` : ""}`}
      aria-label={`Copy${label ? ` ${label}` : ""}`}
      data-testid={`button-copy${label ? `-${label.toLowerCase().replace(/\s+/g, "-")}` : ""}`}
    >
      {ok ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

const TARGET_TX_COUNT = 15;
const MAX_SCAN_BLOCKS = 100_000; // 1 lakh blocks ka safety cap
const CHUNK_SIZE = 200;
const CONCURRENCY = 12;

function RecentTxsPanel({
  tipHeight,
  refreshKey = 0,
}: {
  tipHeight: number;
  refreshKey?: number;
}) {
  const [scanning, setScanning] = useState(false);
  const [scannedRange, setScannedRange] = useState(0);
  const [txs, setTxs] = useState<OnchainTx[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [autoScanned, setAutoScanned] = useState(false);
  const [completed, setCompleted] = useState(false);
  // Phase B.9 — when the chain serves zbx_recentTxs (on-chain index),
  // we use that fast path instead of block-scanning. This flag tells the
  // UI which mode produced the current results so we can label correctly.
  const [source, setSource] = useState<"index" | "scan" | null>(null);
  const [indexTotal, setIndexTotal] = useState<number | null>(null);
  const cancelRef = useRef(false);

  // Phase B.9 — Fast path: ask the chain directly for the recent-tx ring buffer
  // populated server-side by `apply_block`. This is O(N) point lookups on the
  // node and avoids the dashboard fetching thousands of blocks. Returns null if
  // the RPC isn't available (older node), letting the caller fall back to scan.
  async function fetchRecentFromIndex(): Promise<{ txs: OnchainTx[]; total: number } | null> {
    try {
      const r = await rpc<any>("zbx_recentTxs", [TARGET_TX_COUNT]);
      if (!r || !Array.isArray(r.txs)) return null;
      const list: OnchainTx[] = r.txs.map((t: any) => ({
        height: Number(t.height ?? 0),
        ts: Number(t.timestamp_ms ?? 0),
        from: t.from ?? "",
        to: t.to ?? "",
        amount_wei: String(t.amount ?? "0"),
        fee_wei: String(t.fee ?? "0"),
        kind: t.kind ?? "Unknown",
        hash: String(t.hash ?? t.tx_hash ?? ""),
      }));
      return { txs: list, total: Number(r.total_indexed ?? r.stored ?? list.length) };
    } catch {
      // Method not whitelisted or not implemented → caller falls back to scan.
      return null;
    }
  }

  // Scan blocks backwards from tip in fixed chunks, stopping as soon as we
  // collect TARGET_TX_COUNT transactions, hit genesis, or hit the safety cap.
  // UI streams results as they're found so the user sees progress live.
  // This is now a FALLBACK — primary path is `fetchRecentFromIndex()`.
  async function scan(maxBlocks = MAX_SCAN_BLOCKS) {
    if (!tipHeight || scanning) return;
    cancelRef.current = false;
    setScanning(true);
    setCompleted(false);
    setErr(null);
    setTxs([]);
    setScannedRange(0);
    const found: OnchainTx[] = [];
    let scannedSoFar = 0;
    try {
      while (found.length < TARGET_TX_COUNT && scannedSoFar < maxBlocks) {
        if (cancelRef.current) break;
        const start = tipHeight - scannedSoFar;
        if (start < 0) break;
        const end = Math.max(0, start - CHUNK_SIZE + 1);
        const heights: number[] = [];
        for (let h = start; h >= end; h--) heights.push(h);

        for (let i = 0; i < heights.length; i += CONCURRENCY) {
          if (cancelRef.current) break;
          const slice = heights.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            slice.map(async (h) => {
              try {
                const r = await rpc<any>("zbx_getBlockByNumber", [h]);
                if (!r) return null;
                const hdr = r.header ?? r;
                const blockTxs = Array.isArray(r.txs) ? r.txs : [];
                return { h, ts: hdr.timestamp_ms ?? 0, txs: blockTxs };
              } catch { return null; }
            }),
          );
          for (const x of results) {
            if (!x || !x.txs.length) continue;
            for (const t of x.txs) {
              const body = t.body ?? t;
              found.push({
                height: x.h,
                ts: x.ts,
                from: body.from ?? "",
                to: body.to ?? "",
                amount_wei: typeof body.amount === "number" ? body.amount.toString() : String(body.amount ?? "0"),
                fee_wei: typeof body.fee === "number" ? body.fee.toString() : String(body.fee ?? "0"),
                kind: kindLabel(body.kind),
                // SignedTx exposes the precomputed hash on the outer envelope
                // (`t.hash`); fall back to empty so the explorer link is
                // suppressed when it isn't present.
                hash: String(t.hash ?? t.tx_hash ?? ""),
              });
            }
          }
          scannedSoFar += slice.length;
          // Live update UI as we scan so user sees progress.
          setScannedRange(scannedSoFar);
          if (found.length > 0) {
            const sorted = [...found].sort((a, b) => b.height - a.height);
            setTxs(sorted.slice(0, TARGET_TX_COUNT));
          }
          if (found.length >= TARGET_TX_COUNT) break;
        }
        if (end === 0) break; // hit genesis
      }
      setCompleted(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  function cancel() {
    cancelRef.current = true;
  }

  // Phase B.9 — Try the on-chain index first; only fall back to a full block
  // scan when the chain doesn't expose the index (older binary, RPC blocked, etc).
  async function refresh() {
    if (!tipHeight || scanning) return;
    setErr(null);
    const fast = await fetchRecentFromIndex();
    if (fast) {
      setSource("index");
      setIndexTotal(fast.total);
      setTxs(fast.txs);
      setCompleted(true);
      setScannedRange(0);
      return;
    }
    // Fallback path — chain didn't return an index (older node).
    setSource("scan");
    setIndexTotal(null);
    await scan();
  }

  useEffect(() => {
    if (tipHeight && !autoScanned) {
      setAutoScanned(true);
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipHeight]);

  // Re-fetch whenever the parent bumps refreshKey (e.g. after a Quick Send).
  useEffect(() => {
    if (refreshKey > 0 && tipHeight) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Phase B.9 — When using the fast index path, poll periodically so new txs
  // appear within ~3s without manually clicking re-scan. We only poll while
  // the panel is using the index (cheap RPC); the legacy scan path keeps its
  // explicit "re-scan" button to avoid hammering the chain.
  useEffect(() => {
    if (source !== "index") return;
    const id = setInterval(() => {
      if (!scanning) refresh();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, tipHeight, scanning]);

  // Cancel any in-flight scan on unmount.
  useEffect(() => () => { cancelRef.current = true; }, []);

  const reachedTarget = txs.length >= TARGET_TX_COUNT;
  const reachedCap = scannedRange >= MAX_SCAN_BLOCKS;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          Last {TARGET_TX_COUNT} Transactions
          {source === "index" && (
            <span className="text-[10px] font-normal text-emerald-400/80">
              · on-chain index{indexTotal !== null ? ` (${indexTotal.toLocaleString()} indexed)` : ""}
            </span>
          )}
          {source === "scan" && scannedRange > 0 && (
            <span className="text-[10px] font-normal text-muted-foreground">
              (found {txs.length}/{TARGET_TX_COUNT} · scanned {scannedRange.toLocaleString()} blocks{scanning ? "…" : ""})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {scanning ? (
            <button
              onClick={cancel}
              className="text-[11px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
            >
              stop
            </button>
          ) : (
            <button
              onClick={() => refresh()}
              className="text-[11px] px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30"
            >
              {source === "index" ? "refresh" : "re-scan"}
            </button>
          )}
        </div>
      </div>
      {err && <div className="p-3 text-xs text-red-400">{err}</div>}
      {completed && source === "index" && txs.length > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-emerald-400/80 bg-emerald-500/5 border-b border-border">
          ⚡ served from on-chain recent-tx index — no block scan needed
          {indexTotal !== null && ` · ${indexTotal.toLocaleString()} txs ever indexed`}
        </div>
      )}
      {completed && source === "scan" && reachedTarget && (
        <div className="px-3 py-1.5 text-[10px] text-emerald-400/80 bg-emerald-500/5 border-b border-border">
          ✓ found {TARGET_TX_COUNT} most recent txs (scanned back {scannedRange.toLocaleString()} blocks)
        </div>
      )}
      {completed && source === "scan" && !reachedTarget && reachedCap && txs.length > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-amber-400/80 bg-amber-500/5 border-b border-border">
          stopped at safety cap of {MAX_SCAN_BLOCKS.toLocaleString()} blocks · only {txs.length} tx{txs.length === 1 ? "" : "s"} found
        </div>
      )}
      {txs.length === 0 ? (
        <div className="p-8 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
          <div className="text-xs text-muted-foreground">
            {scanning
              ? `scanning blocks for transactions… (${scannedRange.toLocaleString()} so far)`
              : completed && source === "index"
              ? "on-chain recent-tx index is empty — no transactions have been committed yet."
              : completed && source === "scan" && reachedCap
              ? `no transactions found in last ${MAX_SCAN_BLOCKS.toLocaleString()} blocks — chain is essentially idle.`
              : completed && source === "scan"
              ? `no transactions found across ${scannedRange.toLocaleString()} scanned blocks — chain may have just started.`
              : "loading recent transactions…"}
          </div>
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium w-20">Block</th>
              <th className="text-left p-2 font-medium w-32">Tx Hash</th>
              <th className="text-left p-2 font-medium w-24">Kind</th>
              <th className="text-left p-2 font-medium">From</th>
              <th className="text-left p-2 font-medium">To</th>
              <th className="text-right p-2 font-medium">Amount</th>
              <th className="text-right p-2 font-medium">Fee</th>
              <th className="text-right p-2 font-medium w-20">Age</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t, i) => (
              <tr
                key={`${t.height}-${t.hash || i}`}
                className="border-t border-border hover:bg-muted/20 transition-colors"
                data-testid={`row-recent-tx-${i}`}
              >
                <td className="p-2 font-mono">
                  <WLink
                    href={explorerHref(t.height)}
                    className="text-primary hover:text-primary hover:underline underline-offset-2"
                    data-testid={`link-block-${t.height}`}
                  >
                    #{t.height}
                  </WLink>
                </td>
                <td className="p-2 font-mono">
                  {t.hash ? (
                    <WLink
                      href={explorerHref(t.hash)}
                      title={t.hash}
                      className="text-cyan-400 hover:text-cyan-300 hover:underline underline-offset-2"
                      data-testid={`link-tx-${i}`}
                    >
                      {shortAddr(t.hash, 6, 4)}
                    </WLink>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="p-2"><KindBadge kind={t.kind} /></td>
                <td className="p-2 font-mono">
                  {t.from ? (
                    <WLink
                      href={explorerHref(t.from)}
                      title={t.from}
                      className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
                      data-testid={`link-from-${i}`}
                    >
                      {shortAddr(t.from, 6, 4)}
                    </WLink>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="p-2 font-mono">
                  {t.to ? (
                    <WLink
                      href={explorerHref(t.to)}
                      title={t.to}
                      className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
                      data-testid={`link-to-${i}`}
                    >
                      {shortAddr(t.to, 6, 4)}
                    </WLink>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="p-2 text-right font-mono">
                  {t.amount_wei !== "0" ? `${weiHexToZbx(t.amount_wei)} ZBX` : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="p-2 text-right font-mono text-amber-400">{weiHexToZbx(t.fee_wei)}</td>
                <td className="p-2 text-right text-muted-foreground tabular-nums">{ageStr(t.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QuickSendAndRecent — broadcast a tx using the active web wallet, then auto
// re-scan the recent tx list so the new tx shows up as soon as a block lands.
// ─────────────────────────────────────────────────────────────────────────────
function QuickSendAndRecent({ tipHeight }: { tipHeight: number }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const handleSent = () => {
    // Bump immediately, then again after ~7s to catch the next block.
    setRefreshKey((k) => k + 1);
    window.setTimeout(() => setRefreshKey((k) => k + 1), 7000);
  };
  return (
    <div className="space-y-4">
      <QuickSendPanel tipHeight={tipHeight} onSent={handleSent} />
      <RecentTxsPanel tipHeight={tipHeight} refreshKey={refreshKey} />
    </div>
  );
}

function QuickSendPanel({
  tipHeight,
  onSent,
}: {
  tipHeight: number;
  onSent: () => void;
}) {
  const [, setLoc] = useLocation();
  const { remote, isRemote } = useWallet();
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [activeAddrLocal, setActiveAddrLocal] = useState<string | null>(null);
  // Effective sending address: paired mobile wallet wins. The "From" pill
  // and balance row both reflect this so quick-send mirrors the topbar.
  const activeAddr: string | null = isRemote && remote ? remote.address : activeAddrLocal;
  const setActiveAddr = (a: string | null) => setActiveAddrLocal(a);
  const [balance, setBalance] = useState<string>("—");
  const [nonce, setNonce] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  // Display value mirrors the chain's currently-recommended fee (AMM-pegged).
  // `feeEdited` flips true once the user types — when false, submit() passes
  // `feeZbx: undefined` so the lib signs with the exact recommended bigint
  // instead of the 6-decimal-truncated display string.
  const [fee, setFee] = useState("");
  const [feeEdited, setFeeEdited] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wei = await getRecommendedFeeWei();
        const zbx = weiHexToZbx("0x" + wei.toString(16));
        if (!cancelled) setFee((cur) => (cur === "" ? zbx : cur));
      } catch { /* leave empty — submit() will fetch again */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [okHash, setOkHash] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Pick up wallets from localStorage on mount + whenever localStorage changes.
  const reload = () => {
    const ws = loadWallets();
    setWallets(ws);
    const a = getActiveAddress();
    setActiveAddrLocal(a && ws.some((w) => w.address === a) ? a : ws[0]?.address ?? null);
  };
  useEffect(() => {
    reload();
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("zbx.")) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const refreshBalance = async (addr: string | null) => {
    if (!addr) {
      setBalance("—");
      setNonce(null);
      return;
    }
    setRefreshing(true);
    try {
      const [bal, n] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]),
        rpc<unknown>("zbx_getNonce", [addr]),
      ]);
      setBalance(weiHexToZbx(bal));
      setNonce(parseNonce(n));
    } catch {
      setBalance("error");
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    refreshBalance(activeAddr);
  }, [activeAddr, tipHeight]);

  const validAddr = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const validAmt = /^\d+(\.\d+)?$/.test(amount.trim()) && parseFloat(amount) > 0;
  // When mobile-paired, the active "wallet" is virtual — we have the
  // address from the pair handshake but no signing key on the dashboard.
  const active = isRemote && remote
    ? { address: remote.address, label: remote.label, privateKey: "" }
    : activeAddr ? getWallet(activeAddr) : null;
  const canSend = !!active && !isRemote && validAddr && validAmt && !busy;

  const submit = async () => {
    if (!active) return;
    if (isRemote) {
      setErrMsg("Mobile wallet connected — quick-send must be approved on your phone. Disconnect from the topbar to send from a stored key.");
      return;
    }
    setBusy(true);
    setOkHash(null);
    setErrMsg(null);
    try {
      const userFee = feeEdited ? fee.trim() : "";
      const r = await sendTransfer({
        privateKeyHex: active.privateKey,
        to: to.trim(),
        amountZbx: amount,
        // Defer to lib's exact-bigint resolver when user didn't override —
        // dodges the AMM-pegged dynamic-fee silent-drop bug.
        feeZbx: userFee || undefined,
      });
      setOkHash(r.hash);
      setTo("");
      setAmount("");
      onSent();
      setTimeout(() => refreshBalance(activeAddr), 7000);
    } catch (e: any) {
      setErrMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── No wallets at all (and no mobile pair either) ──
  if (wallets.length === 0 && !isRemote) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2.5">
            <Send className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Add a transaction to the chain</h3>
            <p className="text-xs text-muted-foreground">
              You don't have any browser wallet yet. Create or import one to broadcast a tx from here.
            </p>
          </div>
        </div>
        <button
          onClick={() => setLoc("/wallet")}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition flex items-center gap-1"
          data-testid="button-goto-wallet"
        >
          Open wallet <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          Quick Send — broadcast a transaction
        </h2>
        <button
          onClick={() => refreshBalance(activeAddr)}
          disabled={refreshing}
          className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-muted/70 disabled:opacity-40 flex items-center gap-1"
          title="Refresh balance"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> refresh
        </button>
      </div>

      <div className="p-4 space-y-4">
        {isRemote && remote && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 text-xs text-cyan-100/80 flex items-start gap-2">
            <Smartphone className="h-3.5 w-3.5 mt-0.5 shrink-0 text-cyan-300" />
            <span>
              Mobile wallet paired — quick-send approvals must happen on your phone.
              Disconnect from the topbar to broadcast from a stored key.
            </span>
          </div>
        )}
        {/* From + balance row */}
        <div className="grid md:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div>
            <label className="text-[11px] text-muted-foreground">From wallet</label>
            {isRemote && remote ? (
              <div className="mt-1 w-full bg-card border border-cyan-500/40 rounded-md px-2 py-1.5 text-xs font-mono text-cyan-100 flex items-center gap-2">
                <Smartphone className="h-3 w-3 text-cyan-300 shrink-0" />
                <span className="truncate">
                  {remote.label || "Mobile"} — {shortAddr(remote.address, 8, 6)}
                </span>
              </div>
            ) : (
              <select
                value={activeAddrLocal ?? ""}
                onChange={(e) => setActiveAddr(e.target.value)}
                className="mt-1 w-full bg-card border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                data-testid="select-quick-send-from"
              >
                {wallets.map((w) => (
                  <option key={w.address} value={w.address}>
                    {w.label} — {shortAddr(w.address, 8, 6)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Balance</div>
            <div className="text-sm font-bold text-primary tabular-nums">
              {balance} <span className="text-[10px] font-normal text-muted-foreground">ZBX</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Total tx</div>
            <div className="text-sm font-bold tabular-nums" data-testid="text-quick-send-nonce">
              {nonce ?? "—"}
            </div>
          </div>
        </div>

        {/* Form row */}
        <div className="grid md:grid-cols-[1fr_140px_120px_auto] gap-2">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Recipient 0x… (40 hex)"
            className={`bg-card border rounded-md px-3 py-2 text-xs font-mono outline-none transition ${
              to && !validAddr ? "border-red-500/50" : "border-border focus:border-primary"
            }`}
            data-testid="input-quick-send-to"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="amount (ZBX)"
            type="number"
            min="0"
            step="0.0001"
            className="bg-card border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-primary transition"
            data-testid="input-quick-send-amount"
          />
          <input
            value={fee}
            onChange={(e) => { setFee(e.target.value); setFeeEdited(true); }}
            placeholder="fee (auto)"
            type="number"
            min="0"
            step="0.0001"
            className="bg-card border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-primary transition"
            data-testid="input-quick-send-fee"
            title="Fee in ZBX"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-40 flex items-center gap-1.5"
            data-testid="button-quick-send"
          >
            {busy ? "Sending…" : <><Send className="h-3.5 w-3.5" /> Sign &amp; broadcast</>}
          </button>
        </div>

        {/* Status */}
        {okHash && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs flex items-start gap-2">
            <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-emerald-400 font-semibold">Submitted to mempool — refreshing block list…</div>
              <code className="font-mono text-[10px] break-all text-muted-foreground">{okHash}</code>
            </div>
          </div>
        )}
        {errMsg && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 text-xs flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
            <span className="text-red-300">{errMsg}</span>
          </div>
        )}
        {to && !validAddr && (
          <div className="text-[10px] text-red-400">Address must be 0x + 40 hex chars.</div>
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: any): string {
  if (!kind) return "Tx";
  if (typeof kind === "string") return kind;
  if (typeof kind === "object") {
    const key = Object.keys(kind)[0];
    if (!key) return "Tx";
    const inner = kind[key];
    if (inner && typeof inner === "object") {
      const sub = Object.keys(inner)[0];
      return sub ? `${key}.${sub}` : key;
    }
    return key;
  }
  return "Tx";
}

function KindBadge({ kind }: { kind: string }) {
  const tone =
    kind.startsWith("Transfer") ? "bg-emerald-500/15 text-emerald-400" :
    kind.startsWith("Multisig") ? "bg-violet-500/15 text-violet-400" :
    kind.startsWith("Stake") || kind.startsWith("Delegate") ? "bg-cyan-500/15 text-cyan-400" :
    kind.startsWith("Swap") ? "bg-amber-500/15 text-amber-400" :
    kind.startsWith("PayId") ? "bg-pink-500/15 text-pink-400" :
    "bg-muted text-muted-foreground";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${tone}`}>{kind}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function pushBuf(arr: number[], v: number): number[] {
  const next = [...arr, v];
  if (next.length > HISTORY_LEN) next.shift();
  return next;
}
function bigSafe(s: string): bigint { try { return BigInt(s); } catch { return 0n; } }
function ageStr(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
function simpleHash(s: string): number {
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function formatPrice(n: number): string {
  if (!isFinite(n)) return "0";
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}
