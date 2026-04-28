import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { rpc, weiHexToZbx, fmtUsd } from "@/lib/zbx-rpc";
import {
  Droplets, Activity, AlertTriangle, TrendingUp, ArrowUpDown, Coins,
  Lock, Unlock, Wifi, Check, Info, Calculator,
  Flame, History, Shield, Zap, ExternalLink, RefreshCw, Layers,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types — match VPS RPC response shapes exactly
// ─────────────────────────────────────────────────────────────────────────────
interface PoolFull {
  admin_address: string;
  pool_address: string;
  initialized: boolean;
  init_height: number;
  last_update_height: number;
  zbx_reserve_wei: string;
  zusd_reserve: string;
  spot_price_usd_per_zbx: string;
  spot_price_zusd_per_zbx_q18: string;
  fee_pct: string;
  fee_acc_zbx: string;
  fee_acc_zusd: string;
  lp_supply: string;
  lp_locked_to_pool: boolean;
  loan_outstanding_zusd: string;
  loan_repaid: boolean;
  lifetime_fees_zusd: string;
  lifetime_admin_paid_zusd: string;
  lifetime_reinvested_zusd: string;
  permissionless: boolean;
  max_swap_zbx: string;
  max_swap_zusd_display: string;
  max_swap_zbx_wei: string;
  max_swap_zusd: string;
}
interface PoolStats {
  pool_initialized: boolean;
  zbx_reserve_wei: string;
  zusd_reserve: string;
  spot_price_usd_per_zbx: string;
  loan_outstanding_zusd: string;
  loan_repaid: boolean;
  lifetime_fees_zusd: string;
  window_swap_count: number;
  window_swap_amount_sum: string;
  window_indexed_txs: number;
}
interface RecentSwap {
  hash: string;
  height: number;
  from: string;
  direction: "zbx_to_zusd" | "zusd_to_zbx";
  amount_in: string;
  amount_out: string;
  timestamp_ms?: number;
}
interface PriceInfo { zbx_usd: string; source: string; }

// Genesis target (what the chain code now ships with)
const TARGET_ZBX_RESERVE = "20,000,000";
const TARGET_ZUSD_RESERVE = "10,000,000";
const TARGET_SPOT_PRICE = "0.50";
const TARGET_FDV = "75,000,000"; // 150M cap × $0.50

// ─────────────────────────────────────────────────────────────────────────────
export default function PoolExplorer() {
  const [pool, setPool] = useState<PoolFull | null>(null);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [swaps, setSwaps] = useState<RecentSwap[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function tick() {
      try {
        const [p, s, pr, sw] = await Promise.all([
          rpc<PoolFull>("zbx_getPool").catch(() => null),
          rpc<PoolStats>("zbx_poolStats").catch(() => null),
          rpc<PriceInfo>("zbx_getPriceUSD").catch(() => null),
          rpc<RecentSwap[] | { swaps: RecentSwap[] }>("zbx_recentSwaps", [10]).catch(() => null),
        ]);
        if (!mounted) return;
        if (p) setPool(p);
        if (s) setStats(s);
        if (pr) setPrice(pr);
        if (sw) setSwaps(Array.isArray(sw) ? sw : (sw as any).swaps ?? []);
        setErr(null);
      } catch (e: any) {
        if (mounted) setErr(e?.message ?? String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    tick();
    const t = window.setInterval(tick, 5000);
    return () => { mounted = false; clearInterval(t); };
  }, [refreshKey]);

  const isInit = pool?.initialized ?? stats?.pool_initialized ?? false;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Header isInit={isInit} pool={pool} price={price} loading={loading} />

      {err && (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <Wifi className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-red-500 mb-1">RPC error</div>
            <code className="text-xs text-muted-foreground break-all">{err}</code>
          </div>
        </div>
      )}

      {!isInit && <BootstrapBanner pool={pool} onRefresh={() => setRefreshKey((k) => k + 1)} />}

      {isInit && pool && stats && (
        <>
          <ReserveTiles pool={pool} stats={stats} />
          <InvariantPanel pool={pool} />
          <LoanPanel pool={pool} />
          <QuoteCalculator pool={pool} />
        </>
      )}

      {/* Fee + economics — show even when uninitialized so user understands */}
      <FeeEconomicsCard pool={pool} stats={stats} />

      {/* Recent swaps always visible */}
      <RecentSwapsCard swaps={swaps} isInit={isInit} />

      {/* Footer info */}
      <PoolIdentityCard pool={pool} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
function Header({ isInit, pool, price, loading }: {
  isInit: boolean; pool: PoolFull | null; price: PriceInfo | null; loading: boolean;
}) {
  const spot = pool ? parseFloat(pool.spot_price_usd_per_zbx) : 0;
  const reportedPrice = price ? parseFloat(price.zbx_usd) : 0;
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-6 ${
      isInit
        ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-cyan-500/5 to-primary/10"
        : "border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-red-500/10"
    }`}>
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{
        background: isInit
          ? "radial-gradient(circle at 80% 20%, rgba(16,185,129,.18), transparent 50%), radial-gradient(circle at 10% 90%, rgba(34,211,238,.12), transparent 50%)"
          : "radial-gradient(circle at 80% 20%, rgba(245,158,11,.20), transparent 50%), radial-gradient(circle at 10% 90%, rgba(239,68,68,.12), transparent 50%)",
      }} />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {isInit ? (
              <Pill tone="emerald" pulse><Wifi className="h-3 w-3" />POOL LIVE</Pill>
            ) : (
              <Pill tone="amber" pulse><AlertTriangle className="h-3 w-3" />BOOTSTRAP REQUIRED</Pill>
            )}
            <Pill tone="violet"><Droplets className="h-3 w-3" />ZBX / zUSD AMM</Pill>
            <Pill tone="cyan"><Layers className="h-3 w-3" />0.30% fee</Pill>
            {pool?.permissionless && <Pill tone="emerald"><Unlock className="h-3 w-3" />Permissionless</Pill>}
            {pool?.lp_locked_to_pool && <Pill tone="violet"><Lock className="h-3 w-3" />LP Locked Forever</Pill>}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-3">
            <Droplets className={`h-8 w-8 ${isInit ? "text-emerald-400" : "text-amber-400"}`} />
            Pool / AMM Explorer
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            On-chain ZBX/zUSD constant-product AMM (x · y = k). 0.30% swap fee recycles the
            bootstrap liquidity first, then splits 50/50 between protocol payout and pool
            reinvestment. LP tokens are permanently locked to the pool address — provably
            permanent liquidity.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 min-w-[200px]">
          <div className={`text-5xl md:text-6xl font-bold tabular-nums ${
            isInit ? "text-foreground" : "text-amber-400"
          }`}>
            {loading ? "—" : (isInit ? `$${spot.toFixed(4)}` : "—")}
          </div>
          <div className="text-xs text-muted-foreground">
            {isInit ? "spot · 1 ZBX" : "awaiting first liquidity"}
          </div>
          {isInit && reportedPrice > 0 && (
            <div className="text-[10px] text-muted-foreground mt-1">
              oracle: <span className="font-mono text-foreground">${reportedPrice.toFixed(6)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap banner — when pool is uninitialized, big call-to-action
// ─────────────────────────────────────────────────────────────────────────────
function BootstrapBanner({ pool, onRefresh }: { pool: PoolFull | null; onRefresh: () => void }) {
  const poolAddr = pool?.pool_address ?? "0x7a73776170000000000000000000000000000000";
  return (
    <div className="rounded-2xl border border-sky-500/40 bg-gradient-to-br from-sky-500/10 to-cyan-500/5 overflow-hidden">
      <div className="p-5 border-b border-sky-500/30 bg-sky-500/10 flex items-start gap-3">
        <Droplets className="h-6 w-6 text-sky-300 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h2 className="text-lg font-bold text-sky-100">AMM Pool Coming Online</h2>
          <p className="text-sm text-sky-200/80 mt-1">
            The Zebvix AMM is finalising its opening liquidity. Once the pool is
            funded, live spot pricing, swaps and TVL appear here automatically —
            no further user action required.
          </p>
        </div>
        <button onClick={onRefresh}
          className="px-3 py-1.5 rounded-md border border-sky-500/40 hover:bg-sky-500/10 text-xs flex items-center gap-1.5 text-sky-200 shrink-0">
          <RefreshCw className="h-3 w-3" /> Re-check
        </button>
      </div>

      {/* Target genesis values */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5 border-b border-sky-500/20">
        <Tile label="ZBX seed" value={`${TARGET_ZBX_RESERVE}`} sub="ZBX → pool reserve" tone="emerald" />
        <Tile label="zUSD seed" value={`${TARGET_ZUSD_RESERVE}`} sub="zUSD on the other side" tone="cyan" />
        <Tile label="Opening price" value={`$${TARGET_SPOT_PRICE}`} sub="per ZBX" tone="violet" />
        <Tile label="Implied FDV" value={`$${TARGET_FDV}`} sub="150M × opening price" tone="amber" />
      </div>

      <div className="p-5 space-y-3">
        <div className="p-3 rounded-md border border-border bg-card/40">
          <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Pool Address</div>
          <div className="font-mono text-xs flex items-center justify-between gap-2">
            <code className="break-all">{poolAddr}</code>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Liquidity in this AMM is permanently locked — there is no withdraw
            key. Once seeded, the pool is provably permissionless.
          </p>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  const tc: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5", cyan: "border-cyan-500/30 bg-cyan-500/5",
    violet: "border-violet-500/30 bg-violet-500/5", amber: "border-amber-500/30 bg-amber-500/5",
  };
  return (
    <div className={`p-3 rounded-lg border ${tc[tone] ?? "border-border"}`}>
      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reserve tiles (when pool LIVE)
// ─────────────────────────────────────────────────────────────────────────────
function ReserveTiles({ pool, stats }: { pool: PoolFull; stats: PoolStats }) {
  const zbxReserve = parseFloat(weiHexToZbx(pool.zbx_reserve_wei).replace(/,/g, ""));
  const zusdReserve = parseFloat(weiHexToZbx(pool.zusd_reserve).replace(/,/g, ""));
  const spot = parseFloat(pool.spot_price_usd_per_zbx);
  const tvl = zusdReserve * 2; // standard AMM TVL = 2 × USD side
  const ratio = zbxReserve > 0 ? zusdReserve / zbxReserve : 0;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard icon={Coins} tone="cyan" label="ZBX Reserve" value={zbxReserve.toLocaleString(undefined, { maximumFractionDigits: 2 })} sub="ZBX in pool" />
      <KpiCard icon={Coins} tone="emerald" label="zUSD Reserve" value={zusdReserve.toLocaleString(undefined, { maximumFractionDigits: 2 })} sub="zUSD in pool" />
      <KpiCard icon={TrendingUp} tone="violet" label="Spot Price" value={`$${spot.toFixed(6)}`} sub={`ratio ${ratio.toFixed(4)}`} />
      <KpiCard icon={Layers} tone="amber" label="Pool TVL" value={fmtUsd(tvl)} sub="2 × zUSD side" />
    </div>
  );
}

function KpiCard({ icon: Icon, tone, label, value, sub }: { icon: any; tone: string; label: string; value: string; sub?: string }) {
  const t: Record<string, string> = {
    cyan: "text-cyan-400 bg-cyan-500/10", emerald: "text-emerald-400 bg-emerald-500/10",
    violet: "text-violet-400 bg-violet-500/10", amber: "text-amber-400 bg-amber-500/10",
  };
  return (
    <div className="p-4 rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className={`p-1.5 rounded-lg ${t[tone] ?? ""}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <div className="text-xl md:text-2xl font-bold tabular-nums truncate">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant panel (k = x · y, ratio bar)
// ─────────────────────────────────────────────────────────────────────────────
function InvariantPanel({ pool }: { pool: PoolFull }) {
  const x = parseFloat(weiHexToZbx(pool.zbx_reserve_wei).replace(/,/g, ""));
  const y = parseFloat(weiHexToZbx(pool.zusd_reserve).replace(/,/g, ""));
  const k = x * y;
  const total = x + y;
  const xPct = total > 0 ? (x / total) * 100 : 50;
  const yPct = 100 - xPct;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-primary" /> Constant-Product Invariant
      </h3>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-xs">
          <Stat label="x (ZBX)" value={x.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
          <Stat label="y (zUSD)" value={y.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
          <Stat label="k = x · y" value={k.toLocaleString(undefined, { maximumFractionDigits: 0 })} mono />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>ZBX {xPct.toFixed(1)}%</span>
            <span>zUSD {yPct.toFixed(1)}%</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden bg-muted/30 flex">
            <div className="bg-cyan-500/60 transition-all" style={{ width: `${xPct}%` }} />
            <div className="bg-emerald-500/60 transition-all" style={{ width: `${yPct}%` }} />
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground leading-relaxed">
          AMM enforces <code className="font-mono text-foreground">x · y = k</code>. Each swap moves the curve;
          larger trades hit slippage harder. 0.30% of input is captured as fee → recycled into reserves.
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-2 rounded-md bg-background/40 border border-border/40">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 truncate ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap Liquidity panel — shows progress toward fee-driven recycling
// ─────────────────────────────────────────────────────────────────────────────
function LoanPanel({ pool }: { pool: PoolFull }) {
  const outstanding = parseFloat(weiHexToZbx(pool.loan_outstanding_zusd).replace(/,/g, ""));
  const lifetimeFees = parseFloat(weiHexToZbx(pool.lifetime_fees_zusd).replace(/,/g, ""));
  const seedAmount = 10_000_000;
  const recycled = Math.max(0, seedAmount - outstanding);
  const pct = (recycled / seedAmount) * 100;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" /> Bootstrap Liquidity Recycling
        </h3>
        {pool.loan_repaid ? (
          <Pill tone="emerald"><Check className="h-3 w-3" />FULLY RECYCLED</Pill>
        ) : (
          <Pill tone="amber"><Coins className="h-3 w-3" />IN PROGRESS</Pill>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Recycled via fees</span>
          <span className="font-mono font-semibold tabular-nums">{recycled.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {seedAmount.toLocaleString()} zUSD</span>
        </div>
        <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>{pct.toFixed(2)}% complete</span>
          <span>lifetime fees: {lifetimeFees.toFixed(4)} zUSD</span>
        </div>
        <div className="text-[10px] text-muted-foreground leading-relaxed mt-2">
          The pool was seeded with bootstrap zUSD liquidity. While recycling, 100% of swap
          fees flow back into reserves to retire the seed. Once fully recycled, future 0.30%
          swap fees split <strong>50/50</strong> between protocol payout and pool reinvestment
          (compounding LP value).
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quote calculator — uses zbx_swapQuote
// ─────────────────────────────────────────────────────────────────────────────
function QuoteCalculator({ pool }: { pool: PoolFull }) {
  const [direction, setDirection] = useState<"zbx_to_zusd" | "zusd_to_zbx">("zbx_to_zusd");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function getQuote() {
    setLoading(true); setErr(null); setQuote(null);
    try {
      // RPC contract: positional params [direction, amount_in (string)] — see rpc.rs:351
      const wei = (BigInt(Math.floor(parseFloat(amount || "0") * 1e6)) * 10n ** 12n).toString();
      const q = await rpc<any>("zbx_swapQuote", [direction, wei]);
      setQuote(q);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  const inSym = direction === "zbx_to_zusd" ? "ZBX" : "zUSD";
  const outSym = direction === "zbx_to_zusd" ? "zUSD" : "ZBX";

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Calculator className="h-4 w-4 text-primary" /> Swap Quote Calculator
      </h3>
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">Direction</label>
          <div className="mt-1 flex gap-1">
            <button onClick={() => setDirection("zbx_to_zusd")}
              className={`flex-1 px-2 py-1.5 rounded-md text-xs font-mono border transition ${
                direction === "zbx_to_zusd" ? "border-cyan-500 bg-cyan-500/10 text-cyan-300" : "border-border hover:bg-muted/30"
              }`}>ZBX → zUSD</button>
            <button onClick={() => setDirection("zusd_to_zbx")}
              className={`flex-1 px-2 py-1.5 rounded-md text-xs font-mono border transition ${
                direction === "zusd_to_zbx" ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-border hover:bg-muted/30"
              }`}>zUSD → ZBX</button>
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">Amount In ({inSym})</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full mt-1 px-3 py-1.5 text-sm font-mono rounded-md bg-background border border-border focus:border-primary outline-none" />
        </div>
        <div className="flex items-end">
          <button onClick={getQuote} disabled={loading || !amount}
            className="w-full px-3 py-1.5 rounded-md bg-primary hover:opacity-90 text-primary-foreground text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Zap className="h-3.5 w-3.5" /> {loading ? "quoting…" : "Get quote"}
          </button>
        </div>
      </div>
      {err && (
        <div className="mt-3 p-2 rounded-md border border-red-500/40 bg-red-500/5 text-xs text-red-300 break-all">{err}</div>
      )}
      {quote && (
        <div className="mt-3 space-y-2">
          {quote.would_succeed === false && (
            <div className="p-2 rounded-md border border-amber-500/40 bg-amber-500/5 text-xs text-amber-300">
              {quote.reason ?? "quote rejected by chain"}
            </div>
          )}
          <div className="grid md:grid-cols-4 gap-2">
            <Stat label={`amount in (${inSym})`} value={amount} />
            <Stat label={`amount out (${outSym})`}
              value={quote.expected_out ? (Number(BigInt(quote.expected_out) / 10n ** 12n) / 1e6).toFixed(6) : "—"} mono />
            <Stat label="fee paid"
              value={quote.fee_in ? (Number(BigInt(quote.fee_in) / 10n ** 12n) / 1e6).toFixed(6) : "—"} mono />
            <Stat label="price impact"
              value={quote.price_impact_pct ? `${parseFloat(quote.price_impact_pct).toFixed(4)}%` : "—"} />
          </div>
        </div>
      )}
      <div className="mt-3 text-[10px] text-muted-foreground">
        Quote-only — no transaction sent. Use the <Link href="/swap"><span className="text-primary hover:underline cursor-pointer">Swap page</span></Link> to actually execute with slippage protection.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee economics card (always visible)
// ─────────────────────────────────────────────────────────────────────────────
function FeeEconomicsCard({ pool, stats }: { pool: PoolFull | null; stats: PoolStats | null }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <Flame className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold">Fee Economics</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-border/40">
        <Cell label="Fee rate" value={pool?.fee_pct ? `${pool.fee_pct}%` : "0.30%"} />
        <Cell label="Lifetime fees" value={pool ? `${weiHexToZbx(pool.lifetime_fees_zusd)} zUSD` : "—"} />
        <Cell label="Lifetime → treasury" value={pool ? `${weiHexToZbx(pool.lifetime_admin_paid_zusd)} zUSD` : "—"} />
        <Cell label="Lifetime → reinvest" value={pool ? `${weiHexToZbx(pool.lifetime_reinvested_zusd)} zUSD` : "—"} />
        <Cell label="Window swaps (recent)" value={stats ? `${stats.window_swap_count}` : "—"} />
        <Cell label="Window volume" value={stats ? `${weiHexToZbx(stats.window_swap_amount_sum)} zUSD-eq` : "—"} />
        <Cell label="Max swap (ZBX)" value={pool ? `${pool.max_swap_zbx} ZBX` : "100,000 ZBX"} />
        <Cell label="Max swap (zUSD)" value={pool ? `${pool.max_swap_zusd_display} zUSD` : "100,000 zUSD"} />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3">
      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">{label}</div>
      <div className="text-sm font-bold tabular-nums mt-0.5 truncate font-mono">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent swaps card
// ─────────────────────────────────────────────────────────────────────────────
function RecentSwapsCard({ swaps, isInit }: { swaps: RecentSwap[]; isInit: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-primary" /> Recent Swaps
        </h3>
        <Link href="/swap">
          <span className="text-[10px] text-primary hover:underline cursor-pointer flex items-center gap-1">
            open swap UI <ExternalLink className="h-3 w-3" />
          </span>
        </Link>
      </div>
      {!isInit ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          Pool uninitialized — no swaps possible yet. Bootstrap the pool to begin trading.
        </div>
      ) : swaps.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">No swaps in recent indexed window.</div>
      ) : (
        <div className="divide-y divide-border/40">
          {swaps.map((s, i) => (
            <div key={s.hash ?? i} className="p-3 flex items-center justify-between gap-3 hover:bg-muted/20 transition">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <ArrowUpDown className={`h-3.5 w-3.5 shrink-0 ${
                  s.direction === "zbx_to_zusd" ? "text-cyan-400" : "text-emerald-400"
                }`} />
                <div className="min-w-0">
                  <div className="text-xs font-mono truncate">
                    <span className={s.direction === "zbx_to_zusd" ? "text-cyan-400" : "text-emerald-400"}>
                      {s.direction === "zbx_to_zusd" ? "ZBX → zUSD" : "zUSD → ZBX"}
                    </span>
                    <span className="text-muted-foreground"> · #{s.height}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate">
                    {s.from ? `${s.from.slice(0, 8)}…${s.from.slice(-6)}` : "—"} · {s.hash ? `${s.hash.slice(0, 10)}…` : ""}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono tabular-nums">
                  in {s.amount_in ? weiHexToZbx(s.amount_in) : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  out {s.amount_out ? weiHexToZbx(s.amount_out) : "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool identity card
// ─────────────────────────────────────────────────────────────────────────────
function PoolIdentityCard({ pool }: { pool: PoolFull | null }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Info className="h-4 w-4 text-primary" /> Pool Identity
      </h3>
      <div className="grid md:grid-cols-2 gap-4 text-xs">
        <Identity label="Pool address" value={pool?.pool_address ?? "0x7a73776170…"} />
        <Identity label="Governor address" value={pool?.admin_address ?? "—"} />
        <Identity label="Init height" value={pool ? `${pool.init_height}` : "—"} />
        <Identity label="Last update" value={pool ? `${pool.last_update_height}` : "—"} />
        <Identity label="LP supply" value={pool ? pool.lp_supply : "—"} />
        <Identity label="Fee accumulator (ZBX)" value={pool ? weiHexToZbx(pool.fee_acc_zbx) : "—"} />
      </div>
    </div>
  );
}

function Identity({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground text-right break-all">{value}</span>
    </div>
  );
}

function Pill({ tone, children, pulse }: { tone: string; children: React.ReactNode; pulse?: boolean }) {
  const t: Record<string, string> = {
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    violet: "border-violet-500/40 bg-violet-500/10 text-violet-300",
    cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${t[tone] ?? ""} ${pulse ? "animate-pulse" : ""}`}>
      {children}
    </span>
  );
}
