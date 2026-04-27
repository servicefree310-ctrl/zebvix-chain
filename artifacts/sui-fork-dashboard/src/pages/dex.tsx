import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coins,
  Copy,
  Droplets,
  ExternalLink,
  Flame,
  Layers,
  LineChart as LineIcon,
  Loader2,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet as WalletIcon,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { rpc, shortAddr, getRecommendedFeeWei, weiHexToZbx } from "@/lib/zbx-rpc";
import {
  loadWallets,
  getActiveAddress,
  getWallet,
  sendSwap,
  zbxToWei,
  zusdToMicros,
  recordTx,
  type SwapDirection,
  type StoredWallet,
} from "@/lib/web-wallet";
import { useWallet } from "@/contexts/wallet-context";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SCALE_18 = 10n ** 18n;
const PRICE_HISTORY_KEY = "zbx_dex_price_history_v1";
const PAPER_POSITIONS_KEY = "zbx_dex_paper_positions_v1";

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
}

interface RecentSwap {
  seq: number;
  height: number;
  timestamp_ms: number;
  hash: string;
  from: string;
  amount_in: string;
  fee: string;
  nonce: number;
}

interface QuoteResult {
  would_succeed: boolean;
  reason?: string;
  expected_out: string;
  fee_in: string;
  price_impact_bps: number;
  price_impact_pct?: string;
  recommended_min_out_at_0_5pct?: string;
  recommended_min_out_at_1pct?: string;
  recommended_min_out_at_3pct?: string;
}

interface PricePoint {
  t: number;
  p: number;
}

interface PaperPosition {
  id: string;
  side: "long" | "short";
  leverage: number;
  size_usd: number;
  entry: number;
  liq: number;
  opened_at: number;
}

function formatToken(weiStr: string | bigint, decimals = 6): string {
  try {
    const w = typeof weiStr === "bigint" ? weiStr : BigInt(weiStr);
    const whole = w / SCALE_18;
    const frac = w % SCALE_18;
    if (decimals === 0) return whole.toString();
    const fracStr = (frac + SCALE_18).toString().slice(1).slice(0, decimals);
    const trimmed = fracStr.replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  } catch {
    return "0";
  }
}

