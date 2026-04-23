import React, { useEffect, useState } from "react";
import { rpc, weiHexToZbx, weiToUsd, fmtUsd, shortAddr } from "@/lib/zbx-rpc";
import { Search, Wallet, Lock, TrendingUp, AlertCircle, ArrowLeftRight, Inbox } from "lucide-react";

interface DelegationsRes {
  total_value_wei?: string;
  delegations?: Array<{ validator: string; value_wei: string; shares: string }>;
}

interface LockedRes {
  locked_wei?: string;
  released_wei?: string;
  unlock_per_block_wei?: string;
  unlock_at_height?: number;
}

function readQueryAddr(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const a = p.get("addr");
  return a && a.trim() ? a.trim() : null;
}

interface OnchainTx {
  height: number; ts: number; from: string; to: string;
  amount_wei: string; fee_wei: string; kind: string;
}

export default function BalanceLookup() {
  const initialAddr = readQueryAddr() ?? "0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc";
  const [addr, setAddr] = useState(initialAddr);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<{
    liquid: string;
    delegations: DelegationsRes | null;
    locked: LockedRes | null;
    nonce: string;
    payId: string | null;
    zusd: string;
    priceUsd: number;
  } | null>(null);

  // Tx scan state
  const [scanning, setScanning] = useState(false);
  const [scannedRange, setScannedRange] = useState(0);
  const [txs, setTxs] = useState<OnchainTx[]>([]);
  const [scanErr, setScanErr] = useState<string | null>(null);

  async function lookup() {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const [bal, delegations, locked, nonce, payId, zusd, price] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<DelegationsRes>("zbx_getDelegationsByDelegator", [addr]).catch(() => null),
        rpc<LockedRes>("zbx_getLockedRewards", [addr]).catch(() => null),
        rpc<string>("zbx_getNonce", [addr]).catch(() => "0x0"),
        rpc<{ pay_id?: string; name?: string }>("zbx_getPayIdOf", [addr])
          .then((r) => r?.pay_id ?? null)
          .catch(() => null),
        rpc<string>("zbx_getZusdBalance", [addr]).catch(() => "0x0"),
        rpc<{ zbx_usd: string }>("zbx_getPriceUSD")
          .then((r) => parseFloat(r?.zbx_usd ?? "0"))
          .catch(() => 0),
      ]);
      setData({ liquid: bal, delegations, locked, nonce, payId, zusd, priceUsd: price });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-lookup on first mount with default address
  useEffect(() => {
    lookup();
    scanTxs(500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scanTxs(window: number) {
    if (scanning || !addr) return;
    setScanning(true);
    setScanErr(null);
    setTxs([]);
    try {
      const tip = await rpc<{ height: number }>("zbx_blockNumber");
      const tipH = tip.height;
      const lower = (addr || "").toLowerCase();
      const heights: number[] = [];
      for (let i = 0; i < window; i++) {
        const h = tipH - i;
        if (h >= 0) heights.push(h);
      }
      const CONC = 16;
      const found: OnchainTx[] = [];
      for (let i = 0; i < heights.length; i += CONC) {
        const slice = heights.slice(i, i + CONC);
        const results = await Promise.all(
          slice.map(async (h) => {
            try {
              const r = await rpc<any>("zbx_getBlockByNumber", [h]);
              if (!r) return null;
              const hdr = r.header ?? r;
              const tx = Array.isArray(r.txs) ? r.txs : [];
              return { h, ts: hdr.timestamp_ms ?? 0, txs: tx };
            } catch { return null; }
          }),
        );
        for (const x of results) {
          if (!x || !x.txs.length) continue;
          for (const t of x.txs) {
            const body = t.body ?? t;
            const from = String(body.from ?? "").toLowerCase();
            const to = String(body.to ?? "").toLowerCase();
            // Also match multisig kind references
            const kindStr = JSON.stringify(body.kind ?? "").toLowerCase();
            if (from === lower || to === lower || kindStr.includes(lower)) {
              found.push({
                height: x.h,
                ts: x.ts,
                from: body.from ?? "",
                to: body.to ?? "",
                amount_wei: typeof body.amount === "number" ? body.amount.toString() : String(body.amount ?? "0"),
                fee_wei: typeof body.fee === "number" ? body.fee.toString() : String(body.fee ?? "0"),
                kind: kindLabel(body.kind),
              });
            }
          }
        }
        if (found.length >= 50) break;
      }
      found.sort((a, b) => b.height - a.height);
      setTxs(found.slice(0, 50));
      setScannedRange(window);
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  function totalWei(): bigint {
    if (!data) return 0n;
    try {
      const liquid = BigInt(data.liquid);
      const staked = data.delegations?.total_value_wei
        ? BigInt(data.delegations.total_value_wei)
        : 0n;
      const locked = data.locked?.locked_wei ? BigInt(data.locked.locked_wei) : 0n;
      return liquid + staked + locked;
    } catch {
      return 0n;
    }
  }
  function totalZbx(): string {
    return weiHexToZbx(totalWei());
  }
  function totalUsd(): number {
    if (!data) return 0;
    return weiToUsd(totalWei(), data.priceUsd);
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
          <Wallet className="h-7 w-7 text-primary" />
          Balance Lookup
        </h1>
        <p className="text-sm text-muted-foreground">
          Aggregate live balances: liquid + staked + locked rewards + daily drip + Pay-ID.
        </p>
      </div>

      {(() => {
        const trimmed = addr.trim();
        const validFmt = /^0x[0-9a-fA-F]{40}$/.test(trimmed);
        const partial = trimmed.length > 0 && !validFmt;
        let reason = "";
        if (partial) {
          if (!/^0x/i.test(trimmed)) reason = "address must start with 0x";
          else if (!/^0x[0-9a-fA-F]*$/.test(trimmed)) reason = "address must be hex (0-9, a-f) only";
          else reason = `address must be exactly 40 hex chars after 0x — got ${trimmed.slice(2).length}`;
        }
        return (
          <div className="space-y-1">
            <div className="flex gap-2">
              <input
                value={addr}
                onChange={(e) => setAddr(e.target.value.trim())}
                placeholder="0x... 40 hex chars (Zebvix address)"
                className={`flex-1 px-3 py-2 rounded-md bg-background border font-mono text-sm focus:outline-none focus:ring-2 ${partial ? "border-red-500/50 focus:ring-red-500" : "border-border focus:ring-primary"}`}
                onKeyDown={(e) => { if (e.key === "Enter" && validFmt) { lookup(); scanTxs(500); } }}
              />
              <button
                onClick={() => { lookup(); scanTxs(500); }}
                disabled={loading || !validFmt}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm disabled:opacity-40 hover:bg-primary/90 flex items-center gap-2"
                title={!validFmt && trimmed ? reason : ""}
              >
                <Search className="h-4 w-4" />
                {loading ? "…" : "Lookup"}
              </button>
            </div>
            {partial && (
              <div className="text-xs text-red-400 flex items-center gap-1.5 pl-1">
                <AlertCircle className="h-3 w-3" /> {reason}
              </div>
            )}
            {validFmt && !loading && (
              <div className="text-xs text-emerald-400/70 flex items-center gap-1.5 pl-1">
                ✓ valid address format
              </div>
            )}
          </div>
        );
      })()}

      {err && (
        <div className="p-3 rounded-md border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <code className="text-xs">{err}</code>
        </div>
      )}

      {data && (
        <>
          <div className="p-5 rounded-lg border-2 border-primary/30 bg-primary/5">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
              <div className="text-xs text-muted-foreground">GRAND TOTAL</div>
              <div className="text-xs text-muted-foreground">
                ZBX price: <span className="font-mono text-primary">${data.priceUsd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}</span>
              </div>
            </div>
            <div className="text-4xl font-bold text-primary tabular-nums">
              {totalZbx()} <span className="text-lg text-muted-foreground">ZBX</span>
            </div>
            <div className="text-2xl font-semibold text-green-400 tabular-nums mt-1">
              ≈ {fmtUsd(totalUsd())}
            </div>
            {data.payId && (
              <div className="mt-3 text-sm">
                Pay-ID: <code className="text-primary font-semibold">{data.payId}</code>
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              Nonce: <code>{parseInt(data.nonce, 16) || 0}</code>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            <BalCard icon={Wallet} label="Liquid ZBX" wei={data.liquid} color="text-blue-400" priceUsd={data.priceUsd} />
            <BalCard
              icon={TrendingUp}
              label="Staked"
              wei={data.delegations?.total_value_wei ?? "0"}
              color="text-green-400"
              priceUsd={data.priceUsd}
            />
            <BalCard
              icon={Lock}
              label="Locked Rewards"
              wei={data.locked?.locked_wei ?? "0"}
              color="text-yellow-400"
              priceUsd={data.priceUsd}
            />
            <BalCard icon={Wallet} label="zUSD" wei={data.zusd} color="text-purple-400" priceUsd={1} unit="zUSD" />
          </div>

          {/* RECENT TRANSACTIONS involving this address */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
                Recent Transactions involving this address
                {scannedRange > 0 && (
                  <span className="text-[10px] font-normal text-muted-foreground">
                    (scanned last {scannedRange.toLocaleString()} blocks)
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={() => scanTxs(500)} disabled={scanning}
                  className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-muted/70 disabled:opacity-40">
                  {scanning ? "scanning…" : "scan 500"}
                </button>
                <button onClick={() => scanTxs(2000)} disabled={scanning}
                  className="text-[11px] px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40">
                  {scanning ? "…" : "scan 2000"}
                </button>
              </div>
            </div>
            {scanErr && <div className="p-3 text-xs text-red-400">{scanErr}</div>}
            {txs.length === 0 ? (
              <div className="p-8 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                <div className="text-xs text-muted-foreground">
                  {scanning ? "scanning blocks…" :
                    scannedRange > 0
                      ? `no transactions found involving this address in last ${scannedRange.toLocaleString()} blocks. Try scanning a wider range.`
                      : "ready to scan…"}
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-medium w-20">Block</th>
                    <th className="text-left p-2 font-medium w-20">Kind</th>
                    <th className="text-left p-2 font-medium">From</th>
                    <th className="text-left p-2 font-medium">To</th>
                    <th className="text-right p-2 font-medium">Amount</th>
                    <th className="text-right p-2 font-medium">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t, i) => {
                    const lower = addr.toLowerCase();
                    const isFrom = t.from.toLowerCase() === lower;
                    const isTo = t.to.toLowerCase() === lower;
                    return (
                      <tr key={`${t.height}-${i}`} className="border-t border-border hover:bg-muted/20">
                        <td className="p-2 font-mono text-primary">#{t.height}</td>
                        <td className="p-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-400">{t.kind}</span></td>
                        <td className={`p-2 font-mono ${isFrom ? "text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                          {isFrom && "↑ "}{shortAddr(t.from, 6, 4)}
                        </td>
                        <td className={`p-2 font-mono ${isTo ? "text-emerald-400 font-semibold" : "text-muted-foreground"}`}>
                          {isTo && "↓ "}{shortAddr(t.to, 6, 4)}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {t.amount_wei !== "0" ? `${weiHexToZbx(t.amount_wei)} ZBX` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="p-2 text-right font-mono text-amber-400">{weiHexToZbx(t.fee_wei)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {data.delegations?.delegations && data.delegations.delegations.length > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold">
                Delegations ({data.delegations.delegations.length})
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-medium">Validator</th>
                    <th className="text-right p-2 font-medium">Value (ZBX)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.delegations.delegations.map((d) => (
                    <tr key={d.validator} className="border-t border-border">
                      <td className="p-2 font-mono">{d.validator}</td>
                      <td className="p-2 text-right font-mono text-green-400">{weiHexToZbx(d.value_wei)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.locked && (data.locked.released_wei || data.locked.unlock_per_block_wei) && (
            <div className="p-4 rounded-lg border border-border bg-card">
              <h3 className="text-sm font-semibold mb-3">Reward Drip Info</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {data.locked.unlock_per_block_wei && (
                  <div>
                    <div className="text-xs text-muted-foreground">Per-block unlock</div>
                    <div className="font-mono text-primary">{weiHexToZbx(data.locked.unlock_per_block_wei)} ZBX</div>
                  </div>
                )}
                {data.locked.released_wei && (
                  <div>
                    <div className="text-xs text-muted-foreground">Released so far</div>
                    <div className="font-mono">{weiHexToZbx(data.locked.released_wei)} ZBX</div>
                  </div>
                )}
                {data.locked.unlock_at_height !== undefined && (
                  <div>
                    <div className="text-xs text-muted-foreground">Fully unlocked at</div>
                    <div className="font-mono">#{data.locked.unlock_at_height}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BalCard({ icon: Icon, label, wei, color, priceUsd, unit = "ZBX" }: { icon: React.ElementType; label: string; wei: string; color: string; priceUsd: number; unit?: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{weiHexToZbx(wei)}</div>
      <div className="text-xs text-muted-foreground mt-0.5 flex justify-between">
        <span>{unit}</span>
        <span className="font-mono">≈ {fmtUsd(weiToUsd(wei, priceUsd))}</span>
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

