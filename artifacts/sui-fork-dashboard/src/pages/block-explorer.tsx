import React, { useEffect, useMemo, useState } from "react";
import { Link as WLink, useLocation } from "wouter";
import {
  Search,
  Box,
  ArrowLeft,
  Wallet,
  Hash,
  Clock,
  Activity,
  Copy,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  rpc,
  weiHexToZbx,
  shortAddr,
  hexToInt,
  detectQueryKind,
  getTip,
  getEthBlock,
  getEthTx,
  getEthReceipt,
  getZbxTypedTx,
  getRecentBlocks,
  type EthBlock,
  type EthTxLite,
  type EthReceipt,
  type ZbxTipInfo,
  type ZbxTypedTx,
} from "@/lib/zbx-rpc";

function fmtAge(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function ageFromHexTs(hex: string): string {
  if (!hex) return "—";
  const s = hexToInt(hex);
  return fmtAge(Math.max(0, Math.floor(Date.now() / 1000) - s));
}

function txCount(b: EthBlock): number {
  return Array.isArray(b.transactions) ? b.transactions.length : 0;
}

function getQueryParam(): string {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href);
  return u.searchParams.get("q")?.trim() ?? "";
}

function setQueryParam(q: string) {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  if (q) u.searchParams.set("q", q);
  else u.searchParams.delete("q");
  window.history.replaceState({}, "", u.toString());
}

export default function BlockExplorer() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState<string>(getQueryParam());

  // Live URL sync — when wouter changes location we re-read the q param.
  useEffect(() => {
    const sync = () => setQ(getQueryParam());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">Block Explorer</h1>
        <p className="text-lg text-muted-foreground">
          Etherscan-style explorer for Zebvix mainnet. Paste any block height, block hash,
          transaction hash, or address and it routes to the right view.
        </p>
      </div>

      <SearchBar
        initial={q}
        onSearch={(v) => {
          setQueryParam(v);
          setQ(v);
          if (!v) navigate("/block-explorer", { replace: true });
        }}
      />

      {!q && <Overview onSelect={(v) => { setQueryParam(v); setQ(v); }} />}
      {q && <DetailRouter q={q} />}
    </div>
  );
}

