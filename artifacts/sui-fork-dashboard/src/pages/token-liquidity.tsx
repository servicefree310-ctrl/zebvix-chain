import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Droplets,
  Plus,
  Minus,
  Sparkles,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { rpc } from "@/lib/zbx-rpc";
import {
  loadWallets, getActiveAddress, getWallet, recordTx, type StoredWallet,
} from "@/lib/web-wallet";
import {
  listTokens, listTokenPools, getTokenPool, getTokenLpBalance,
  sendTokenPoolCreate, sendTokenPoolAddLiquidity, sendTokenPoolRemoveLiquidity,
  baseToDisplay, displayToBase, applySlippage,
  spotPriceZbxPerWholeToken,
  type TokenPoolJson, type TokenInfo,
} from "@/lib/tokens";
import { Link } from "wouter";

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

interface LpWalletState {
  address: string;
  privateKeyHex: string;
  zbxBalanceWei: bigint;
}

async function loadLpWallet(): Promise<LpWalletState | null> {
  const ws = loadWallets();
  if (!ws.length) return null;
  const active = getActiveAddress();
  const w: StoredWallet | undefined = (active ? getWallet(active) : undefined) ?? ws[0];
  if (!w) return null;
  let bal = 0n;
  try {
    const res = await rpc<string>("zbx_getBalance", [w.address]);
    bal = BigInt(res || "0");
  } catch { /* keep 0 */ }
  return { address: w.address, privateKeyHex: w.privateKey, zbxBalanceWei: bal };
}

async function getTokBal(tokenId: number, addr: string): Promise<bigint> {
  try {
    const r = await rpc<{ balance: string }>("zbx_tokenBalanceOf", [tokenId, addr]);
    return BigInt(r?.balance || "0");
  } catch { return 0n; }
}

function explorerUrl(h: string): string { return `/block-explorer?tx=${h}`; }

// ────────────────────────────────────────────────────────────────────────────

