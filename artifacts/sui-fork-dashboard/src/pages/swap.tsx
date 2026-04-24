import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  ArrowUpDown,
  RefreshCw,
  AlertTriangle,
  Wallet as WalletIcon,
  Zap,
  TrendingUp,
  Activity,
  Loader2,
  Settings,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { rpc, shortAddr } from "@/lib/zbx-rpc";
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
import { Link } from "wouter";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const SCALE_18 = 10n ** 18n;

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

function fmtAge(ms: number): string {
  const d = Date.now() - ms;
  if (d < 0) return "now";
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// ────────────────────────────────────────────────────────────────────────────
// Pool stats panel
// ────────────────────────────────────────────────────────────────────────────

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

function PoolPanel({ stats }: { stats: PoolStats | null }) {
  if (!stats) {
    return (
      <Card className="p-5">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        <span className="text-sm text-muted-foreground">Loading pool…</span>
      </Card>
    );
  }
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-emerald-400" />
        <h3 className="font-semibold">ZBX / zUSD Pool</h3>
        <Badge variant="outline" className="ml-auto text-emerald-400 border-emerald-400/30">
          {stats.pool_initialized ? "live" : "uninitialized"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Spot price</div>
          <div className="font-mono font-semibold">${parseFloat(stats.spot_price_usd_per_zbx).toFixed(6)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Pool fee</div>
          <div className="font-mono font-semibold">0.30%</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">ZBX reserve</div>
          <div className="font-mono">{formatToken(stats.zbx_reserve_wei, 4)} ZBX</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">zUSD reserve</div>
          <div className="font-mono">${formatToken(stats.zusd_reserve, 2)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Genesis loan</div>
          <div className="font-mono">
            {stats.loan_repaid ? (
              <span className="text-emerald-400">repaid ✓</span>
            ) : (
              <>${formatToken(stats.loan_outstanding_zusd, 2)} left</>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Lifetime fees</div>
          <div className="font-mono">${formatToken(stats.lifetime_fees_zusd, 4)}</div>
        </div>
      </div>
      <div className="pt-2 border-t border-border/40 text-xs text-muted-foreground">
        Recent window: <span className="text-foreground font-mono">{stats.window_swap_count}</span> swaps
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Recent Swaps panel
// ────────────────────────────────────────────────────────────────────────────

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

function RecentSwapsPanel() {
  const [swaps, setSwaps] = useState<RecentSwap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await rpc<{ swaps: RecentSwap[] }>("zbx_recentSwaps", [10]);
      setSwaps(r.swaps ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-400" />
        <h3 className="font-semibold">Recent on-chain swaps</h3>
        <Badge variant="outline" className="ml-auto text-xs">
          ⚡ on-chain index
        </Badge>
      </div>
      {err && (
        <div className="text-xs text-red-400">error: {err}</div>
      )}
      {!swaps && !err && (
        <div className="text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-2" />loading…</div>
      )}
      {swaps && swaps.length === 0 && (
        <div className="text-sm text-muted-foreground italic py-4 text-center">
          no swaps indexed yet — be the first!
        </div>
      )}
      {swaps && swaps.length > 0 && (
        <div className="space-y-1">
          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-1">
            <div className="col-span-2">Block</div>
            <div className="col-span-4">From</div>
            <div className="col-span-3 text-right">Amount In</div>
            <div className="col-span-3 text-right">Age</div>
          </div>
          {swaps.map(s => (
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

// ────────────────────────────────────────────────────────────────────────────
// Main Swap page
// ────────────────────────────────────────────────────────────────────────────

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

export default function SwapPage() {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [zbxBalance, setZbxBalance] = useState<string>("0");
  const [zusdBalance, setZusdBalance] = useState<string>("0");
  const [direction, setDirection] = useState<SwapDirection>("zbx_to_zusd");
  const [amountIn, setAmountIn] = useState<string>("");
  const [slippagePct, setSlippagePct] = useState<number>(1); // %
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; msg: string; hash?: string } | null>(null);

  const inputSym = direction === "zbx_to_zusd" ? "ZBX" : "zUSD";
  const outputSym = direction === "zbx_to_zusd" ? "zUSD" : "ZBX";

  // ── Load wallets and balances ───────────────────────────────────────
  useEffect(() => {
    const ws = loadWallets();
    setWallets(ws);
    const a = getActiveAddress();
    setActive(a && ws.some(w => w.address === a) ? a : ws[0]?.address ?? null);
  }, []);

  const refreshBalances = async (addr: string | null) => {
    if (!addr) { setZbxBalance("0"); setZusdBalance("0"); return; }
    try {
      const [zbxRaw, zusdRaw] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<string>("zbx_getZusdBalance", [addr]).catch(() => "0"),
      ]);
      // zbx balance is hex, zusd is decimal string
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

  // ── Refresh pool stats ──────────────────────────────────────────────
  const refreshPool = async () => {
    try {
      const s = await rpc<PoolStats>("zbx_poolStats", [200]);
      setPoolStats(s);
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    refreshPool();
    const t = setInterval(refreshPool, 5000);
    return () => clearInterval(t);
  }, []);

  // ── Live quote (debounced) ──────────────────────────────────────────
  const amountInWei = useMemo(() => {
    try {
      if (!amountIn || parseFloat(amountIn) <= 0) return 0n;
      return direction === "zbx_to_zusd" ? zbxToWei(amountIn) : zusdToMicros(amountIn);
    } catch {
      return 0n;
    }
  }, [amountIn, direction]);

  useEffect(() => {
    if (amountInWei === 0n) { setQuote(null); return; }
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
  }, [direction, amountInWei]);

  // ── Slippage & min-out calc ─────────────────────────────────────────
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

  // ── Flip direction ──────────────────────────────────────────────────
  const flip = () => {
    setDirection(d => d === "zbx_to_zusd" ? "zusd_to_zbx" : "zbx_to_zusd");
    setAmountIn("");
    setQuote(null);
  };

  // ── Submit swap ─────────────────────────────────────────────────────
  const onSubmit = async () => {
    if (!active) { toast({ title: "no wallet", description: "create or import a wallet first" }); return; }
    if (!quote || !quote.would_succeed) { toast({ title: "quote unavailable", description: quote?.reason ?? "enter an amount first" }); return; }
    const w = getWallet(active);
    if (!w) { toast({ title: "wallet not found" }); return; }

    setSubmitting(true);
    setLastResult(null);
    try {
      const r = await sendSwap({
        privateKeyHex: w.privateKey,
        direction,
        amountIn: amountInWei,
        minOut: minOutWei,
        feeZbx: "0.002",
      });
      setLastResult({ ok: true, msg: `swap submitted — output ≥ ${formatToken(minOutWei, 6)} ${outputSym}`, hash: r.hash });
      recordTx({
        hash: r.hash || null,
        from: active,
        to: active,
        amountZbx: amountIn,
        feeZbx: "0.002",
        ts: Date.now(),
        status: "submitted",
      });
      toast({ title: "swap submitted", description: r.hash ? r.hash.slice(0, 18) + "…" : "" });
      // refresh balances after a short delay so the new block lands
      setTimeout(() => refreshBalances(active), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResult({ ok: false, msg });
      toast({ title: "swap failed", description: msg.slice(0, 100), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Validation ──────────────────────────────────────────────────────
  const insufficientBalance = useMemo(() => {
    if (amountInWei === 0n) return false;
    const have = direction === "zbx_to_zusd" ? BigInt(zbxBalance) : BigInt(zusdBalance);
    return have < amountInWei;
  }, [amountInWei, direction, zbxBalance, zusdBalance]);

  // Every swap pays the gas fee in ZBX from .balance, regardless of direction.
  // For ZbxToZusd we also need `amountIn` worth of ZBX in .balance.
  const FEE_ZBX_WEI = useMemo(() => zbxToWei("0.002"), []);
  const insufficientGas = useMemo(() => {
    if (!active) return false;
    try {
      const haveZbx = BigInt(zbxBalance);
      if (direction === "zbx_to_zusd") {
        // need amountIn + fee in ZBX
        return haveZbx < (amountInWei + FEE_ZBX_WEI);
      }
      // zusd_to_zbx: only need fee in ZBX (amount is in zUSD)
      return haveZbx < FEE_ZBX_WEI;
    } catch { return false; }
  }, [active, zbxBalance, direction, amountInWei, FEE_ZBX_WEI]);

  const priceImpactWarning = useMemo(() => {
    if (!quote || !quote.would_succeed) return null;
    const bps = quote.price_impact_bps;
    if (bps >= 500) return { level: "high" as const, msg: `high price impact: ${(bps / 100).toFixed(2)}%` };
    if (bps >= 100) return { level: "med" as const, msg: `notable price impact: ${(bps / 100).toFixed(2)}%` };
    return null;
  }, [quote]);

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <ArrowUpDown className="h-7 w-7 text-emerald-400" />
          <h1 className="text-3xl font-bold">Swap (Buy / Sell)</h1>
          <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
            Phase B.10 · on-chain
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Permissionless ZBX / zUSD AMM swap with on-chain slippage protection.
          Every swap is an explicit <code className="text-xs bg-muted px-1 rounded">TxKind::Swap</code> tx — if the pool
          would return less than your <code className="text-xs bg-muted px-1 rounded">min_out</code>, the chain reverts and refunds your
          principal (only the gas fee is consumed).
        </p>
      </div>

      {/* Active wallet card */}
      {!active ? (
        <Card className="p-5 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">No wallet active</div>
              <div className="text-sm text-muted-foreground">
                Create or import one on the Wallet page first.
              </div>
            </div>
            <Link href="/wallet">
              <Button size="sm">Open Wallet →</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <WalletIcon className="h-5 w-5 text-cyan-400" />
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Active wallet</div>
              <div className="font-mono text-sm">{shortAddr(active, 10, 8)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">ZBX</div>
              <div className="font-mono font-semibold">{formatToken(zbxBalance, 4)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">zUSD</div>
              <div className="font-mono font-semibold">${formatToken(zusdBalance, 2)}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => refreshBalances(active)}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {wallets.length > 1 && (
              <select
                className="bg-background border border-border rounded px-2 py-1 text-xs"
                value={active}
                onChange={e => setActive(e.target.value)}
                data-testid="select-active-wallet"
              >
                {wallets.map(w => (
                  <option key={w.address} value={w.address}>
                    {w.label} ({shortAddr(w.address, 4, 4)})
                  </option>
                ))}
              </select>
            )}
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Swap form (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-6 space-y-4">
            {/* Input section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">You pay</label>
                <span className="text-xs text-muted-foreground">
                  Bal: <span className="font-mono">
                    {formatToken(direction === "zbx_to_zusd" ? zbxBalance : zusdBalance, 4)}
                  </span> {inputSym}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  placeholder="0.0"
                  value={amountIn}
                  onChange={e => setAmountIn(e.target.value)}
                  className="flex-1 text-lg font-mono"
                  data-testid="input-amount-in"
                />
                <div className="w-24 flex items-center justify-center bg-muted rounded-md font-semibold">
                  {inputSym}
                </div>
              </div>
              <div className="flex gap-1">
                {[25, 50, 75, 100].map(p => (
                  <Button
                    key={p}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 flex-1"
                    onClick={() => {
                      try {
                        const have = direction === "zbx_to_zusd" ? BigInt(zbxBalance) : BigInt(zusdBalance);
                        // for ZBX, leave 0.01 ZBX for fee
                        const reserve = direction === "zbx_to_zusd" ? zbxToWei("0.01") : 0n;
                        const usable = have > reserve ? have - reserve : 0n;
                        const portion = (usable * BigInt(p)) / 100n;
                        // format back to decimal string
                        const whole = portion / SCALE_18;
                        const frac = portion % SCALE_18;
                        const fracStr = (frac + SCALE_18).toString().slice(1).slice(0, 8).replace(/0+$/, "");
                        setAmountIn(fracStr ? `${whole}.${fracStr}` : whole.toString());
                      } catch { /* noop */ }
                    }}
                  >
                    {p === 100 ? "MAX" : `${p}%`}
                  </Button>
                ))}
              </div>
            </div>

            {/* Flip button */}
            <div className="flex justify-center">
              <Button variant="outline" size="icon" onClick={flip} data-testid="button-flip-direction">
                <ArrowDownUp className="h-4 w-4" />
              </Button>
            </div>

            {/* Output section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">You receive (estimated)</label>
                {quoteLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex gap-2">
                <div className="flex-1 px-3 py-2 bg-muted/30 rounded-md font-mono text-lg min-h-[40px] flex items-center">
                  {quote?.would_succeed
                    ? formatToken(quote.expected_out, 6)
                    : <span className="text-muted-foreground">—</span>}
                </div>
                <div className="w-24 flex items-center justify-center bg-muted rounded-md font-semibold">
                  {outputSym}
                </div>
              </div>
            </div>

            {/* Slippage tolerance */}
            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="flex items-center gap-2">
                <Settings className="h-3 w-3 text-muted-foreground" />
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Slippage tolerance</label>
                <span className="ml-auto text-xs font-mono">{slippagePct}%</span>
              </div>
              <div className="flex gap-1">
                {[0.5, 1, 3, 5].map(p => (
                  <Button
                    key={p}
                    variant={slippagePct === p ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSlippagePct(p)}
                    className="flex-1 text-xs h-8"
                    data-testid={`button-slippage-${p}`}
                  >
                    {p}%
                  </Button>
                ))}
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="50"
                  placeholder="custom"
                  className="w-24 h-8 text-xs"
                  value={[0.5, 1, 3, 5].includes(slippagePct) ? "" : slippagePct.toString()}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0 && v <= 50) setSlippagePct(v);
                  }}
                  data-testid="input-custom-slippage"
                />
              </div>
            </div>

            {/* Quote details */}
            {quote && quote.would_succeed && (
              <div className="space-y-1 pt-3 border-t border-border/40 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pool fee (0.30%)</span>
                  <span className="font-mono">{formatToken(quote.fee_in, 6)} {inputSym}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price impact</span>
                  <span className={`font-mono ${
                    priceImpactWarning?.level === "high" ? "text-red-400" :
                    priceImpactWarning?.level === "med" ? "text-amber-400" : ""
                  }`}>
                    {(quote.price_impact_bps / 100).toFixed(4)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Min received ({slippagePct}% slip)</span>
                  <span className="font-mono">{formatToken(minOutWei, 6)} {outputSym}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network fee (gas)</span>
                  <span className="font-mono">~ 0.002 ZBX</span>
                </div>
              </div>
            )}

            {/* Quote error */}
            {quote && !quote.would_succeed && quote.reason && (
              <div className="text-xs text-red-400 pt-2 border-t border-border/40">
                ⚠️ {quote.reason}
              </div>
            )}

            {priceImpactWarning && (
              <div className={`p-2 rounded text-xs flex items-center gap-2 ${
                priceImpactWarning.level === "high" ? "bg-red-500/10 text-red-300 border border-red-500/30" :
                "bg-amber-500/10 text-amber-300 border border-amber-500/30"
              }`}>
                <AlertTriangle className="h-3 w-3" />
                {priceImpactWarning.msg} — consider a smaller amount.
              </div>
            )}

            {insufficientBalance && (
              <div className="p-2 rounded text-xs bg-red-500/10 text-red-300 border border-red-500/30">
                insufficient {inputSym} balance
              </div>
            )}

            {!insufficientBalance && insufficientGas && active && amountInWei > 0n && (
              <div className="p-2 rounded text-xs bg-red-500/10 text-red-300 border border-red-500/30">
                need at least 0.002 ZBX in this wallet to cover the network fee
                {direction === "zbx_to_zusd" ? " on top of the swap amount" : ""}
              </div>
            )}

            <Button
              className="w-full h-12 text-base"
              disabled={
                !active || submitting || !quote?.would_succeed ||
                insufficientBalance || insufficientGas || amountInWei === 0n
              }
              onClick={onSubmit}
              data-testid="button-submit-swap"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />signing & broadcasting…</>
              ) : !active ? (
                "connect a wallet"
              ) : insufficientBalance ? (
                `insufficient ${inputSym}`
              ) : insufficientGas ? (
                "insufficient ZBX for gas"
              ) : amountInWei === 0n ? (
                "enter an amount"
              ) : !quote?.would_succeed ? (
                "no quote available"
              ) : (
                <>
                  <TrendingUp className="h-4 w-4 mr-2" />
                  {direction === "zbx_to_zusd" ? "Sell ZBX for zUSD" : "Buy ZBX with zUSD"}
                </>
              )}
            </Button>

            {lastResult && (
              <div className={`p-3 rounded text-sm ${
                lastResult.ok ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                              : "bg-red-500/10 border border-red-500/30 text-red-300"
              }`}>
                <div className="flex items-start gap-2">
                  {lastResult.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                  : <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
                  <div className="flex-1 break-all">
                    {lastResult.msg}
                    {lastResult.hash && (
                      <div className="mt-1 font-mono text-xs opacity-80">
                        tx: {lastResult.hash}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>

          <RecentSwapsPanel />
        </div>

        {/* Right column — pool stats */}
        <div className="space-y-4">
          <PoolPanel stats={poolStats} />

          <Card className="p-4 text-xs space-y-2 bg-muted/20">
            <div className="font-semibold text-sm flex items-center gap-2">
              <ExternalLink className="h-3 w-3" />
              How it works
            </div>
            <p className="text-muted-foreground leading-relaxed">
              <strong>Constant-product AMM</strong> (x·y=k, Uniswap V2 style) with
              0.3% pool fee. Slippage guard is consensus-enforced: if the pool
              would return &lt; <code>min_out</code>, the swap reverts and your
              principal is refunded — only the gas fee is consumed.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Max per-swap size: 100,000 {inputSym}. Pool genesis loan is
              repaid first from collected fees; once cleared, 50% of fees go to
              the admin and 50% compound back into reserves.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