// ───── Search bar ────────────────────────────────────────────────────────────
function SearchBar({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const [val, setVal] = useState(initial);
  useEffect(() => setVal(initial), [initial]);
  return (
    <Card className="p-3">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by block height, block hash, tx hash, or address (0x…)"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearch(val.trim()); }}
            className="pl-9 font-mono text-sm"
            data-testid="input-explorer-search"
          />
        </div>
        <Button onClick={() => onSearch(val.trim())} data-testid="button-explorer-search">
          Search
        </Button>
        {val && (
          <Button variant="outline" onClick={() => { setVal(""); onSearch(""); }}>
            Clear
          </Button>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground mt-2 px-1 flex flex-wrap gap-x-4 gap-y-1">
        <span><strong className="text-foreground">Block height:</strong> e.g. 14907</span>
        <span><strong className="text-foreground">Tx / block hash:</strong> 0x + 64 hex</span>
        <span><strong className="text-foreground">Address:</strong> 0x + 40 hex</span>
      </div>
    </Card>
  );
}

// ───── Overview (recent blocks live feed) ────────────────────────────────────
function Overview({ onSelect }: { onSelect: (v: string) => void }) {
  const [tip, setTip] = useState<ZbxTipInfo | null>(null);
  const [blocks, setBlocks] = useState<EthBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const t = await getTip();
      if (!t) { setErr("Could not reach RPC tip."); setLoading(false); return; }
      setTip(t);
      const bs = await getRecentBlocks(t.height, 10);
      setBlocks(bs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  const recentTxs = useMemo(() => {
    const out: { block: number; ts: number; tx: EthTxLite }[] = [];
    for (const b of blocks) {
      const h = hexToInt(b.number);
      const ts = hexToInt(b.timestamp);
      const txs = Array.isArray(b.transactions) ? b.transactions : [];
      for (const t of txs) {
        if (typeof t === "string") continue;
        out.push({ block: h, ts, tx: t });
      }
    }
    return out.slice(0, 12);
  }, [blocks]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Tip height" value={tip ? `#${tip.height.toLocaleString()}` : "…"} icon={Box} />
        <StatCard label="Latest hash" value={tip ? shortAddr(tip.hash, 8, 6) : "…"} icon={Hash} mono />
        <StatCard label="Proposer" value={tip ? shortAddr(tip.proposer, 6, 4) : "…"} icon={Activity} mono />
        <StatCard label="Last block age" value={tip ? fmtAge(Math.max(0, Math.floor((Date.now() - tip.timestamp_ms) / 1000))) : "…"} icon={Clock} />
      </div>

      {err && (
        <Card className="p-3 text-xs text-red-300 border-red-500/30 bg-red-500/5">{err}</Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Box className="h-4 w-4 text-primary" /> Latest blocks
            </h2>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {blocks.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground">No blocks yet.</div>
          )}
          <div className="space-y-1.5">
            {blocks.map((b) => {
              const h = hexToInt(b.number);
              return (
                <button
                  key={b.hash}
                  onClick={() => onSelect(String(h))}
                  className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-primary/10 transition text-left"
                  data-testid={`row-block-${h}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="font-mono">#{h}</Badge>
                    <code className="font-mono text-[10px] text-muted-foreground truncate">{shortAddr(b.hash, 8, 6)}</code>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                    <span>{txCount(b)} tx</span>
                    <span>{ageFromHexTs(b.timestamp)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Latest txs
            </h2>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {recentTxs.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground">No recent transactions in the last 10 blocks.</div>
          )}
          <div className="space-y-1.5">
            {recentTxs.map(({ block, ts, tx }) => (
              <button
                key={tx.hash}
                onClick={() => onSelect(tx.hash)}
                className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-primary/10 transition text-left"
                data-testid={`row-tx-${tx.hash.slice(0, 10)}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-[10px] text-muted-foreground truncate">{shortAddr(tx.hash, 8, 6)}</code>
                  <span className="text-muted-foreground">→</span>
                  <code className="font-mono text-[10px]">{tx.to ? shortAddr(tx.to, 6, 4) : "create"}</code>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                  <span className="text-foreground font-mono">{weiHexToZbx(tx.value)} ZBX</span>
                  <span>#{block}</span>
                  <span>{fmtAge(Math.max(0, Math.floor(Date.now() / 1000 - ts)))}</span>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, mono }: {
  label: string; value: string; icon: React.ElementType; mono?: boolean;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`text-lg font-bold text-foreground ${mono ? "font-mono" : ""}`}>{value}</div>
    </Card>
  );
}

// ───── Detail router ─────────────────────────────────────────────────────────
function DetailRouter({ q }: { q: string }) {
  const kind = detectQueryKind(q);
  if (kind === "block-num") return <BlockDetail blockNum={parseInt(q, 10)} />;
  if (kind === "tx-hash") return <TxOrBlockHash hash={q} />;
  if (kind === "address") return <AddressDetail addr={q} />;
  return (
    <Card className="p-6 text-sm text-muted-foreground">
      Could not detect <code className="font-mono">{q}</code> as a block height, block/tx
      hash, or address. Try again with a valid input.
    </Card>
  );
}

// 32-byte hash could be either a tx or a block. Try tx first.
function TxOrBlockHash({ hash }: { hash: string }) {
  const [resolved, setResolved] = useState<"tx" | "block" | "none" | "loading">("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await getEthTx(hash);
      if (cancelled) return;
      if (t) { setResolved("tx"); return; }
      // try as block hash
      try {
        const b = await rpc<EthBlock | null>("eth_getBlockByHash", [hash, true]);
        if (cancelled) return;
        setResolved(b ? "block" : "none");
      } catch {
        if (!cancelled) setResolved("none");
      }
    })();
    return () => { cancelled = true; };
  }, [hash]);

  if (resolved === "loading") return <Card className="p-6 text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Resolving…</Card>;
  if (resolved === "tx") return <TxDetail hash={hash} />;
  if (resolved === "block") return <BlockDetail blockHash={hash} />;
  return (
    <Card className="p-6 text-sm text-muted-foreground">
      No transaction or block found for <code className="font-mono">{hash}</code>.
    </Card>
  );
}

// ───── Block detail ──────────────────────────────────────────────────────────
function BlockDetail({ blockNum, blockHash }: { blockNum?: number; blockHash?: string }) {
  const { toast } = useToast();
  const [block, setBlock] = useState<EthBlock | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(null);
      try {
        let b: EthBlock | null = null;
        if (typeof blockNum === "number") {
          b = await getEthBlock(blockNum, true);
        } else if (blockHash) {
          b = await rpc<EthBlock | null>("eth_getBlockByHash", [blockHash, true]).catch(() => null);
        }
        if (!cancelled) setBlock(b);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [blockNum, blockHash]);

  if (block === undefined) return <Card className="p-6 text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading block…</Card>;
  if (err) return <Card className="p-6 text-sm text-red-300 border-red-500/30 bg-red-500/5">{err}</Card>;
  if (!block) return <Card className="p-6 text-sm text-muted-foreground">Block not found.</Card>;

  const h = hexToInt(block.number);
  const txs = Array.isArray(block.transactions) ? block.transactions : [];
  return (
    <div className="space-y-4">
      <BackLink />
      <Card className="p-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Block</div>
            <div className="text-2xl font-bold">#{h.toLocaleString()}</div>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">{txCount(block)} tx</Badge>
        </div>
        <DetailRow label="Hash" value={block.hash} mono onCopy={(v) => { navigator.clipboard.writeText(v); toast({ title: "Copied" }); }} />
        <DetailRow label="Parent hash" value={block.parentHash} mono />
        <DetailRow label="Proposer" value={block.miner} mono linkAddr />
        <DetailRow label="Timestamp" value={`${new Date(hexToInt(block.timestamp) * 1000).toUTCString()} (${ageFromHexTs(block.timestamp)})`} />
        <DetailRow label="Gas used / limit" value={`${hexToInt(block.gasUsed).toLocaleString()} / ${hexToInt(block.gasLimit).toLocaleString()}`} />
        {block.baseFeePerGas && <DetailRow label="Base fee" value={`${hexToInt(block.baseFeePerGas).toLocaleString()} wei`} />}
        {block.size && <DetailRow label="Block size" value={`${hexToInt(block.size).toLocaleString()} bytes`} />}
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="text-sm font-semibold">Transactions in this block</h2>
        {txs.length === 0 ? (
          <div className="text-xs text-muted-foreground">No transactions.</div>
        ) : (
          <div className="space-y-1.5">
            {txs.map((t) => {
              if (typeof t === "string") {
                return (
                  <WLink key={t} href={`/block-explorer?q=${t}`}>
                    <a className="block text-xs font-mono hover:text-primary truncate">{t}</a>
                  </WLink>
                );
              }
              return (
                <WLink key={t.hash} href={`/block-explorer?q=${t.hash}`}>
                  <a className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-primary/10 transition">
                    <code className="font-mono text-[10px] truncate">{shortAddr(t.hash, 8, 6)}</code>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <span>{shortAddr(t.from, 4, 4)} → {t.to ? shortAddr(t.to, 4, 4) : "create"}</span>
                      <span className="text-foreground font-mono">{weiHexToZbx(t.value)} ZBX</span>
                    </div>
                  </a>
                </WLink>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ───── Tx detail ─────────────────────────────────────────────────────────────
//
// Phase H.1 — In addition to the eth-style fields (`getEthTx` /
// `getEthReceipt`), we now also pull the typed Zebvix payload via
// `getZbxTypedTx`. This is what lets the explorer surface SEMANTIC amounts
// for non-Transfer kinds (e.g. `TokenPoolCreate` seed amounts of
// 10 ZBX + 10 000 HDT) instead of misleading users with `Value: 0 ZBX`
// which is what the legacy eth-style mapping produces for any kind whose
// real amounts live inside the `TxKind` enum rather than `body.amount`.
//
// `typedTx` is `undefined` while loading, `null` when the hash is outside
// the recent-tx ring window (~1000 most recent committed txs) or the node
// doesn't support `zbx_getTxByHash`. Either way the eth-style block above
// still renders, so we degrade gracefully.

/** Format a u128 wei string with the given decimals into a human-readable
 *  decimal string. Trims trailing zeros; falls back to the raw string on
 *  parse failure so we never silently hide data. */
function fmtUnits(wei: string, decimals: number): string {
  if (!/^\d+$/.test(wei)) return wei;
  if (decimals <= 0) return wei;
  const padded = wei.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  let fracPart = padded.slice(padded.length - decimals);
  fracPart = fracPart.replace(/0+$/, "");
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}

/** Convert `variant_name()` style lowercase snake_case (e.g. "token_pool_create")
 *  into Title-Cased label for badges + section headers (e.g. "Token Pool Create").
 *  Display-only — never use for comparisons against the wire kind string. */
function prettyKind(snake: string): string {
  return snake.split("_").map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/** Per-kind renderer for the typed payload returned by `zbx_getTxByHash`.
 *  Falls back to a JSON dump for any unrecognized variant so we never hide
 *  data on this critical "what actually happened?" surface. */
function TypedPayloadView({ typedTx }: { typedTx: ZbxTypedTx }) {
  const p = typedTx.payload as Record<string, unknown>;
  const ptype = String(p.type ?? "");

  // Token-related kinds carry resolved symbol/decimals from the server so
  // we can format human-readable amounts without a second roundtrip.
  const tokSym = (p.token_symbol as string | null | undefined) ?? null;
  const tokDec = typeof p.token_decimals === "number" ? (p.token_decimals as number) : null;
  const fmtTok = (raw: unknown): string => {
    const s = String(raw ?? "0");
    if (tokDec === null) return s;
    return `${fmtUnits(s, tokDec)} ${tokSym ?? `tok#${p.token_id}`}`;
  };
  const fmtZbx = (raw: unknown): string => {
    const s = String(raw ?? "0");
    return `${fmtUnits(s, 18)} ZBX`;
  };

  switch (ptype) {
    case "transfer":
      return null; // Same as eth-style "Value" above; nothing extra to add.

    case "token_transfer":
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          <DetailRow label="Recipient" value={String(p.to)} mono linkAddr highlight />
          <DetailRow label="Amount" value={fmtTok(p.amount)} highlight />
        </>
      );
    case "token_mint":
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          <DetailRow label="Mint to" value={String(p.to)} mono linkAddr />
          <DetailRow label="Amount minted" value={fmtTok(p.amount)} highlight />
        </>
      );
    case "token_burn":
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          <DetailRow label="Amount burned" value={fmtTok(p.amount)} highlight />
        </>
      );
    case "token_create":
      return (
        <>
          <DetailRow label="Name" value={String(p.name)} />
          <DetailRow label="Symbol" value={String(p.symbol)} highlight />
          <DetailRow label="Decimals" value={String(p.decimals)} />
          <DetailRow
            label="Initial supply"
            value={fmtUnits(String(p.initial_supply), Number(p.decimals) || 0) + " " + String(p.symbol)}
            highlight
          />
        </>
      );
    case "token_pool_create":
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          {p.pool_address && (
            <DetailRow label="Pool address" value={String(p.pool_address)} mono linkAddr />
          )}
          <DetailRow label="ZBX seeded" value={fmtZbx(p.zbx_amount)} highlight />
          <DetailRow label={`${tokSym ?? "Token"} seeded`} value={fmtTok(p.token_amount)} highlight />
        </>
      );
    case "token_pool_add_liquidity":
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          {p.pool_address && (
            <DetailRow label="Pool address" value={String(p.pool_address)} mono linkAddr />
          )}
          <DetailRow label="ZBX added" value={fmtZbx(p.zbx_amount)} highlight />
          <DetailRow label={`Max ${tokSym ?? "token"} added`} value={fmtTok(p.max_token_amount)} />
          <DetailRow label="Min LP out" value={String(p.min_lp_out)} />
        </>
      );
    case "token_pool_remove_liquidity":
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          {p.pool_address && (
            <DetailRow label="Pool address" value={String(p.pool_address)} mono linkAddr />
          )}
          <DetailRow label="LP burned" value={String(p.lp_burn)} highlight />
          <DetailRow label="Min ZBX out" value={fmtZbx(p.min_zbx_out)} />
          <DetailRow label={`Min ${tokSym ?? "token"} out`} value={fmtTok(p.min_token_out)} />
        </>
      );
    case "token_pool_swap": {
      const dir = String(p.direction);
      const isZbxIn = dir === "zbx_to_token";
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          {p.pool_address && (
            <DetailRow label="Pool address" value={String(p.pool_address)} mono linkAddr />
          )}
          <DetailRow label="Direction" value={isZbxIn ? `ZBX → ${tokSym ?? "token"}` : `${tokSym ?? "token"} → ZBX`} highlight />
          <DetailRow label="Amount in" value={isZbxIn ? fmtZbx(p.amount_in) : fmtTok(p.amount_in)} highlight />
          <DetailRow label="Min out" value={isZbxIn ? fmtTok(p.min_out) : fmtZbx(p.min_out)} />
        </>
      );
    }
    case "swap": {
      // Native ZBX↔HDT pool (legacy single pool). Direction labels come
      // straight from the chain.
      return (
        <>
          <DetailRow label="Direction" value={String(p.direction)} highlight />
          <DetailRow label="Min out" value={fmtUnits(String(p.min_out), 18) + " " + (String(p.output_symbol) || "")} />
        </>
      );
    }
    case "token_set_metadata":
      return (
        <>
          <DetailRow label="Token" value={`${tokSym ?? `#${p.token_id}`} (id ${p.token_id})`} />
          {p.logo_url     && <DetailRow label="Logo URL"    value={String(p.logo_url)} />}
          {p.website      && <DetailRow label="Website"     value={String(p.website)} />}
          {p.description  && <DetailRow label="Description" value={String(p.description)} />}
          {p.twitter      && <DetailRow label="Twitter"     value={String(p.twitter)} />}
          {p.telegram     && <DetailRow label="Telegram"    value={String(p.telegram)} />}
          {p.discord      && <DetailRow label="Discord"     value={String(p.discord)} />}
        </>
      );
    case "validator_add":
      return (
        <>
          <DetailRow label="Validator pubkey" value={String(p.pubkey)} mono />
          <DetailRow label="Voting power" value={String(p.power)} highlight />
        </>
      );
    case "validator_remove":
      return <DetailRow label="Validator address" value={String(p.address)} mono linkAddr highlight />;
    case "validator_edit":
      return (
        <>
          <DetailRow label="Validator address" value={String(p.address)} mono linkAddr />
          <DetailRow label="New voting power" value={String(p.new_power)} highlight />
        </>
      );
    case "governor_change":
      return <DetailRow label="New governor" value={String(p.new_governor)} mono linkAddr highlight />;
    case "register_pay_id":
      return (
        <>
          <DetailRow label="PayID" value={String(p.pay_id)} highlight />
          <DetailRow label="Display name" value={String(p.name)} />
        </>
      );

    default:
      // Fallback for kinds we haven't bespoke-rendered yet (rare wrapper
      // sub-variants whose inner shape varies a lot). Show the raw decoded
      // payload so users still see real data — never hide it.
      return (
        <div className="space-y-1 pt-2 border-t border-border/50">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Decoded payload ({prettyKind(typedTx.kind)})
          </div>
          <pre className="text-[10px] font-mono p-2 rounded bg-muted/40 overflow-auto max-h-64">
            {JSON.stringify(p, null, 2)}
          </pre>
        </div>
      );
  }
}

function TxDetail({ hash }: { hash: string }) {
  const { toast } = useToast();
  const [tx, setTx] = useState<EthTxLite | null | undefined>(undefined);
  const [receipt, setReceipt] = useState<EthReceipt | null | undefined>(undefined);
  const [typedTx, setTypedTx] = useState<ZbxTypedTx | null | undefined>(undefined);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTx(undefined); setReceipt(undefined); setTypedTx(undefined);
      const [t, r, zt] = await Promise.all([
        getEthTx(hash),
        getEthReceipt(hash),
        getZbxTypedTx(hash),
      ]);
      if (cancelled) return;
      setTx(t); setReceipt(r); setTypedTx(zt);
    })();
    return () => { cancelled = true; };
  }, [hash, refreshTick]);

  if (tx === undefined) return <Card className="p-6 text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading transaction…</Card>;
  if (!tx) return <Card className="p-6 text-sm text-muted-foreground">Transaction not found.</Card>;

  const block = tx.blockNumber ? hexToInt(tx.blockNumber) : null;
  const status = receipt?.status;
  const ok = status === "0x1";
  const reverted = status === "0x0";
  const pending = receipt === null && tx;

  // Phase H.1 — when typedTx is available, the eth-style "Value" row is
  // misleading for any non-Transfer kind (it always reads 0 ZBX because
  // the real amounts live inside the TxKind enum). Hide that row in that
  // case and let `TypedPayloadView` show the semantic amounts instead.
  //
  // NOTE: `variant_name()` on the chain side returns lowercase snake_case
  // (e.g. "transfer", "token_pool_create") — NOT PascalCase. We compare
  // against the lowercase form here. If `typedTx` is unavailable (older
  // than the recent-tx ring window, or the node doesn't support
  // `zbx_getTxByHash`) we fall back to the eth-style row so callers
  // always see *something* in the value slot.
  const isTransferKind = typedTx?.kind === "transfer" || !typedTx;

  return (
    <div className="space-y-4">
      <BackLink />
      <Card className="p-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Transaction</div>
            <div className="font-mono text-sm break-all">{tx.hash}</div>
          </div>
          <div className="flex items-center gap-2">
            {typedTx && (
              <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                {prettyKind(typedTx.kind)}
              </Badge>
            )}
            {ok && <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40"><CheckCircle2 className="h-3 w-3 mr-1" /> Success</Badge>}
            {reverted && <Badge className="bg-red-500/20 text-red-300 border-red-500/40"><XCircle className="h-3 w-3 mr-1" /> Reverted</Badge>}
            {pending && <Badge variant="outline" className="text-amber-300 border-amber-500/40">Pending</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setRefreshTick((t) => t + 1)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <DetailRow label="Block" value={block !== null ? `#${block.toLocaleString()}` : "pending"} link={block !== null ? `/block-explorer?q=${block}` : undefined} />
        <DetailRow label="From" value={tx.from} mono linkAddr onCopy={(v) => { navigator.clipboard.writeText(v); toast({ title: "Copied" }); }} />
        <DetailRow label="To" value={tx.to ?? "(contract creation)"} mono linkAddr={!!tx.to} />
        {isTransferKind && (
          <DetailRow label="Value" value={`${weiHexToZbx(tx.value)} ZBX`} highlight />
        )}
        <DetailRow label="Nonce" value={String(hexToInt(tx.nonce))} />
        <DetailRow label="Gas (limit)" value={hexToInt(tx.gas).toLocaleString()} />
        {tx.gasPrice && <DetailRow label="Gas price" value={`${hexToInt(tx.gasPrice).toLocaleString()} wei`} />}
        {receipt && <DetailRow label="Gas used" value={hexToInt(receipt.gasUsed).toLocaleString()} />}
        {receipt?.contractAddress && <DetailRow label="Contract created" value={receipt.contractAddress} mono linkAddr />}

        {/* Phase H.1 — typed payload renderer (when zbx_getTxByHash returns
            a hit). For Transfer kind this is a no-op; for everything else
            it's where the actual semantic amounts live. */}
        {typedTx && !isTransferKind && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="h-3 w-3" /> {prettyKind(typedTx.kind)} payload
            </div>
            <TypedPayloadView typedTx={typedTx} />
          </div>
        )}

        {tx.input && tx.input !== "0x" && (
          <div className="space-y-1 pt-2 border-t border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Input data</div>
            <code className="block text-[11px] font-mono break-all p-2 rounded bg-muted/40">{tx.input}</code>
          </div>
        )}
        {receipt?.logs && (receipt.logs as unknown[]).length > 0 && (
          <div className="space-y-1 pt-2 border-t border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Event logs ({(receipt.logs as unknown[]).length})
            </div>
            <pre className="text-[10px] font-mono p-2 rounded bg-muted/40 overflow-auto max-h-64">{JSON.stringify(receipt.logs, null, 2)}</pre>
          </div>
        )}
      </Card>
    </div>
  );
}

// ───── Address detail ────────────────────────────────────────────────────────
function AddressDetail({ addr }: { addr: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<{ balance: string; nonce: number; code: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(null);
      try {
        const [bal, n, code] = await Promise.all([
          rpc<string>("zbx_getBalance", [addr]),
          rpc<unknown>("zbx_getNonce", [addr]),
          rpc<string>("zbx_getCode", [addr]).catch(() => "0x"),
        ]);
        if (cancelled) return;
        const nonce = typeof n === "number" ? n : parseInt(String(n), typeof n === "string" && (n as string).startsWith("0x") ? 16 : 10);
        setData({ balance: weiHexToZbx(bal), nonce, code });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [addr]);

  return (
    <div className="space-y-4">
      <BackLink />
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Wallet className="h-3 w-3" /> Address
            </div>
            <div className="font-mono text-sm break-all">{addr}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(addr); toast({ title: "Copied" }); }}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        {err && <div className="text-xs text-red-300">{err}</div>}
        {!data && !err && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching state…</div>
        )}
        {data && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Balance</div>
              <div className="text-2xl font-bold text-primary">{data.balance} <span className="text-sm font-normal text-muted-foreground">ZBX</span></div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Nonce</div>
              <div className="text-2xl font-bold">{data.nonce}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Account type</div>
              <div className="text-2xl font-bold">{data.code === "0x" ? "EOA" : "Contract"}</div>
              {data.code !== "0x" && (
                <div className="text-[10px] text-muted-foreground mt-1">code length {((data.code.length - 2) / 2).toLocaleString()} bytes</div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ───── Generic detail row ────────────────────────────────────────────────────
function DetailRow({
  label, value, mono, highlight, linkAddr, link, onCopy,
}: {
  label: string; value: string;
  mono?: boolean; highlight?: boolean;
  linkAddr?: boolean;
  link?: string;
  onCopy?: (v: string) => void;
}) {
  const inner = (
    <span className={`break-all ${mono ? "font-mono text-xs" : "text-sm"} ${highlight ? "font-bold text-primary" : ""}`}>
      {value}
    </span>
  );
  let display: React.ReactNode = inner;
  if (link) {
    display = <WLink href={link}><a className="hover:text-primary">{inner}</a></WLink>;
  } else if (linkAddr && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    display = <WLink href={`/block-explorer?q=${value}`}><a className="hover:text-primary">{inner}</a></WLink>;
  }
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 last:border-0">
      <div className="text-xs uppercase tracking-wider text-muted-foreground shrink-0 w-32">{label}</div>
      <div className="text-right max-w-[68%] flex-1 flex items-start justify-end gap-2">
        {display}
        {onCopy && (
          <button onClick={() => onCopy(value)} className="text-muted-foreground hover:text-foreground shrink-0">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <WLink href="/block-explorer">
      <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to overview
      </a>
    </WLink>
  );
}
