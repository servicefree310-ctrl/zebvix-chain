import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ArrowDownUp,
  RefreshCw,
  Activity,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  TrendingUp,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  loadWallets,
  getActiveAddress,
  getWallet,
  zbxToWei,
  recordTx,
  type StoredWallet,
} from "@/lib/web-wallet";
import {
  listTokenPools,
  getTokenPool,
  getTokenSwapQuote,
  sendTokenPoolSwap,
  applySlippage,
  baseToDisplay,
  displayToBase,
  spotPriceZbxPerWholeToken,
  type TokenPoolJson,
  type TokenSwapDirectionStr,
} from "@/lib/tokens";
import { Link } from "wouter";
import { rpc } from "@/lib/zbx-rpc";

// ────────────────────────────────────────────────────────────────────────────
// Token-trade page — swap any ZBX-20 token vs native ZBX through its AMM pool.
// Mirrors the native swap.tsx flow: pool selector, direction toggle, live quote
// with slippage protection, recent swaps for the selected pool.
// ────────────────────────────────────────────────────────────────────────────

const SCALE_18 = 10n ** 18n;

function fmtZbx(weiStr: string | bigint, dp = 6): string {
  try {
    const w = typeof weiStr === "bigint" ? weiStr : BigInt(weiStr || "0");
    const whole = w / SCALE_18;
    const frac = w % SCALE_18;
    if (dp === 0) return whole.toString();
    const fracStr = (frac + SCALE_18).toString().slice(1).slice(0, dp).replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch { return "0"; }
}

function explorerUrl(hash: string): string {
  return `/block-explorer?tx=${hash}`;
}

interface TradeWalletState {
  address: string;
  privateKeyHex: string;
  zbxBalanceWei: bigint;
}

async function loadWalletState(): Promise<TradeWalletState | null> {
  const wallets = loadWallets();
  if (!wallets.length) return null;
  const active = getActiveAddress();
  const w: StoredWallet | undefined = (active ? getWallet(active) : undefined) ?? wallets[0];
  if (!w) return null;
  let bal = 0n;
  try {
    const res = await rpc<string>("zbx_getBalance", [w.address]);
    bal = BigInt(res || "0");
  } catch { bal = 0n; }
  return {
    address: w.address,
    privateKeyHex: w.privateKey,
    zbxBalanceWei: bal,
  };
}

async function getTokenBal(tokenId: number, addr: string): Promise<bigint> {
  try {
    const r = await rpc<{ balance: string }>("zbx_tokenBalanceOf", [tokenId, addr]);
    return BigInt(r?.balance || "0");
  } catch { return 0n; }
}

export default function TokenTradePage() {
  const { toast } = useToast();
  const [pools, setPools] = useState<TokenPoolJson[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pool, setPool] = useState<TokenPoolJson | null>(null);
  const [direction, setDirection] = useState<TokenSwapDirectionStr>("zbx_to_token");
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(100); // 1.00%
  const [showSettings, setShowSettings] = useState(false);
  const [quote, setQuote] = useState<{ amountOut: bigint; feeIn: bigint } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [wallet, setWallet] = useState<TradeWalletState | null>(null);
  const [tokenBal, setTokenBal] = useState<bigint>(0n);
  const [submitting, setSubmitting] = useState(false);
  const [lastTx, setLastTx] = useState<{ hash: string; out: string } | null>(null);
  const [recentSwaps, setRecentSwaps] = useState<any[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);

  // Load pools
  const refreshPools = useCallback(async () => {
    setPoolLoading(true);
    try {
      const r = await listTokenPools(0, 100);
      setPools(r.pools);
      if (!selectedId && r.pools.length) setSelectedId(r.pools[0].token_id);
    } catch (e) {
      toast({ title: "Couldn't load pools", description: String(e), variant: "destructive" });
    } finally {
      setPoolLoading(false);
    }
  }, [selectedId, toast]);

  useEffect(() => { refreshPools(); }, []);  // eslint-disable-line

  // Refresh selected pool detail + balances
  const refreshSelected = useCallback(async () => {
    if (!selectedId) { setPool(null); return; }
    const [p, w] = await Promise.all([getTokenPool(selectedId), loadWalletState()]);
    setPool(p);
    setWallet(w);
    if (p && w) {
      setTokenBal(await getTokenBal(p.token_id, w.address));
    } else { setTokenBal(0n); }
  }, [selectedId]);

  useEffect(() => { refreshSelected(); }, [selectedId, refreshSelected]);

  // Recent swaps (filter zbx_recentTxs by kind=TokenPoolSwap)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await rpc<{ txs: any[] }>("zbx_recentTxs", [200]);
        if (!alive) return;
        const swaps = (r?.txs ?? []).filter(t => t.kind === "TokenPoolSwap").slice(0, 10);
        setRecentSwaps(swaps);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [pool, lastTx]);

  // Debounced quote
  useEffect(() => {
    if (!pool || !amountIn) { setQuote(null); return; }
    const trimmed = amountIn.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) { setQuote(null); return; }
    let alive = true;
    setQuoteLoading(true);
    const t = setTimeout(async () => {
      try {
        const amtIn = direction === "zbx_to_token"
          ? zbxToWei(trimmed)
          : displayToBase(trimmed, pool.token_decimals);
        const q = await getTokenSwapQuote(pool.token_id, direction, amtIn);
        if (!alive) return;
        if (q) {
          setQuote({
            amountOut: BigInt(q.amount_out),
            feeIn: BigInt(q.fee_in),
          });
        } else { setQuote(null); }
      } catch { if (alive) setQuote(null); }
      finally { if (alive) setQuoteLoading(false); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [amountIn, direction, pool]);

  const minOut = useMemo(() => {
    if (!quote) return 0n;
    return applySlippage(quote.amountOut, slippageBps);
  }, [quote, slippageBps]);

  const onFlip = () => {
    setDirection(d => d === "zbx_to_token" ? "token_to_zbx" : "zbx_to_token");
    setAmountIn("");
    setQuote(null);
  };

  const onSubmit = async () => {
    if (!pool || !wallet || !quote) return;
    setSubmitting(true);
    try {
      const r = await sendTokenPoolSwap({
        privateKeyHex: wallet.privateKeyHex,
        tokenId: pool.token_id,
        direction,
        amountInDisplay: amountIn,
        tokenDecimals: pool.token_decimals,
        minOut,
      });
      const outDisplay = direction === "zbx_to_token"
        ? `${baseToDisplay(quote.amountOut.toString(), pool.token_decimals)} ${pool.token_symbol}`
        : `${fmtZbx(quote.amountOut, 6)} ZBX`;
      setLastTx({ hash: r.hash, out: outDisplay });
      recordTx({
        hash: r.hash || null,
        from: wallet.address,
        to: wallet.address,
        amountZbx: direction === "zbx_to_token" ? amountIn : "0",
        feeZbx: "0",
        ts: Date.now(),
        status: "submitted",
      });
      toast({ title: "Swap submitted", description: `Expected out: ${outDisplay}` });
      setAmountIn("");
      setQuote(null);
      setTimeout(refreshSelected, 2500);
    } catch (e) {
      toast({ title: "Swap failed", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──
  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowDownUp className="h-6 w-6" /> Token Trade
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Buy / sell any ZBX-20 token through its AMM pool. 0.30% pool fee — accrues to LPs.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshPools} disabled={poolLoading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${poolLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      {!wallet && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
          <AlertTriangle className="h-4 w-4 inline mr-2" />
          No wallet loaded. <Link href="/wallet" className="underline">Open the wallet page</Link> or{" "}
          <Link href="/import-wallet" className="underline">import a key</Link> to start trading.
        </Card>
      )}

      {pools.length === 0 && !poolLoading && (
        <Card className="p-6 text-center">
          <div className="text-muted-foreground">No token AMM pools yet.</div>
          <div className="text-xs text-muted-foreground mt-2">
            Anyone can create one — head to <Link href="/token-liquidity" className="text-primary underline">Token Liquidity</Link> and bootstrap a pool against ZBX.
          </div>
        </Card>
      )}

      {pools.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pool selector + stats */}
          <Card className="p-4 md:col-span-1 space-y-3">
            <div className="text-xs uppercase text-muted-foreground tracking-wider">Pool</div>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(parseInt(e.target.value, 10))}
              className="w-full bg-background border border-border rounded-md p-2 text-sm"
            >
              {pools.map(p => (
                <option key={p.token_id} value={p.token_id}>
                  {p.token_symbol || `#${p.token_id}`} / ZBX
                </option>
              ))}
            </select>
            {pool && (
              <div className="space-y-2 pt-2 border-t border-border text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Token</span>
                  <span className="font-mono">{pool.token_name || pool.token_symbol}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Spot price</span>
                  <span className="font-mono">{spotPriceZbxPerWholeToken(pool).toFixed(6)} ZBX</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">ZBX reserve</span>
                  <span className="font-mono">{fmtZbx(pool.zbx_reserve, 4)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Token reserve</span>
                  <span className="font-mono">{baseToDisplay(pool.token_reserve, pool.token_decimals, 4)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">LP supply</span>
                  <span className="font-mono">{pool.lp_supply}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Swaps</span>
                  <span className="font-mono">{pool.swap_count.toLocaleString()}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">Pool address</span>
                  <span
                    className="font-mono text-xs truncate cursor-pointer hover:text-emerald-400"
                    title={`${pool.address} — click to copy`}
                    onClick={() => { navigator.clipboard?.writeText(pool.address).catch(() => {}); }}
                  >
                    {pool.address}
                  </span></div>
              </div>
            )}
          </Card>

          {/* Trade form */}
          <Card className="p-5 md:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" /> Swap
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowSettings(s => !s)}>
                <SettingsIcon className="h-4 w-4 mr-1" /> Slippage {(slippageBps / 100).toFixed(2)}%
              </Button>
            </div>
            {showSettings && (
              <div className="bg-muted/30 rounded p-3 flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Slippage tolerance:</span>
                {[10, 50, 100, 500].map(b => (
                  <Button key={b} size="sm" variant={slippageBps === b ? "default" : "outline"}
                          onClick={() => setSlippageBps(b)}>{(b / 100).toFixed(2)}%</Button>
                ))}
                <Input type="number" step="0.01" min="0" max="50"
                       value={(slippageBps / 100).toFixed(2)}
                       onChange={(e) => setSlippageBps(Math.max(1, Math.floor(parseFloat(e.target.value || "0") * 100)))}
                       className="h-8 w-24" />
              </div>
            )}

            {/* From */}
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>From</span>
                {wallet && pool && (
                  <span>Balance: {direction === "zbx_to_token"
                    ? `${fmtZbx(wallet.zbxBalanceWei, 4)} ZBX`
                    : `${baseToDisplay(tokenBal.toString(), pool.token_decimals, 4)} ${pool.token_symbol}`}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input value={amountIn} onChange={(e) => setAmountIn(e.target.value)}
                       placeholder="0.0" className="text-lg font-mono border-0 bg-transparent focus-visible:ring-0 p-0" />
                <Badge variant="secondary">{direction === "zbx_to_token" ? "ZBX" : (pool?.token_symbol || "TOKEN")}</Badge>
              </div>
            </div>

            <div className="flex justify-center -my-2">
              <Button variant="outline" size="icon" className="rounded-full" onClick={onFlip}>
                <ArrowDownUp className="h-4 w-4" />
              </Button>
            </div>

            {/* To */}
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>To (estimated)</span>
                {quoteLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-lg font-mono flex-1">
                  {quote && pool
                    ? (direction === "zbx_to_token"
                        ? baseToDisplay(quote.amountOut.toString(), pool.token_decimals, 6)
                        : fmtZbx(quote.amountOut, 6))
                    : "0.0"}
                </div>
                <Badge variant="secondary">{direction === "zbx_to_token" ? (pool?.token_symbol || "TOKEN") : "ZBX"}</Badge>
              </div>
              {quote && pool && (
                <div className="text-xs text-muted-foreground mt-2 space-y-1">
                  <div>Min received (after slippage): <span className="font-mono">
                    {direction === "zbx_to_token"
                      ? `${baseToDisplay(minOut.toString(), pool.token_decimals, 6)} ${pool.token_symbol}`
                      : `${fmtZbx(minOut, 6)} ZBX`}
                  </span></div>
                  <div>Pool fee (0.30%): <span className="font-mono">
                    {direction === "zbx_to_token"
                      ? `${fmtZbx(quote.feeIn, 6)} ZBX`
                      : `${baseToDisplay(quote.feeIn.toString(), pool.token_decimals, 6)} ${pool.token_symbol}`}
                  </span></div>
                </div>
              )}
            </div>

            <Button className="w-full" disabled={!wallet || !quote || submitting} onClick={onSubmit}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
                          : !wallet ? "Connect wallet first"
                          : !quote ? "Enter an amount"
                          : "Swap"}
            </Button>

            {lastTx && (
              <div className="border border-emerald-500/40 bg-emerald-500/5 rounded p-3 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Sent — expected out {lastTx.out}</span>
                <a href={explorerUrl(lastTx.hash)} className="ml-auto text-primary underline flex items-center gap-1 text-xs">
                  Tx <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Recent swaps */}
      {recentSwaps.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4" /> <h3 className="font-semibold">Recent Pool Swaps</h3>
          </div>
          <div className="space-y-1 text-xs font-mono">
            {recentSwaps.map(t => (
              <div key={t.hash} className="flex items-center justify-between border-b border-border/40 py-1">
                <span className="text-muted-foreground">#{t.height}</span>
                <span className="truncate flex-1 mx-3">{t.from.slice(0, 10)}…{t.from.slice(-4)}</span>
                <a href={explorerUrl(t.hash)} className="text-primary truncate">{t.hash.slice(0, 14)}…</a>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