export default function TokenLiquidityPage() {
  const { toast } = useToast();
  const [pools, setPools] = useState<TokenPoolJson[]>([]);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [wallet, setWallet] = useState<LpWalletState | null>(null);
  const [tab, setTab] = useState<"add" | "remove" | "create">("add");
  const [loading, setLoading] = useState(true);
  const [lastTx, setLastTx] = useState<{ hash: string; what: string } | null>(null);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [poolResp, tokResp, w] = await Promise.all([
        listTokenPools(0, 200),
        listTokens(0, 200),
        loadLpWallet(),
      ]);
      setPools(poolResp.pools);
      setTokens(tokResp.tokens);
      setWallet(w);
    } catch (e) {
      toast({ title: "Couldn't load liquidity data", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refreshAll(); }, []);  // eslint-disable-line

  // Tokens that don't yet have a pool — for the create-pool tab.
  const tokensWithoutPool = useMemo(() => {
    const have = new Set(pools.map(p => p.token_id));
    return tokens.filter(t => !have.has(t.id));
  }, [pools, tokens]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Droplets className="h-6 w-6" /> Token Liquidity
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open new TOKEN/ZBX pools, add or remove liquidity, and earn the 0.30% pool fee.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      {!wallet && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
          <AlertTriangle className="h-4 w-4 inline mr-2" />
          Load a wallet to provide liquidity.{" "}
          <Link href="/wallet" className="underline">Open wallet</Link> or{" "}
          <Link href="/import-wallet" className="underline">import a key</Link>.
        </Card>
      )}

      {lastTx && (
        <Card className="p-3 border-emerald-500/40 bg-emerald-500/5 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{lastTx.what} submitted.</span>
          <a href={explorerUrl(lastTx.hash)} className="ml-auto text-primary underline flex items-center gap-1 text-xs">
            Tx <ExternalLink className="h-3 w-3" />
          </a>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="add"><Plus className="h-3 w-3 mr-1" /> Add</TabsTrigger>
          <TabsTrigger value="remove"><Minus className="h-3 w-3 mr-1" /> Remove</TabsTrigger>
          <TabsTrigger value="create"><Sparkles className="h-3 w-3 mr-1" /> Create Pool</TabsTrigger>
        </TabsList>

        <TabsContent value="add">
          <AddLiquidityForm
            pools={pools} wallet={wallet}
            onDone={(hash) => { setLastTx({ hash, what: "Add liquidity" }); refreshAll(); }}
          />
        </TabsContent>
        <TabsContent value="remove">
          <RemoveLiquidityForm
            pools={pools} wallet={wallet}
            onDone={(hash) => { setLastTx({ hash, what: "Remove liquidity" }); refreshAll(); }}
          />
        </TabsContent>
        <TabsContent value="create">
          <CreatePoolForm
            tokens={tokensWithoutPool} wallet={wallet}
            onDone={(hash) => { setLastTx({ hash, what: "Create pool" }); refreshAll(); }}
          />
        </TabsContent>
      </Tabs>

      {/* Existing pools list */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2 text-sm">All Pools</h3>
        {pools.length === 0 ? (
          <div className="text-sm text-muted-foreground">No pools yet. Use the "Create Pool" tab to bootstrap one.</div>
        ) : (
          <div className="space-y-1 text-xs">
            <div className="grid grid-cols-5 gap-2 font-semibold text-muted-foreground border-b border-border pb-1">
              <span>Pair</span><span>ZBX reserve</span><span>Token reserve</span><span>Spot price</span><span>Swaps</span>
            </div>
            {pools.map(p => (
              <div key={p.token_id} className="grid grid-cols-5 gap-2 py-1 font-mono">
                <span>{p.token_symbol || `#${p.token_id}`} / ZBX</span>
                <span>{fmtZbx(p.zbx_reserve, 4)}</span>
                <span>{baseToDisplay(p.token_reserve, p.token_decimals, 4)}</span>
                <span>{spotPriceZbxPerWholeToken(p).toFixed(6)} ZBX</span>
                <span>{p.swap_count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Add liquidity ─────────────────────────────────────────────────────────

function AddLiquidityForm({ pools, wallet, onDone }: {
  pools: TokenPoolJson[]; wallet: LpWalletState | null;
  onDone: (hash: string) => void;
}) {
  const { toast } = useToast();
  const [pid, setPid] = useState<number | null>(pools[0]?.token_id ?? null);
  const [zbxIn, setZbxIn] = useState("");
  const [slippage, setSlippage] = useState(100); // 1%
  const [submitting, setSubmitting] = useState(false);
  const [tokBal, setTokBal] = useState<bigint>(0n);

  useEffect(() => { if (!pid && pools.length) setPid(pools[0].token_id); }, [pools, pid]);

  const pool = pools.find(p => p.token_id === pid) ?? null;

  useEffect(() => {
    if (!pool || !wallet) { setTokBal(0n); return; }
    getTokBal(pool.token_id, wallet.address).then(setTokBal);
  }, [pool, wallet]);

  // Compute matching token deposit at the current ratio.
  const previewTokenIn = useMemo(() => {
    if (!pool || !zbxIn || !/^\d+(\.\d+)?$/.test(zbxIn)) return 0n;
    try {
      const zwei = BigInt(Math.floor(parseFloat(zbxIn) * 1e6)) * (10n ** 12n);
      const zRes = BigInt(pool.zbx_reserve);
      const tRes = BigInt(pool.token_reserve);
      if (zRes === 0n) return 0n;
      return (zwei * tRes) / zRes;
    } catch { return 0n; }
  }, [pool, zbxIn]);

  const previewLpMint = useMemo(() => {
    if (!pool || previewTokenIn === 0n) return 0n;
    try {
      const zwei = BigInt(Math.floor(parseFloat(zbxIn) * 1e6)) * (10n ** 12n);
      const lpSupply = BigInt(pool.lp_supply);
      const zRes = BigInt(pool.zbx_reserve);
      if (zRes === 0n) return 0n;
      return (zwei * lpSupply) / zRes;
    } catch { return 0n; }
  }, [pool, zbxIn, previewTokenIn]);

  const onSubmit = async () => {
    if (!pool || !wallet) return;
    setSubmitting(true);
    try {
      // Pad max_token_amount by 1% to absorb rounding/slippage at apply time.
      const tokDisplay = baseToDisplay(((previewTokenIn * 101n) / 100n).toString(),
                                        pool.token_decimals, pool.token_decimals);
      const minLp = applySlippage(previewLpMint, slippage);
      const r = await sendTokenPoolAddLiquidity({
        privateKeyHex: wallet.privateKeyHex,
        tokenId: pool.token_id,
        zbxAmount: zbxIn,
        maxTokenAmountDisplay: tokDisplay,
        tokenDecimals: pool.token_decimals,
        minLpOut: minLp,
      });
      recordTx({
        hash: r.hash || null,
        from: wallet.address,
        to: wallet.address,
        amountZbx: zbxIn,
        feeZbx: "0",
        ts: Date.now(),
        status: "submitted",
      });
      toast({ title: "Liquidity added" });
      setZbxIn("");
      onDone(r.hash);
    } catch (e) {
      toast({ title: "Add failed", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (pools.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">No pools yet.</Card>;
  }

  return (
    <Card className="p-5 space-y-4 mt-3">
      <div>
        <label className="text-xs uppercase text-muted-foreground tracking-wider">Pool</label>
        <select value={pid ?? ""} onChange={(e) => setPid(parseInt(e.target.value, 10))}
                className="w-full bg-background border border-border rounded-md p-2 text-sm mt-1">
          {pools.map(p => <option key={p.token_id} value={p.token_id}>{p.token_symbol || `#${p.token_id}`} / ZBX</option>)}
        </select>
      </div>

      {pool && (
        <>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>ZBX deposit</span>
              {wallet && <span>Balance: {fmtZbx(wallet.zbxBalanceWei, 4)} ZBX</span>}
            </div>
            <Input value={zbxIn} onChange={(e) => setZbxIn(e.target.value)} placeholder="0.0" className="font-mono" />
          </div>

          <div className="bg-muted/30 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Required {pool.token_symbol}</span>
              <span className="font-mono">
                {baseToDisplay(previewTokenIn.toString(), pool.token_decimals, 6)}
                {" "}({baseToDisplay(tokBal.toString(), pool.token_decimals, 4)} available)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">LP shares minted (est)</span>
              <span className="font-mono">{previewLpMint.toString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Slippage tolerance</span>
              <span className="flex gap-1">
                {[10, 50, 100, 500].map(b => (
                  <Button key={b} size="sm" variant={slippage === b ? "default" : "outline"}
                          onClick={() => setSlippage(b)} className="h-6 text-xs">{(b / 100).toFixed(2)}%</Button>
                ))}
              </span>
            </div>
          </div>

          <Button className="w-full" disabled={!wallet || !zbxIn || submitting} onClick={onSubmit}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding…</> : "Add Liquidity"}
          </Button>
        </>
      )}
    </Card>
  );
}

// ─── Remove liquidity ──────────────────────────────────────────────────────

function RemoveLiquidityForm({ pools, wallet, onDone }: {
  pools: TokenPoolJson[]; wallet: LpWalletState | null;
  onDone: (hash: string) => void;
}) {
  const { toast } = useToast();
  const [pid, setPid] = useState<number | null>(pools[0]?.token_id ?? null);
  const [pct, setPct] = useState(50);
  const [slippage, setSlippage] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [lpBal, setLpBal] = useState<bigint>(0n);
  const [redeemZbx, setRedeemZbx] = useState<bigint>(0n);
  const [redeemTok, setRedeemTok] = useState<bigint>(0n);

  useEffect(() => { if (!pid && pools.length) setPid(pools[0].token_id); }, [pools, pid]);

  const pool = pools.find(p => p.token_id === pid) ?? null;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pool || !wallet) { setLpBal(0n); setRedeemZbx(0n); setRedeemTok(0n); return; }
      try {
        const r = await getTokenLpBalance(pool.token_id, wallet.address);
        if (!alive) return;
        setLpBal(BigInt(r.lp_balance));
        setRedeemZbx(BigInt(r.redeemable_zbx));
        setRedeemTok(BigInt(r.redeemable_token));
      } catch { /* keep zeros */ }
    })();
    return () => { alive = false; };
  }, [pool, wallet]);

  const burnAmount = useMemo(() => (lpBal * BigInt(pct)) / 100n, [lpBal, pct]);
  const expZbx = useMemo(() => (redeemZbx * BigInt(pct)) / 100n, [redeemZbx, pct]);
  const expTok = useMemo(() => (redeemTok * BigInt(pct)) / 100n, [redeemTok, pct]);

  const onSubmit = async () => {
    if (!pool || !wallet || burnAmount === 0n) return;
    setSubmitting(true);
    try {
      const r = await sendTokenPoolRemoveLiquidity({
        privateKeyHex: wallet.privateKeyHex,
        tokenId: pool.token_id,
        lpBurn: burnAmount,
        minZbxOutWei: applySlippage(expZbx, slippage),
        minTokenOutBase: applySlippage(expTok, slippage),
      });
      recordTx({
        hash: r.hash || null,
        from: wallet.address,
        to: wallet.address,
        amountZbx: "0",
        feeZbx: "0",
        ts: Date.now(),
        status: "submitted",
      });
      toast({ title: "Liquidity removed" });
      onDone(r.hash);
    } catch (e) {
      toast({ title: "Remove failed", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (pools.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">No pools yet.</Card>;
  }

  return (
    <Card className="p-5 space-y-4 mt-3">
      <div>
        <label className="text-xs uppercase text-muted-foreground tracking-wider">Pool</label>
        <select value={pid ?? ""} onChange={(e) => setPid(parseInt(e.target.value, 10))}
                className="w-full bg-background border border-border rounded-md p-2 text-sm mt-1">
          {pools.map(p => <option key={p.token_id} value={p.token_id}>{p.token_symbol || `#${p.token_id}`} / ZBX</option>)}
        </select>
      </div>

      {pool && (
        <>
          <div className="bg-muted/30 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your LP shares</span>
              <span className="font-mono">{lpBal.toString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total redeemable</span>
              <span className="font-mono">{fmtZbx(redeemZbx, 4)} ZBX + {baseToDisplay(redeemTok.toString(), pool.token_decimals, 4)} {pool.token_symbol}</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Burn</span><span>{pct}%</span>
            </div>
            <input type="range" min="1" max="100" value={pct}
                   onChange={(e) => setPct(parseInt(e.target.value, 10))} className="w-full" />
            <div className="flex gap-1 mt-2">
              {[25, 50, 75, 100].map(p => (
                <Button key={p} size="sm" variant={pct === p ? "default" : "outline"}
                        onClick={() => setPct(p)} className="h-6 text-xs">{p}%</Button>
              ))}
            </div>
          </div>

          <div className="bg-muted/30 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Burn amount</span><span className="font-mono">{burnAmount.toString()} LP</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">You will receive</span>
              <span className="font-mono">~{fmtZbx(expZbx, 6)} ZBX + ~{baseToDisplay(expTok.toString(), pool.token_decimals, 6)} {pool.token_symbol}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Slippage</span>
              <span className="flex gap-1">
                {[10, 50, 100, 500].map(b => (
                  <Button key={b} size="sm" variant={slippage === b ? "default" : "outline"}
                          onClick={() => setSlippage(b)} className="h-6 text-xs">{(b / 100).toFixed(2)}%</Button>
                ))}
              </span>
            </div>
          </div>

          <Button className="w-full" variant="destructive"
                  disabled={!wallet || burnAmount === 0n || submitting} onClick={onSubmit}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Removing…</> : "Remove Liquidity"}
          </Button>
        </>
      )}
    </Card>
  );
}

// ─── Create pool ───────────────────────────────────────────────────────────

function CreatePoolForm({ tokens, wallet, onDone }: {
  tokens: TokenInfo[]; wallet: LpWalletState | null;
  onDone: (hash: string) => void;
}) {
  const { toast } = useToast();
  const [tid, setTid] = useState<number | null>(tokens[0]?.id ?? null);
  const [zbxAmt, setZbxAmt] = useState("");
  const [tokAmt, setTokAmt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!tid && tokens.length) setTid(tokens[0].id); }, [tokens, tid]);
  const token = tokens.find(t => t.id === tid) ?? null;

  const onSubmit = async () => {
    if (!token || !wallet) return;
    setSubmitting(true);
    try {
      const r = await sendTokenPoolCreate({
        privateKeyHex: wallet.privateKeyHex,
        tokenId: token.id,
        zbxAmount: zbxAmt,
        tokenAmountDisplay: tokAmt,
        tokenDecimals: token.decimals,
      });
      recordTx({
        hash: r.hash || null,
        from: wallet.address,
        to: wallet.address,
        amountZbx: zbxAmt,
        feeZbx: "0",
        ts: Date.now(),
        status: "submitted",
      });
      toast({
        title: "Pool created",
        description: `${token.symbol}/ZBX is now live`,
      });
      setZbxAmt(""); setTokAmt("");
      onDone(r.hash);
    } catch (e) {
      toast({ title: "Create failed", description: String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (tokens.length === 0) {
    return (
      <Card className="p-6 text-center mt-3">
        <div className="text-sm text-muted-foreground">All existing tokens already have a pool.</div>
        <div className="text-xs text-muted-foreground mt-2">
          Want a brand-new asset? <Link href="/token-create" className="text-primary underline">Mint a ZBX-20 token</Link> first, then come back.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4 mt-3">
      <div>
        <label className="text-xs uppercase text-muted-foreground tracking-wider">Token (no pool yet)</label>
        <select value={tid ?? ""} onChange={(e) => setTid(parseInt(e.target.value, 10))}
                className="w-full bg-background border border-border rounded-md p-2 text-sm mt-1">
          {tokens.map(t => <option key={t.id} value={t.id}>{t.symbol} — {t.name}</option>)}
        </select>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Initial ZBX deposit</span>
          {wallet && <span>Balance: {fmtZbx(wallet.zbxBalanceWei, 4)}</span>}
        </div>
        <Input value={zbxAmt} onChange={(e) => setZbxAmt(e.target.value)} placeholder="0.0" className="font-mono" />
      </div>

      {token && (
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Initial {token.symbol} deposit</span>
            <span>Decimals {token.decimals}</span>
          </div>
          <Input value={tokAmt} onChange={(e) => setTokAmt(e.target.value)} placeholder="0.0" className="font-mono" />
        </div>
      )}

      <div className="text-xs text-muted-foreground bg-muted/30 rounded p-3 space-y-1">
        <div>Bhai, the ratio you choose becomes the opening price. ZBX-side and token-side at any ratio is fine.</div>
        <div>1,000 LP shares get permanently locked (Uniswap V2-style anti-rug). You receive the rest.</div>
        <div>Pool fee: 0.30% — flows to all LPs proportionally.</div>
      </div>

      <Button className="w-full" disabled={!wallet || !zbxAmt || !tokAmt || submitting} onClick={onSubmit}>
        {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…</> : "Create Pool"}
      </Button>
    </Card>
  );
}