function fmtUsd(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtAge(ms: number): string {
  const d = Date.now() - ms;
  if (d < 0) return "now";
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d2 = Math.floor(h / 24);
  return `${d2}d ago`;
}

function loadPriceHistory(): PricePoint[] {
  try {
    const raw = localStorage.getItem(PRICE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PricePoint[];
    if (!Array.isArray(parsed)) return [];
    // Keep at most last 7d of data
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    return parsed.filter((p) => p && typeof p.t === "number" && typeof p.p === "number" && p.t >= cutoff);
  } catch {
    return [];
  }
}

function savePriceHistory(h: PricePoint[]) {
  try {
    // Cap at ~5000 samples to avoid quota issues
    const capped = h.length > 5000 ? h.slice(h.length - 5000) : h;
    localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(capped));
  } catch {
    // ignore quota errors
  }
}

function loadPaperPositions(): PaperPosition[] {
  try {
    const raw = localStorage.getItem(PAPER_POSITIONS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as PaperPosition[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function savePaperPositions(p: PaperPosition[]) {
  try {
    localStorage.setItem(PAPER_POSITIONS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Ticker
// ─────────────────────────────────────────────────────────────────────────────

interface TickerStats {
  last: number;
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24hZbx: number | null;
  tvlUsd: number | null;
}

function PairTicker({
  stats,
  loading,
}: {
  stats: TickerStats;
  loading: boolean;
}) {
  const up = stats.change24hPct == null ? null : stats.change24hPct >= 0;
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Pair */}
        <div className="flex items-center gap-3 pr-4 border-r border-border/40">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/40 to-emerald-500/30 border border-primary/40 flex items-center justify-center">
            <span className="text-[11px] font-bold text-primary">ZBX</span>
          </div>
          <div>
            <div className="text-base font-semibold leading-tight">ZBX / zUSD</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Zebvix L1 · AMM Spot
            </div>
          </div>
        </div>

        {/* Last price */}
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Last</div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl md:text-3xl font-mono font-bold ${
              up == null ? "text-foreground" : up ? "text-emerald-400" : "text-red-400"
            }`}>
              ${loading ? "…" : fmtUsd(stats.last)}
            </span>
            {up != null && (
              up
                ? <ArrowUpRight className="h-5 w-5 text-emerald-400" />
                : <ArrowDownRight className="h-5 w-5 text-red-400" />
            )}
          </div>
        </div>

        {/* 24h change */}
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">24h Change</div>
          <div className={`text-base font-mono font-semibold ${
            up == null ? "text-muted-foreground" : up ? "text-emerald-400" : "text-red-400"
          }`}>
            {stats.change24hPct == null ? "—" : `${stats.change24hPct >= 0 ? "+" : ""}${stats.change24hPct.toFixed(2)}%`}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">24h High</div>
          <div className="text-sm font-mono">{stats.high24h == null ? "—" : `$${fmtUsd(stats.high24h)}`}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">24h Low</div>
          <div className="text-sm font-mono">{stats.low24h == null ? "—" : `$${fmtUsd(stats.low24h)}`}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">24h Vol</div>
          <div className="text-sm font-mono">
            {stats.volume24hZbx == null ? "—" : `${stats.volume24hZbx.toLocaleString("en-US", { maximumFractionDigits: 2 })} ZBX`}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Pool TVL</div>
          <div className="text-sm font-mono">{stats.tvlUsd == null ? "—" : `$${fmtUsd(stats.tvlUsd, 2)}`}</div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
            LIVE
          </Badge>
          <Badge variant="outline" className="text-blue-400 border-blue-500/40">CHAIN 7878</Badge>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Price Chart
// ─────────────────────────────────────────────────────────────────────────────

type Timeframe = "5m" | "1h" | "24h" | "7d" | "all";

const TF_WINDOW_MS: Record<Timeframe, number | null> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  all: null,
};

function PriceChart({
  history,
  timeframe,
  onTimeframe,
  spotNow,
}: {
  history: PricePoint[];
  timeframe: Timeframe;
  onTimeframe: (t: Timeframe) => void;
  spotNow: number | null;
}) {
  const filtered = useMemo(() => {
    const win = TF_WINDOW_MS[timeframe];
    if (!win) return history;
    const cutoff = Date.now() - win;
    return history.filter((p) => p.t >= cutoff);
  }, [history, timeframe]);

  const data = filtered.map((p) => ({
    t: p.t,
    p: p.p,
    label: new Date(p.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  }));

  const minP = data.length ? Math.min(...data.map((d) => d.p)) : 0;
  const maxP = data.length ? Math.max(...data.map((d) => d.p)) : 0;
  const pad = Math.max((maxP - minP) * 0.15, maxP * 0.001);
  const yDomain: [number, number] = [Math.max(0, minP - pad), maxP + pad];

  const first = data[0]?.p ?? null;
  const last = data[data.length - 1]?.p ?? null;
  const up = first != null && last != null ? last >= first : true;
  const stroke = up ? "#10b981" : "#ef4444";
  const fill = up ? "url(#dexGradGreen)" : "url(#dexGradRed)";

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <LineIcon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Price · ZBX/zUSD</h3>
        </div>
        {spotNow != null && (
          <div className="text-xs font-mono text-muted-foreground">spot ${fmtUsd(spotNow)}</div>
        )}
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border/60 bg-background/40 p-0.5">
          {(Object.keys(TF_WINDOW_MS) as Timeframe[]).map((t) => (
            <button
              key={t}
              onClick={() => onTimeframe(t)}
              className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                timeframe === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
              data-testid={`chart-tf-${t}`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="h-64 md:h-80 w-full">
        {data.length < 2 ? (
          <div className="h-full w-full flex flex-col items-center justify-center text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mb-2" />
            <div className="text-xs text-muted-foreground">
              Sampling on-chain spot price… chart will render after a few seconds.
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dexGradGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="dexGradRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)" }}
                tickFormatter={(v: number) => `$${v.toFixed(4)}`}
                tickLine={false}
                axisLine={false}
                width={68}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(15,17,22,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                formatter={(value: number) => [`$${value.toFixed(6)}`, "ZBX"]}
              />
              <Area
                type="monotone"
                dataKey="p"
                stroke={stroke}
                strokeWidth={2}
                fill={fill}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Ticket: Spot (real) + Futures (paper)
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "spot" | "futures";
type SpotType = "market" | "limit" | "stop";

function OrderTicket({
  poolStats,
  spotPrice,
  active,
  zbxBalance,
  zusdBalance,
  onSubmittedSwap,
  onPaperOpen,
}: {
  poolStats: PoolStats | null;
  spotPrice: number | null;
  active: string | null;
  zbxBalance: string;
  zusdBalance: string;
  onSubmittedSwap: () => void;
  onPaperOpen: (p: PaperPosition) => void;
}) {
  const { toast } = useToast();
  const { remote, isRemote } = useWallet();
  const [mode, setMode] = useState<Mode>("spot");

  // Spot state
  const [direction, setDirection] = useState<SwapDirection>("zbx_to_zusd");
  const [spotType, setSpotType] = useState<SpotType>("market");
  const [amountIn, setAmountIn] = useState<string>("");
  const [slippagePct, setSlippagePct] = useState<number>(1);
  const [triggerPrice, setTriggerPrice] = useState<string>("");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Futures state
  const [futSide, setFutSide] = useState<"long" | "short">("long");
  const [futCollateral, setFutCollateral] = useState<string>("");
  const [futLeverage, setFutLeverage] = useState<number>(5);

  const inputSym = direction === "zbx_to_zusd" ? "ZBX" : "zUSD";
  const outputSym = direction === "zbx_to_zusd" ? "zUSD" : "ZBX";

  const inputBal = direction === "zbx_to_zusd" ? zbxBalance : zusdBalance;
  const inputBalDisplay = direction === "zbx_to_zusd"
    ? `${formatToken(inputBal, 6)} ZBX`
    : `${formatToken(inputBal, 2)} zUSD`;

  const amountInWei = useMemo(() => {
    try {
      if (!amountIn || parseFloat(amountIn) <= 0) return 0n;
      return direction === "zbx_to_zusd" ? zbxToWei(amountIn) : zusdToMicros(amountIn);
    } catch {
      return 0n;
    }
  }, [amountIn, direction]);

  // Live quote (debounced)
  useEffect(() => {
    if (mode !== "spot" || amountInWei === 0n) { setQuote(null); return; }
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      try {
        const q = await rpc<QuoteResult>("zbx_swapQuote", [direction, amountInWei.toString()]);
        setQuote(q);
      } catch (e) {
        setQuote({
          would_succeed: false,
          reason: e instanceof Error ? e.message : String(e),
          expected_out: "0",
          fee_in: "0",
          price_impact_bps: 0,
        });
      } finally {
        setQuoteLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [direction, amountInWei, mode]);

  const minOutWei = useMemo(() => {
    if (!quote || !quote.would_succeed) return 0n;
    try {
      const out = BigInt(quote.expected_out);
      const numerator = 10000n - BigInt(Math.round(slippagePct * 100));
      return (out * numerator) / 10000n;
    } catch {
      return 0n;
    }
  }, [quote, slippagePct]);

  const expectedOutNum = useMemo(() => {
    if (!quote?.would_succeed) return null;
    try {
      // Both ZBX and zUSD use 18-decimal scaling on Zebvix.
      return Number(BigInt(quote.expected_out) / (10n ** 12n)) / 1_000_000;
    } catch {
      return null;
    }
  }, [quote]);

  // Spot submit (Market only)
  const onSubmitSpot = async () => {
    if (spotType !== "market") {
      toast({
        title: "Trigger order saved locally",
        description: "Limit and stop orders are kept in this browser and will need to be confirmed when the price condition hits.",
      });
      return;
    }
    if (!active) { toast({ title: "no wallet", description: "create or import a wallet first" }); return; }
    if (isRemote) {
      toast({
        title: "Mobile wallet connected",
        description: "Local swap signing is paused while a mobile wallet is paired.",
        variant: "destructive",
      });
      return;
    }
    if (!quote || !quote.would_succeed) {
      toast({ title: "quote unavailable", description: quote?.reason ?? "enter an amount first" });
      return;
    }
    const w = getWallet(active);
    if (!w) { toast({ title: "wallet not found" }); return; }

    setSubmitting(true);
    try {
      const feeWei = await getRecommendedFeeWei();
      const feeZbxStr = weiHexToZbx("0x" + feeWei.toString(16));
      const r = await sendSwap({
        privateKeyHex: w.privateKey,
        direction,
        amountIn: amountInWei,
        minOut: minOutWei,
      });
      recordTx({
        hash: r.hash || null,
        from: active,
        to: active,
        amountZbx: amountIn,
        feeZbx: feeZbxStr,
        ts: Date.now(),
        status: "submitted",
      });
      toast({
        title: "Swap submitted on-chain",
        description: r.hash ? r.hash.slice(0, 18) + "…" : "tx in mempool",
      });
      setAmountIn("");
      setQuote(null);
      onSubmittedSwap();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Swap failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Futures (paper) submit
  const onOpenPaper = () => {
    const collat = parseFloat(futCollateral);
    if (!Number.isFinite(collat) || collat <= 0) {
      toast({ title: "Collateral required", description: "Enter a positive zUSD collateral amount." });
      return;
    }
    if (spotPrice == null || spotPrice <= 0) {
      toast({ title: "Price unavailable", description: "Wait for the live price to load." });
      return;
    }
    const size = collat * futLeverage;
    // Liquidation price: simplified — long: entry * (1 - 1/lev), short: entry * (1 + 1/lev)
    const liq = futSide === "long"
      ? spotPrice * (1 - 1 / futLeverage)
      : spotPrice * (1 + 1 / futLeverage);
    const pos: PaperPosition = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      side: futSide,
      leverage: futLeverage,
      size_usd: Math.round(size * 100) / 100,
      entry: spotPrice,
      liq: Math.round(liq * 1_000_000) / 1_000_000,
      opened_at: Date.now(),
    };
    onPaperOpen(pos);
    toast({
      title: `Paper ${futSide.toUpperCase()} opened`,
      description: `Size $${pos.size_usd.toLocaleString()} · ${futLeverage}x · entry $${pos.entry.toFixed(6)}`,
    });
    setFutCollateral("");
  };

  return (
    <Card className="p-0 overflow-hidden">
      {/* Mode tabs */}
      <div className="flex border-b border-border/60">
        <button
          onClick={() => setMode("spot")}
          className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
            mode === "spot"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
          data-testid="ticket-mode-spot"
        >
          <ArrowDownUp className="h-4 w-4 inline mr-1.5" />
          Spot
        </button>
        <button
          onClick={() => setMode("futures")}
          className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
            mode === "futures"
              ? "bg-amber-500/10 text-amber-300 border-b-2 border-amber-400"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
          data-testid="ticket-mode-futures"
        >
          <TrendingUp className="h-4 w-4 inline mr-1.5" />
          Futures
          <Badge variant="outline" className="ml-1.5 text-[9px] py-0 px-1.5 text-amber-300 border-amber-400/40">
            PAPER
          </Badge>
        </button>
      </div>

      {mode === "spot" ? (
        <div className="p-4 space-y-3">
          {/* Buy/Sell toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setDirection("zusd_to_zbx"); setAmountIn(""); }}
              className={`py-2 rounded-md text-sm font-semibold transition-colors ${
                direction === "zusd_to_zbx"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                  : "border border-border/60 text-muted-foreground hover:text-foreground"
              }`}
              data-testid="ticket-buy"
            >
              Buy ZBX
            </button>
            <button
              onClick={() => { setDirection("zbx_to_zusd"); setAmountIn(""); }}
              className={`py-2 rounded-md text-sm font-semibold transition-colors ${
                direction === "zbx_to_zusd"
                  ? "bg-red-500/15 text-red-300 border border-red-500/40"
                  : "border border-border/60 text-muted-foreground hover:text-foreground"
              }`}
              data-testid="ticket-sell"
            >
              Sell ZBX
            </button>
          </div>

          {/* Order type tabs */}
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background/40 p-0.5">
            {(["market", "limit", "stop"] as SpotType[]).map((t) => (
              <button
                key={t}
                onClick={() => setSpotType(t)}
                className={`flex-1 py-1.5 text-[11px] uppercase tracking-wider font-semibold rounded transition-colors ${
                  spotType === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`ticket-type-${t}`}
              >
                {t}
                {t !== "market" && (
                  <span className="ml-1 text-[8px] text-amber-300/80">BETA</span>
                )}
              </button>
            ))}
          </div>

          {/* Amount input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>You pay ({inputSym})</span>
              <button
                onClick={() => {
                  const raw = direction === "zbx_to_zusd" ? zbxBalance : zusdBalance;
                  try {
                    setAmountIn(formatToken(BigInt(raw || "0"), 6));
                  } catch {
                    setAmountIn("0");
                  }
                }}
                className="text-primary hover:underline normal-case"
              >
                bal {inputBalDisplay} · max
              </button>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.0"
              className="font-mono text-lg h-12"
              data-testid="ticket-amount"
            />
          </div>

          {/* Trigger price for limit / stop */}
          {spotType !== "market" && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Trigger price (USD per ZBX)
              </div>
              <Input
                type="number"
                inputMode="decimal"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                placeholder={spotPrice ? spotPrice.toFixed(6) : "0.0"}
                className="font-mono"
                data-testid="ticket-trigger"
              />
              <div className="text-[10px] text-amber-300/80 flex items-start gap-1.5 pt-1">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>
                  Trigger orders are kept locally in this browser. When the price condition is met, you confirm
                  and it routes through the AMM as a market swap. The on-chain order book ships in v2.
                </span>
              </div>
            </div>
          )}

          {/* Slippage */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Slippage</div>
            <div className="flex items-center gap-2">
              {[0.5, 1, 3].map((p) => (
                <button
                  key={p}
                  onClick={() => setSlippagePct(p)}
                  className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
                    slippagePct === p
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p}%
                </button>
              ))}
              <Input
                type="number"
                value={slippagePct}
                onChange={(e) => setSlippagePct(Math.max(0.01, Math.min(50, parseFloat(e.target.value) || 0.01)))}
                className="h-8 w-20 font-mono text-xs"
              />
            </div>
          </div>

          {/* Quote */}
          <div className="rounded-md bg-muted/30 border border-border/40 p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">You receive</span>
              <span className="font-mono font-semibold">
                {quoteLoading ? "…" : expectedOutNum != null ? `${expectedOutNum.toFixed(6)} ${outputSym}` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Min after slippage</span>
              <span className="font-mono">
                {minOutWei > 0n
                  ? `${formatToken(minOutWei, 6)} ${outputSym}`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price impact</span>
              <span className={`font-mono ${quote && quote.price_impact_bps > 100 ? "text-amber-400" : ""}`}>
                {quote ? `${(quote.price_impact_bps / 100).toFixed(2)}%` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pool fee (0.30%)</span>
              <span className="font-mono">
                {quote && quote.fee_in
                  ? `${formatToken(quote.fee_in, 6)} ${inputSym}`
                  : "—"}
              </span>
            </div>
          </div>

          {quote && !quote.would_succeed && quote.reason && (
            <div className="text-xs text-red-400 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{quote.reason}</span>
            </div>
          )}

          <Button
            onClick={onSubmitSpot}
            disabled={submitting || !active || (spotType === "market" && (!quote || !quote.would_succeed))}
            className="w-full h-11 font-semibold"
            data-testid="ticket-submit"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {!active
              ? "Connect wallet"
              : spotType === "market"
                ? `${direction === "zbx_to_zusd" ? "Sell" : "Buy"} ZBX`
                : `Place ${spotType.toUpperCase()} order`}
          </Button>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 flex items-start gap-2 text-[11px]">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span className="text-amber-200/90">
              <strong>Paper Trading.</strong> Positions are simulated against the live ZBX/zUSD price for testing your
              strategy. No on-chain perpetuals are settled. Real perp trading lands in Zebvix Perp v1.
            </span>
          </div>

          {/* Long / Short */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setFutSide("long")}
              className={`py-2 rounded-md text-sm font-semibold transition-colors ${
                futSide === "long"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                  : "border border-border/60 text-muted-foreground"
              }`}
              data-testid="fut-long"
            >
              <TrendingUp className="h-4 w-4 inline mr-1.5" />
              Long
            </button>
            <button
              onClick={() => setFutSide("short")}
              className={`py-2 rounded-md text-sm font-semibold transition-colors ${
                futSide === "short"
                  ? "bg-red-500/15 text-red-300 border border-red-500/40"
                  : "border border-border/60 text-muted-foreground"
              }`}
              data-testid="fut-short"
            >
              <TrendingDown className="h-4 w-4 inline mr-1.5" />
              Short
            </button>
          </div>

          {/* Collateral */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Collateral (zUSD)
            </div>
            <Input
              type="number"
              inputMode="decimal"
              value={futCollateral}
              onChange={(e) => setFutCollateral(e.target.value)}
              placeholder="100"
              className="font-mono text-lg h-12"
              data-testid="fut-collateral"
            />
          </div>

          {/* Leverage slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Leverage</span>
              <span className="font-mono text-primary text-sm">{futLeverage}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={futLeverage}
              onChange={(e) => setFutLeverage(Number(e.target.value))}
              className="w-full accent-primary"
              data-testid="fut-leverage"
            />
            <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
              <span>1x</span><span>10x</span><span>25x</span><span>50x</span>
            </div>
          </div>

          {/* Calculated stats */}
          <div className="rounded-md bg-muted/30 border border-border/40 p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Position size</span>
              <span className="font-mono font-semibold">
                ${((parseFloat(futCollateral) || 0) * futLeverage).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Entry (mark)</span>
              <span className="font-mono">{spotPrice != null ? `$${spotPrice.toFixed(6)}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Liquidation</span>
              <span className="font-mono text-amber-400">
                {spotPrice != null
                  ? `$${(futSide === "long"
                      ? spotPrice * (1 - 1 / futLeverage)
                      : spotPrice * (1 + 1 / futLeverage)).toFixed(6)}`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Funding (8h)</span>
              <span className="font-mono">~ 0.01%</span>
            </div>
          </div>

          <Button
            onClick={onOpenPaper}
            disabled={spotPrice == null || spotPrice <= 0 || !(parseFloat(futCollateral) > 0)}
            className={`w-full h-11 font-semibold ${
              futSide === "long"
                ? "bg-emerald-500 hover:bg-emerald-500/90 text-white disabled:bg-emerald-500/40"
                : "bg-red-500 hover:bg-red-500/90 text-white disabled:bg-red-500/40"
            }`}
            data-testid="fut-submit"
          >
            {spotPrice == null
              ? "Waiting for live price…"
              : !(parseFloat(futCollateral) > 0)
                ? "Enter collateral"
                : `Open paper ${futSide} ${futLeverage}x`}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool Stats panel
// ─────────────────────────────────────────────────────────────────────────────

function PoolStatsPanel({ stats }: { stats: PoolStats | null }) {
  if (!stats) {
    return (
      <Card className="p-5">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        <span className="text-sm text-muted-foreground">Loading pool…</span>
      </Card>
    );
  }
  const tvlUsd = (Number(BigInt(stats.zusd_reserve) / 10n ** 12n) / 1_000_000) * 2;
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Droplets className="h-4 w-4 text-cyan-400" />
        <h3 className="font-semibold text-sm">ZBX / zUSD AMM Pool</h3>
        <Badge variant="outline" className="ml-auto text-emerald-400 border-emerald-400/30">
          {stats.pool_initialized ? "live" : "uninitialized"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spot price</div>
          <div className="font-mono font-semibold">${parseFloat(stats.spot_price_usd_per_zbx).toFixed(6)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pool TVL</div>
          <div className="font-mono font-semibold">${fmtUsd(tvlUsd, 2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ZBX reserve</div>
          <div className="font-mono">{formatToken(stats.zbx_reserve_wei, 4)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">zUSD reserve</div>
          <div className="font-mono">${formatToken(stats.zusd_reserve, 2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lifetime fees</div>
          <div className="font-mono">${formatToken(stats.lifetime_fees_zusd, 4)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Window swaps</div>
          <div className="font-mono">{stats.window_swap_count}</div>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent Trades feed
// ─────────────────────────────────────────────────────────────────────────────

function RecentTradesPanel({ swaps, loading }: { swaps: RecentSwap[]; loading: boolean }) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-400" />
        <h3 className="font-semibold text-sm">Recent on-chain trades</h3>
        <Badge variant="outline" className="ml-auto text-[10px]">
          live index
        </Badge>
      </div>
      {loading && swaps.length === 0 && (
        <div className="text-sm text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin inline mr-2" />loading…
        </div>
      )}
      {swaps.length === 0 && !loading && (
        <div className="text-sm text-muted-foreground italic py-4 text-center">
          No swaps indexed yet — be the first.
        </div>
      )}
      {swaps.length > 0 && (
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-1 sticky top-0 bg-card">
            <div className="col-span-2">Block</div>
            <div className="col-span-4">From</div>
            <div className="col-span-3 text-right">Amount In</div>
            <div className="col-span-3 text-right">Age</div>
          </div>
          {swaps.map((s) => (
            <div key={s.seq} className="grid grid-cols-12 gap-2 text-xs py-1 hover:bg-muted/30 rounded">
              <div className="col-span-2 font-mono text-cyan-400">#{s.height}</div>
              <div className="col-span-4 font-mono">{shortAddr(s.from, 6, 4)}</div>
              <div className="col-span-3 text-right font-mono">{formatToken(s.amount_in, 4)}</div>
              <div className="col-span-3 text-right text-muted-foreground">{fmtAge(s.timestamp_ms)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet + Paper Positions panel
// ─────────────────────────────────────────────────────────────────────────────

function WalletPositionsPanel({
  active,
  zbxBalance,
  zusdBalance,
  positions,
  spotPrice,
  onClosePosition,
}: {
  active: string | null;
  zbxBalance: string;
  zusdBalance: string;
  positions: PaperPosition[];
  spotPrice: number | null;
  onClosePosition: (id: string) => void;
}) {
  const [tab, setTab] = useState<"wallet" | "paper">("wallet");
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex border-b border-border/60">
        <button
          onClick={() => setTab("wallet")}
          className={`flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            tab === "wallet" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          }`}
          data-testid="wallet-tab-wallet"
        >
          <WalletIcon className="h-3.5 w-3.5 inline mr-1.5" />
          Wallet
        </button>
        <button
          onClick={() => setTab("paper")}
          className={`flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            tab === "paper" ? "text-amber-300 border-b-2 border-amber-400" : "text-muted-foreground"
          }`}
          data-testid="wallet-tab-paper"
        >
          <Flame className="h-3.5 w-3.5 inline mr-1.5" />
          Positions
          {positions.length > 0 && (
            <span className="ml-1.5 inline-block bg-amber-500/20 text-amber-300 text-[10px] font-mono px-1.5 py-0.5 rounded">
              {positions.length}
            </span>
          )}
        </button>
      </div>

      <div className="p-4">
        {tab === "wallet" ? (
          <div className="space-y-3">
            {!active ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                <WalletIcon className="h-5 w-5 mx-auto mb-2 opacity-50" />
                <div>No wallet connected</div>
                <Link href="/wallet">
                  <span className="text-primary hover:underline text-xs cursor-pointer">
                    Open wallet manager →
                  </span>
                </Link>
              </div>
            ) : (
              <>
                <div className="rounded-md bg-muted/30 border border-border/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Active address
                  </div>
                  <div className="font-mono text-xs flex items-center gap-2">
                    {shortAddr(active, 8, 6)}
                    <button
                      onClick={() => navigator.clipboard?.writeText(active)}
                      className="text-muted-foreground hover:text-foreground"
                      title="copy"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted/20 border border-border/40 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ZBX</div>
                    <div className="font-mono text-base font-semibold">
                      {formatToken(zbxBalance, 6)}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/20 border border-border/40 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">zUSD</div>
                    <div className="font-mono text-base font-semibold">
                      ${formatToken(zusdBalance, 2)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {positions.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                <Flame className="h-5 w-5 mx-auto mb-2 opacity-50" />
                <div>No paper positions</div>
                <div className="text-[11px] mt-1">Open a futures position from the ticket above.</div>
              </div>
            ) : (
              positions.map((p) => {
                const pnl = spotPrice == null ? null : (p.side === "long"
                  ? (spotPrice - p.entry) / p.entry
                  : (p.entry - spotPrice) / p.entry) * p.leverage * (p.size_usd / p.leverage);
                const pnlPct = spotPrice == null ? null : (p.side === "long"
                  ? (spotPrice - p.entry) / p.entry
                  : (p.entry - spotPrice) / p.entry) * p.leverage * 100;
                return (
                  <div key={p.id} className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={p.side === "long"
                            ? "text-emerald-300 border-emerald-500/40"
                            : "text-red-300 border-red-500/40"}
                        >
                          {p.side.toUpperCase()} {p.leverage}x
                        </Badge>
                        <span className="font-mono">${p.size_usd.toFixed(2)}</span>
                      </div>
                      <button
                        onClick={() => onClosePosition(p.id)}
                        className="text-[10px] text-muted-foreground hover:text-red-400"
                        data-testid={`fut-close-${p.id}`}
                      >
                        Close
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <div className="text-muted-foreground">Entry</div>
                        <div className="font-mono">${p.entry.toFixed(6)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Mark</div>
                        <div className="font-mono">{spotPrice != null ? `$${spotPrice.toFixed(6)}` : "—"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Liq</div>
                        <div className="font-mono text-amber-400">${p.liq.toFixed(6)}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-border/30">
                      <span className="text-muted-foreground">PnL</span>
                      <span className={`font-mono font-semibold ${
                        pnl == null ? "" : pnl >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {pnl == null
                          ? "—"
                          : `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${(pnlPct ?? 0).toFixed(2)}%)`}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shortcuts grid
// ─────────────────────────────────────────────────────────────────────────────

const ROUTES = [
  { href: "/swap",            icon: ArrowDownUp, title: "Classic Swap",      desc: "Standalone ZBX ↔ zUSD swap interface." },
  { href: "/pool-explorer",   icon: Droplets,    title: "Pool Explorer",     desc: "Drill into reserves, fees, and LP activity." },
  { href: "/token-create",    icon: Sparkles,    title: "Create Your Token", desc: "Mint a new token on Zebvix in one click." },
  { href: "/token-trade",     icon: BarChart3,   title: "Token Trade",       desc: "Trade any pair via the AMM router." },
  { href: "/token-liquidity", icon: Layers,      title: "Add Liquidity",     desc: "Earn fees by depositing token pairs." },
  { href: "/token-metadata",  icon: Coins,       title: "Token Metadata",    desc: "Set logo, decimals, and supply." },
];

function ShortcutsGrid() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-4 h-4 text-primary" />
          More DEX tools
        </CardTitle>
        <CardDescription>Direct links to all trading and liquidity flows on chain 7878.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROUTES.map((r) => {
            const Icon = r.icon;
            return (
              <Link key={r.href} href={r.href}>
                <span className="group block rounded-lg border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/60 p-3 cursor-pointer transition-colors h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-8 w-8 shrink-0 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <Icon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {r.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{r.desc}</div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />
                  </div>
                </span>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function Dex() {
  const { remote, isRemote } = useWallet();
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [localActive, setLocalActive] = useState<string | null>(null);
  const active: string | null = isRemote && remote ? remote.address : localActive;

  const [zbxBalance, setZbxBalance] = useState<string>("0");
  const [zusdBalance, setZusdBalance] = useState<string>("0");
  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [recentSwaps, setRecentSwaps] = useState<RecentSwap[]>([]);
  const [swapsLoading, setSwapsLoading] = useState(true);
  const [history, setHistory] = useState<PricePoint[]>(() => loadPriceHistory());
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [positions, setPositions] = useState<PaperPosition[]>(() => loadPaperPositions());

  // Wallets
  useEffect(() => {
    const ws = loadWallets();
    setWallets(ws);
    const a = getActiveAddress();
    setLocalActive(a && ws.some((w) => w.address === a) ? a : ws[0]?.address ?? null);
  }, []);

  const refreshBalances = async (addr: string | null) => {
    if (!addr) { setZbxBalance("0"); setZusdBalance("0"); return; }
    try {
      const [zbxRaw, zusdRaw] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<string>("zbx_getZusdBalance", [addr]).catch(() => "0"),
      ]);
      const zbxWei = typeof zbxRaw === "string" && zbxRaw.startsWith("0x")
        ? BigInt(zbxRaw)
        : BigInt(zbxRaw || "0");
      setZbxBalance(zbxWei.toString());
      setZusdBalance(typeof zusdRaw === "string" ? zusdRaw : String(zusdRaw ?? "0"));
    } catch {
      // best-effort
    }
  };

  useEffect(() => { refreshBalances(active); }, [active]);

  // Pool stats — also drives the price chart sampling
  const refreshPool = async () => {
    try {
      const s = await rpc<PoolStats>("zbx_poolStats", [200]);
      setPoolStats(s);
      setPoolLoading(false);
      const p = parseFloat(s.spot_price_usd_per_zbx);
      if (Number.isFinite(p) && p > 0) {
        setHistory((prev) => {
          const last = prev[prev.length - 1];
          // Only push if at least 4s elapsed since last sample to avoid spam
          if (!last || Date.now() - last.t > 4000) {
            const next = [...prev, { t: Date.now(), p }];
            // Cap history to 7d in memory (savePriceHistory also caps)
            const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
            const trimmed = next.filter((x) => x.t >= cutoff);
            savePriceHistory(trimmed);
            return trimmed;
          }
          return prev;
        });
      }
    } catch {
      setPoolLoading(false);
    }
  };

  useEffect(() => {
    refreshPool();
    const t = setInterval(refreshPool, 5000);
    return () => clearInterval(t);
  }, []);

  // Recent swaps
  const refreshSwaps = async () => {
    try {
      const r = await rpc<{ swaps: RecentSwap[] }>("zbx_recentSwaps", [50]);
      setRecentSwaps(r.swaps ?? []);
      setSwapsLoading(false);
    } catch {
      setSwapsLoading(false);
    }
  };
  useEffect(() => {
    refreshSwaps();
    const t = setInterval(refreshSwaps, 6000);
    return () => clearInterval(t);
  }, []);

  // Persist paper positions
  useEffect(() => { savePaperPositions(positions); }, [positions]);

  const spotPrice = poolStats ? parseFloat(poolStats.spot_price_usd_per_zbx) : null;

  // Ticker stats
  const tickerStats: TickerStats = useMemo(() => {
    const last = spotPrice ?? 0;
    const cutoff24h = Date.now() - 24 * 3600 * 1000;
    const win = history.filter((p) => p.t >= cutoff24h);
    const high24h = win.length ? Math.max(...win.map((p) => p.p)) : null;
    const low24h = win.length ? Math.min(...win.map((p) => p.p)) : null;
    const first24h = win[0]?.p ?? null;
    const change24hPct = first24h && Number.isFinite(spotPrice ?? NaN) && first24h > 0 && spotPrice != null
      ? ((spotPrice - first24h) / first24h) * 100
      : null;
    // Volume: sum amount_in (assumed wei-18) over swaps in last 24h
    let vol = 0;
    for (const s of recentSwaps) {
      if (s.timestamp_ms >= cutoff24h) {
        try {
          const w = BigInt(s.amount_in);
          vol += Number(w / 10n ** 12n) / 1_000_000;
        } catch {/* ignore */}
      }
    }
    const tvlUsd = poolStats
      ? (Number(BigInt(poolStats.zusd_reserve) / 10n ** 12n) / 1_000_000) * 2
      : null;
    return {
      last,
      change24hPct,
      high24h,
      low24h,
      volume24hZbx: recentSwaps.length > 0 ? vol : null,
      tvlUsd,
    };
  }, [history, spotPrice, recentSwaps, poolStats]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
      {/* Hero strip */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Zebvix Trade</h1>
              <Badge variant="outline" className="text-primary border-primary/40">DEX</Badge>
              <Badge variant="outline" className="text-amber-300 border-amber-500/40">PRO</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              On-chain spot · paper futures · live AMM book on chain 7878
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/pool-explorer">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted/50 cursor-pointer">
              <Droplets className="h-3.5 w-3.5 text-muted-foreground" />
              Pools
            </span>
          </Link>
          <Link href="/wallet">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted/50 cursor-pointer">
              <WalletIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Wallet
            </span>
          </Link>
        </div>
      </div>

      {/* Ticker */}
      <PairTicker stats={tickerStats} loading={poolLoading} />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <PriceChart
            history={history}
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            spotNow={spotPrice}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PoolStatsPanel stats={poolStats} />
            <RecentTradesPanel swaps={recentSwaps} loading={swapsLoading} />
          </div>
        </div>
        <div className="space-y-4">
          <OrderTicket
            poolStats={poolStats}
            spotPrice={spotPrice}
            active={active}
            zbxBalance={zbxBalance}
            zusdBalance={zusdBalance}
            onSubmittedSwap={() => {
              setTimeout(() => {
                refreshBalances(active);
                refreshPool();
                refreshSwaps();
              }, 2500);
            }}
            onPaperOpen={(p) => setPositions((prev) => [p, ...prev])}
          />
          <WalletPositionsPanel
            active={active}
            zbxBalance={zbxBalance}
            zusdBalance={zusdBalance}
            positions={positions}
            spotPrice={spotPrice}
            onClosePosition={(id) => setPositions((prev) => prev.filter((p) => p.id !== id))}
          />
        </div>
      </div>

      {/* Shortcuts */}
      <ShortcutsGrid />

      {/* Footer trust note */}
      <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-4 rounded-md flex gap-3 text-sm">
        <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-emerald-200">Pool reserves are public.</div>
          <div className="text-muted-foreground">
            Every swap settles through the on-chain ZBX/zUSD AMM. The pool address has no admin key — its
            balances and trade history are queryable via any Zebvix RPC endpoint or directly through{" "}
            <Link href="/pool-explorer">
              <span className="text-emerald-400 hover:underline cursor-pointer">Pool Explorer</span>
            </Link>
            . LPs receive receipts pro-rata to their share.
          </div>
        </div>
      </div>
    </div>
  );
}
