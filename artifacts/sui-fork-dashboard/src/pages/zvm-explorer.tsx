import React, { useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "@/lib/zbx-rpc";
import {
  Cpu, Search, Send, Box, Hash, Wallet, Code2, Zap, Wifi,
  Check, Copy, AlertCircle, ChevronRight, Layers, Activity, Sparkles,
  AtSign, Compass, FileText, ExternalLink, X, BookOpen, Terminal,
  Radio, Network, Filter, RotateCw, Clock, History, Trash2, Play,
  ArrowUpRight, Pause, Eye, EyeOff, Coins, ShieldCheck, Server,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ─────────────────────────────────────────────────────────────────────────────
// ZVM Explorer — native zbx_* + eth_* RPC playground (ZVM = Zebvix Virtual Machine)
// Native zbx_* methods are always available; eth_*/net_*/web3_* only when the
// node binary is built with --features zvm. UI prefers zbx_* labels for the
// always-on path and falls back to eth_* labels for ZVM-only methods.
// ─────────────────────────────────────────────────────────────────────────────

/** Seed handed to RpcConsole when user clicks "Try" in the Method Catalog.
 *  `nonce` ensures the console re-applies the seed even if the same method
 *  is selected twice in a row (state-equality short-circuit defeat). */
export type ConsoleSeed = { method: string; params: string; nonce: number };

type TabKey = "search" | "catalog" | "console" | "stream" | "network";

export default function ZvmExplorer() {
  const [seed, setSeed] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabKey>("search");
  const [consoleSeed, setConsoleSeed] = useState<ConsoleSeed | null>(null);

  // "Try" handoff from the Method Catalog → RPC Console:
  // 1) seed the console inputs (method + params)
  // 2) flip to the console tab so the user sees the result immediately.
  const tryMethod = (method: string, params: string) => {
    setConsoleSeed({ method, params, nonce: Date.now() });
    setActiveTab("console");
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Header />
      <NetStatusGrid />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/40 border border-border p-1 rounded-xl">
          <TabsTrigger value="search" className="text-xs gap-1.5">
            <Search className="h-3.5 w-3.5" /> Search &amp; Inspect
          </TabsTrigger>
          <TabsTrigger value="catalog" className="text-xs gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Method Catalog
          </TabsTrigger>
          <TabsTrigger value="console" className="text-xs gap-1.5">
            <Terminal className="h-3.5 w-3.5" /> RPC Console
          </TabsTrigger>
          <TabsTrigger value="stream" className="text-xs gap-1.5">
            <Radio className="h-3.5 w-3.5" /> Live Tx Stream
          </TabsTrigger>
          <TabsTrigger value="network" className="text-xs gap-1.5">
            <Network className="h-3.5 w-3.5" /> Network Insights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-4 space-y-6">
          <SmartSearch seed={seed} onSeed={setSeed} />
          <div className="flex items-center gap-2 pt-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Manual Tools</h2>
            <span className="text-[10px] text-muted-foreground">— direct RPC inspectors</span>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <BalanceTool />
            <NonceCodeTool />
          </div>
          <BlockTool />
          <TxTool />
        </TabsContent>

        <TabsContent value="catalog" className="mt-4">
          <MethodCatalog onTry={tryMethod} />
        </TabsContent>

        <TabsContent value="console" className="mt-4">
          <RpcConsole seed={consoleSeed} />
        </TabsContent>

        <TabsContent value="stream" className="mt-4">
          <TxStreamPanel onCrossLink={(v) => { setSeed(v); setActiveTab("search"); }} />
        </TabsContent>

        <TabsContent value="network" className="mt-4">
          <NetworkInsightsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
function Header() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/15 via-primary/5 to-cyan-500/10 p-6">
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{
        background: "radial-gradient(circle at 20% 30%, rgba(168,85,247,.18), transparent 50%), radial-gradient(circle at 80% 70%, rgba(34,211,238,.12), transparent 50%)",
      }} />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 animate-pulse">
              <Wifi className="h-3 w-3" /> ZVM ENDPOINT LIVE
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-violet-500/40 bg-violet-500/10 text-violet-300">
              <Cpu className="h-3 w-3" /> Cancun-compatible
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
              <Hash className="h-3 w-3" /> chain_id 0x1ec6
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-3">
            <Cpu className="h-8 w-8 text-violet-400" /> ZVM Explorer
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Native Zebvix RPC playground. <span className="font-mono text-foreground">zbx_*</span> methods (always-on)
            aur <span className="font-mono text-foreground">eth_*</span>/<span className="font-mono text-foreground">net_*</span>/<span className="font-mono text-foreground">web3_*</span> ZVM-namespace
            (gated behind <span className="font-mono text-foreground">--features zvm</span>) directly Zebvix L1 par execute hote hain — koi proxy emulation nahi.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Net status grid — mix of always-on zbx_* and ZVM-gated eth_*/net_*/web3_*
// `zbx_blockNumber` returns an object {height, hex, hash, timestamp_ms,
// proposer} per rpc.rs:125-139, so we read `.height` (number) for display
// and reconstruct a hex view-string. The accept-string branch is defensive
// only (in case a future schema change returns a bare hex string), but the
// canonical response is the object form. Other tiles (gasPrice /
// clientVersion / syncing) require --features zvm and gracefully render
// "—" when unavailable.
// ─────────────────────────────────────────────────────────────────────────────
function NetStatusGrid() {
  const [data, setData] = useState<{
    chainId: string | null; blockHex: string | null; blockNum: bigint | null;
    gasPrice: string | null;
    netVersion: string | null; clientVersion: string | null; syncing: any;
  }>({ chainId: null, blockHex: null, blockNum: null, gasPrice: null, netVersion: null, clientVersion: null, syncing: null });

  useEffect(() => {
    let mounted = true;
    async function tick() {
      const [cid, zbn, gp, nv, cv, syn] = await Promise.all([
        rpc<string>("zbx_chainId").catch(() => null),
        rpc<any>("zbx_blockNumber").catch(() => null),
        rpc<string>("zbx_gasPrice").catch(() => null),
        rpc<string>("zbx_netVersion").catch(() => null),
        rpc<string>("zbx_clientVersion").catch(() => null),
        rpc<any>("zbx_syncing").catch(() => null),
      ]);
      // zbx_blockNumber returns {height: number, hex: string, ...} per rpc.rs
      let blockHex: string | null = null;
      let blockNum: bigint | null = null;
      if (zbn && typeof zbn === "object") {
        if (typeof zbn.height === "number") blockNum = BigInt(zbn.height);
        if (typeof zbn.hex === "string") blockHex = zbn.hex;
        else if (blockNum !== null) blockHex = `0x${blockNum.toString(16)}`;
      } else if (typeof zbn === "string") {
        blockHex = zbn;
        blockNum = hexToBigInt(zbn);
      }
      if (mounted) setData({ chainId: cid, blockHex, blockNum, gasPrice: gp, netVersion: nv, clientVersion: cv, syncing: syn });
    }
    tick();
    const t = window.setInterval(tick, 4000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const cidNum = hexToNum(data.chainId);
  const gpNum = hexToBigInt(data.gasPrice);
  const cells = [
    { label: "zbx_chainId", value: data.chainId, sub: cidNum !== null ? `${cidNum}` : "" },
    { label: "zbx_blockNumber", value: data.blockHex, sub: data.blockNum !== null ? `#${data.blockNum.toLocaleString()}` : "" },
    { label: "zbx_gasPrice", value: data.gasPrice, sub: gpNum !== null ? `${gpNum.toString()} wei` : "" },
    { label: "zbx_netVersion", value: data.netVersion, sub: data.netVersion ? "decimal" : "" },
    { label: "zbx_clientVersion", value: data.clientVersion, sub: "" },
    { label: "zbx_syncing", value: data.syncing === false ? "false" : data.syncing ? "true" : null, sub: data.syncing === false ? "in sync" : "" },
  ];

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" /> Network Status (auto-refresh 4s)
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="p-3 rounded-lg border border-border bg-card">
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide truncate">{c.label}</div>
            <div className="text-sm font-bold tabular-nums mt-1 truncate font-mono">{c.value ?? "—"}</div>
            {c.sub && <div className="text-[9px] text-muted-foreground truncate mt-0.5">{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance Tool — zbx_getBalance (always-on alias of eth_getBalance per
// rpc.rs:141 — same handler, both names share the match arm so the call
// works on every Zebvix node regardless of --features zvm).
// ─────────────────────────────────────────────────────────────────────────────
function BalanceTool() {
  const [addr, setAddr] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setErr("Invalid address (need 0x + 40 hex)"); return; }
    setLoading(true); setErr(null); setBalance(null);
    try {
      const b = await rpc<string>("zbx_getBalance", [addr.toLowerCase(), "latest"]);
      setBalance(b);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  return (
    <ToolCard title="zbx_getBalance" icon={Wallet} accent="emerald">
      <div className="space-y-2">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… (20-byte ZVM address)"
          className="w-full px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-primary outline-none" />
        <button onClick={lookup} disabled={loading || !addr}
          className="w-full px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> {loading ? "fetching…" : "Lookup balance"}
        </button>
        {err && <ErrorBox msg={err} />}
        {balance && (
          <div className="space-y-1 pt-2 text-xs">
            <Kv label="raw (hex)" value={balance} mono />
            <Kv label="wei" value={fmtBig(balance)} mono />
            <Kv label="ZBX" value={fmtZbx(balance)} highlight />
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nonce + Code Tool — zbx_getNonce + zbx_getCode (both always-on aliases).
// `zbx_getNonce` returns a u64 number (NOT hex) per rpc.rs:148-153; we
// accept the raw number and format it. `zbx_getCode` returns "0x" for EOAs
// and the contract bytecode hex for contract accounts.
// ─────────────────────────────────────────────────────────────────────────────
function NonceCodeTool() {
  const [addr, setAddr] = useState("");
  const [nonce, setNonce] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setErr("Invalid address"); return; }
    setLoading(true); setErr(null); setNonce(null); setCode(null);
    try {
      const [n, c] = await Promise.all([
        rpc<unknown>("zbx_getNonce", [addr.toLowerCase()]),
        rpc<string>("zbx_getCode", [addr.toLowerCase(), "latest"]),
      ]);
      setNonce(parseNonceLocal(n));
      setCode(c);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  const isContract = !!code && code !== "0x" && code !== "0x0";
  return (
    <ToolCard title="zbx_getNonce + zbx_getCode" icon={Code2} accent="violet">
      <div className="space-y-2">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… (account or contract)"
          className="w-full px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-primary outline-none" />
        <button onClick={lookup} disabled={loading || !addr}
          className="w-full px-3 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 text-violet-950 text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> {loading ? "fetching…" : "Inspect account"}
        </button>
        {err && <ErrorBox msg={err} />}
        {(nonce !== null || code !== null) && (
          <div className="space-y-1 pt-2 text-xs">
            {nonce !== null && <Kv label="nonce" value={`${nonce.toLocaleString()}`} mono />}
            {code !== null && (
              <>
                <Kv label="account type" value={isContract ? "CONTRACT" : "EOA"}
                  highlight color={isContract ? "violet" : "emerald"} />
                <Kv label="code size" value={isContract ? `${(code.length - 2) / 2} bytes` : "0 bytes"} />
                {isContract && (
                  <details>
                    <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">show bytecode</summary>
                    <pre className="mt-1 p-2 bg-background/60 rounded text-[10px] font-mono break-all whitespace-pre-wrap max-h-48 overflow-y-auto">{code}</pre>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// Parse `zbx_getNonce` response — accepts u64 number, decimal string, or
// hex string for forward-compat with ZVM-bridged nonces. Mirrors the same
// helper on the Balance Lookup page so both pages stay schema-tolerant.
function parseNonceLocal(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^\d+$/.test(s)) return parseInt(s, 10);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Block Tool — combines eth_getBlockByNumber (ZVM-shaped fields like number,
// hash, gasLimit, gasUsed, baseFeePerGas, transactions[]) with the native
// zbx_getBlockByNumber (which carries Zebvix-specific fields the ZVM layer
// does not expose: real proposer address — eth_getBlockByNumber returns
// miner=0x00…0 because there is no ZVM coinbase concept on Zebvix).
//
// Resolution flow:
//   1. Decide whether `tag` is a string tag (latest/earliest/pending/finalized/
//      safe), a decimal height, or a hex height.
//   2. Call eth_getBlockByNumber(tagOrHex, false) — works for ALL of those
//      directly.
//   3. Use the returned `number` (hex) to derive the numeric height, then
//      call zbx_getBlockByNumber(height) to fetch native fields and
//      override `miner` with the actual proposer.
// ─────────────────────────────────────────────────────────────────────────────
function BlockTool() {
  const [tag, setTag] = useState("latest");
  const [block, setBlock] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    setLoading(true); setErr(null); setBlock(null);
    try {
      const t = tag.trim().toLowerCase();
      // Build the eth-RPC-compatible param. eth_getBlockByNumber natively
      // accepts the tag strings AND a hex-encoded height; it does NOT
      // accept a bare decimal number.
      let ethParam: string;
      if (/^\d+$/.test(t)) {
        ethParam = "0x" + parseInt(t, 10).toString(16);
      } else if (/^0x[0-9a-f]+$/.test(t)) {
        ethParam = t;
      } else if (["latest", "earliest", "pending", "finalized", "safe"].includes(t)) {
        ethParam = t;
      } else {
        throw new Error(`unrecognized block tag: ${tag}`);
      }

      const ethBlock = await rpc<any>("eth_getBlockByNumber", [ethParam, false]);
      if (!ethBlock) {
        throw new Error("block not found");
      }
      const heightDec = parseInt(ethBlock.number, 16);

      // Best-effort enrichment from native side. The chain's eth_getBlockByNumber
      // does NOT include `hash` or `parentHash` (incomplete ZVM RPC impl), so we
      // recover them from the native methods:
      //   - header.parent_hash from zbx_getBlockByNumber(height) → parentHash
      //   - own hash:   * if h is the tip → zbx_blockNumber.hash
      //                 * else → zbx_getBlockByNumber(h+1).header.parent_hash
      //                   (Merkle property: child header always commits to parent hash)
      //   - header.proposer → miner (override eth's 0x000…0)
      const [nativeBlock, nativeNext, tipInfo] = await Promise.all([
        rpc<any>("zbx_getBlockByNumber", [heightDec]).catch(() => null),
        rpc<any>("zbx_getBlockByNumber", [heightDec + 1]).catch(() => null),
        rpc<any>("zbx_blockNumber").catch(() => null),
      ]);

      const proposer = nativeBlock?.header?.proposer ?? null;
      const parentHash = nativeBlock?.header?.parent_hash ?? null;
      let ownHash: string | null = null;
      if (nativeNext?.header?.parent_hash) {
        ownHash = nativeNext.header.parent_hash;
      } else if (tipInfo?.height === heightDec && tipInfo?.hash) {
        ownHash = tipInfo.hash;
      }

      setBlock({
        ...ethBlock,
        hash: ownHash ?? ethBlock.hash ?? null,
        parentHash: parentHash ?? ethBlock.parentHash ?? null,
        miner: proposer ?? ethBlock.miner,
        _heightDec: heightDec,
      });
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  return (
    <ToolCard title="zbx_getBlockByNumber" icon={Box} accent="cyan">
      <div className="space-y-2">
        <div className="flex gap-2">
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="latest, earliest, pending, or block number"
            className="flex-1 px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-primary outline-none" />
          <button onClick={lookup} disabled={loading}
            className="px-4 py-2 rounded-md bg-cyan-500 hover:bg-cyan-400 text-cyan-950 text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" /> Fetch
          </button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {["latest", "earliest", "pending"].map((t) => (
            <button key={t} onClick={() => setTag(t)}
              className="px-2 py-0.5 rounded text-[10px] font-mono border border-border hover:bg-muted/30">{t}</button>
          ))}
        </div>
        {err && <ErrorBox msg={err} />}
        {block && (
          <div className="grid grid-cols-2 gap-1 pt-2 text-xs">
            <Kv label="number" value={`${block._heightDec ?? "—"} (${block.number ?? "—"})`} mono />
            <Kv label="hash" value={short(block.hash)} mono />
            <Kv label="parent" value={short(block.parentHash)} mono />
            <Kv label="timestamp" value={fmtTimestamp(block.timestamp)} />
            <Kv label="proposer" value={short(block.miner)} mono />
            <Kv label="gasLimit" value={fmtBig(block.gasLimit)} mono />
            <Kv label="gasUsed" value={fmtBig(block.gasUsed)} mono />
            <Kv label="baseFeePerGas" value={block.baseFeePerGas ? `${fmtBig(block.baseFeePerGas)} wei` : "—"} mono />
            <Kv label="tx count" value={Array.isArray(block.transactions) ? block.transactions.length : 0} highlight />
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tx Tool — tries eth_getTransactionByHash + eth_getTransactionReceipt FIRST
// (for any future ZVM-tx wiring), then falls back to the native ring-buffer
// `zbx_recentTxs` which is the source of truth for indexed Zebvix txs today
// (Transfer / Staking / Proposal / Bridge / Multisig / Swap …). This prevents
// a hard error when eth_getTransactionByHash is unsupported on-chain or when
// looking up a native (non-ZVM) tx hash that has no ZVM receipt.
// ─────────────────────────────────────────────────────────────────────────────
type NativeTx = {
  hash: string;
  from: string;
  to: string;
  amount: string;
  fee: string;
  nonce: number;
  height: number;
  timestamp_ms: number;
  kind: string;
};

function TxTool() {
  const [hash, setHash] = useState("");
  const [tx, setTx] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [nativeTx, setNativeTx] = useState<NativeTx | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function lookup() {
    // Always clear prior results FIRST so a fresh lookup never leaves
    // stale data on screen (especially important when re-querying with a
    // hash that doesn't resolve — the prior success card must not linger).
    setTx(null); setReceipt(null); setNativeTx(null); setInfo(null); setErr(null);
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      setErr("Invalid tx hash (need 0x + 64 hex)");
      return;
    }
    setLoading(true);
    const lower = hash.toLowerCase();
    try {
      // 1. Try the ZVM path. Both calls are best-effort — the chain
      //    resolves native ZBX-tx hashes from the recent-tx ring buffer
      //    (synthetic Ethereum-shape JSON, status=0x1 by construction since
      //    failed txs are never indexed). Returns `null` when the hash is
      //    outside the rolling 1000-tx window.
      const [t, r] = await Promise.all([
        rpc<any>("eth_getTransactionByHash", [lower]).catch(() => null),
        rpc<any>("eth_getTransactionReceipt", [lower]).catch(() => null),
      ]);
      setTx(t); setReceipt(r);

      // 2. If ZVM path produced nothing, fall back to native ring buffer.
      if (!t && !r) {
        const ring = await rpc<{ txs: NativeTx[]; total_indexed: number; max_cap: number }>(
          "zbx_recentTxs",
          [1000],
        ).catch(() => null);
        const found = ring?.txs?.find((x) => x.hash.toLowerCase() === lower) ?? null;
        if (found) {
          setNativeTx(found);
          setInfo(`Found in native tx index (no ZVM receipt — kind: ${found.kind})`);
        } else {
          const indexed = ring?.total_indexed ?? 0;
          const cap = ring?.max_cap ?? 1000;
          setErr(
            `Hash not found. eth_getTransactionByHash + the native ring buffer ` +
            `(${indexed} indexed, cap ${cap}) both came up empty. ` +
            `Older tx? It may have rolled out of the buffer — try fetching the block directly.`,
          );
        }
      }
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  return (
    <ToolCard title="eth_getTransactionByHash + Receipt" icon={Hash} accent="amber" wide>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x… (32-byte tx hash)"
            className="flex-1 px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-primary outline-none" />
          <button onClick={lookup} disabled={loading || !hash}
            className="px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-amber-950 text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" /> Lookup
          </button>
        </div>
        {err && <ErrorBox msg={err} />}
        {info && (
          <div className="px-3 py-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 text-[11px]">
            {info}
          </div>
        )}
        {(tx || receipt || nativeTx) && (
          <div className="grid md:grid-cols-2 gap-3 pt-2 text-xs">
            <div className="p-3 rounded-md border border-border bg-background/40">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2">
                {tx ? "Transaction (ZVM)" : nativeTx ? "Transaction (native)" : "Transaction"}
              </div>
              {tx ? (
                <div className="space-y-1">
                  <Kv label="from" value={short(tx.from)} mono />
                  <Kv label="to" value={tx.to ? short(tx.to) : "(contract create)"} mono />
                  <Kv label="value" value={`${fmtZbx(tx.value, 6, "0")} ZBX`} highlight />
                  <Kv label="gas" value={fmtBig(tx.gas)} mono />
                  <Kv label="nonce" value={fmtBig(tx.nonce, "0")} mono />
                  <Kv label="type" value={tx.type ?? "0x0"} mono />
                  <Kv label="block" value={tx.blockNumber ? `#${fmtBig(tx.blockNumber)}` : "pending"} />
                </div>
              ) : nativeTx ? (
                <div className="space-y-1">
                  <Kv label="kind" value={nativeTx.kind} highlight />
                  <Kv label="from" value={short(nativeTx.from)} mono />
                  <Kv label="to" value={short(nativeTx.to)} mono />
                  <Kv label="amount" value={`${fmtZbx(nativeTx.amount, 6, "0")} ZBX`} highlight />
                  <Kv label="fee" value={`${fmtZbx(nativeTx.fee, 6, "0")} ZBX`} mono />
                  <Kv label="nonce" value={String(nativeTx.nonce)} mono />
                  <Kv label="block" value={`#${nativeTx.height}`} />
                  {/* fmtTimestamp expects unix seconds (multiplies by 1000 internally),
                      so divide ms timestamp by 1000 first. */}
                  <Kv label="timestamp" value={fmtTimestamp("0x" + Math.floor(nativeTx.timestamp_ms / 1000).toString(16))} />
                </div>
              ) : <div className="text-muted-foreground">tx not found</div>}
            </div>
            <div className="p-3 rounded-md border border-border bg-background/40">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2">Receipt</div>
              {receipt ? (
                <div className="space-y-1">
                  <Kv label="status" value={receipt.status === "0x1" ? "SUCCESS" : "FAILED"}
                    highlight color={receipt.status === "0x1" ? "emerald" : "red"} />
                  <Kv label="gasUsed" value={fmtBig(receipt.gasUsed)} mono />
                  <Kv label="effectiveGasPrice" value={receipt.effectiveGasPrice ? `${fmtBig(receipt.effectiveGasPrice)} wei` : "—"} mono />
                  <Kv label="contractAddress" value={receipt.contractAddress ?? "—"} mono />
                  <Kv label="logs" value={Array.isArray(receipt.logs) ? receipt.logs.length : 0} highlight />
                </div>
              ) : nativeTx ? (
                <div className="space-y-1 text-muted-foreground">
                  <div className="text-[11px]">Native txs are committed atomically — no ZVM receipt is emitted.</div>
                  <Kv label="status" value={"COMMITTED (native)"} highlight color="emerald" />
                  <Kv label="block" value={`#${nativeTx.height}`} />
                  <Kv label="fee paid" value={`${fmtZbx(nativeTx.fee, 6, "0")} ZBX`} mono />
                </div>
              ) : <div className="text-muted-foreground">Receipt unavailable — transaction is pending or not yet indexed.</div>}
            </div>
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC method catalog — single source of truth for the Method Catalog tab and
// the autocomplete in the RPC Console. Each entry is grouped by namespace.
// `gated: true` means the method requires `--features zvm` on the node binary;
// the catalog renders a badge so the user knows what may 404 / -32601.
// ─────────────────────────────────────────────────────────────────────────────
type CatalogEntry = {
  method: string;
  namespace: "zbx" | "eth" | "net" | "web3";
  category: "Chain" | "Account" | "Block" | "Transaction" | "Identity" | "Network" | "Utility";
  desc: string;
  paramsExample: string;
  gated?: boolean;
};

const RPC_CATALOG: CatalogEntry[] = [
  // ── zbx_* (always-on native methods) ────────────────────────────────────
  { method: "zbx_chainId",         namespace: "zbx", category: "Identity", desc: "0x-prefixed chain id (0x1ec6 = 7878).", paramsExample: "[]" },
  { method: "zbx_netVersion",      namespace: "zbx", category: "Identity", desc: "Decimal chain id as string (\"7878\").", paramsExample: "[]" },
  { method: "zbx_clientVersion",   namespace: "zbx", category: "Identity", desc: "Node binary version string.", paramsExample: "[]" },
  { method: "zbx_blockNumber",     namespace: "zbx", category: "Chain",    desc: "Tip header: {height, hex, hash, timestamp_ms, proposer}.", paramsExample: "[]" },
  { method: "zbx_chainInfo",       namespace: "zbx", category: "Chain",    desc: "Detailed chain config + tip summary.", paramsExample: "[]" },
  { method: "zbx_supply",          namespace: "zbx", category: "Chain",    desc: "Token supply breakdown (circulating, max, burned).", paramsExample: "[]" },
  { method: "zbx_listValidators",  namespace: "zbx", category: "Chain",    desc: "Active validator set with stakes + uptime.", paramsExample: "[]" },
  { method: "zbx_gasPrice",        namespace: "zbx", category: "Chain",    desc: "Recommended fee in wei (hex). AMM-pegged.", paramsExample: "[]" },
  { method: "zbx_getBalance",      namespace: "zbx", category: "Account",  desc: "Account balance in wei (hex). Param: address [, tag].", paramsExample: '["0x0000000000000000000000000000000000000000","latest"]' },
  { method: "zbx_getNonce",        namespace: "zbx", category: "Account",  desc: "Next outgoing nonce for an address.", paramsExample: '["0x0000000000000000000000000000000000000000"]' },
  { method: "zbx_getBlockByNumber", namespace: "zbx", category: "Block",   desc: "Native block: {header, txs, signature}. Param: height (number).", paramsExample: "[0]" },
  { method: "zbx_recentTxs",       namespace: "zbx", category: "Transaction", desc: "Recent indexed txs ring (cap 1000). Returns {txs[], stored, total_indexed}.", paramsExample: "[50]" },
  { method: "zbx_sendRawTransaction", namespace: "zbx", category: "Transaction", desc: "Submit a signed Zebvix tx (hex). Returns the tx hash.", paramsExample: '["0x..."]' },

  // ── eth_* (gated behind --features zvm) ──────────────────────────────────
  { method: "eth_chainId",            namespace: "eth", category: "Identity",    desc: "Same as zbx_chainId via eth namespace.", paramsExample: "[]", gated: true },
  { method: "eth_blockNumber",        namespace: "eth", category: "Chain",       desc: "Tip block number as hex.", paramsExample: "[]", gated: true },
  { method: "eth_gasPrice",           namespace: "eth", category: "Chain",       desc: "Recommended gas price (wei hex).", paramsExample: "[]", gated: true },
  { method: "eth_getBalance",         namespace: "eth", category: "Account",     desc: "Balance via eth namespace.", paramsExample: '["0x0000000000000000000000000000000000000000","latest"]', gated: true },
  { method: "eth_getTransactionCount", namespace: "eth", category: "Account",    desc: "Tx count (nonce) for an address.", paramsExample: '["0x0000000000000000000000000000000000000000","latest"]', gated: true },
  { method: "eth_getCode",            namespace: "eth", category: "Account",     desc: "Bytecode at an address (0x for EOAs).", paramsExample: '["0x0000000000000000000000000000000000000000","latest"]', gated: true },
  { method: "eth_getBlockByNumber",   namespace: "eth", category: "Block",       desc: "Eth-shaped block. Stub: returns tip — prefer zbx_getBlockByNumber.", paramsExample: '["latest", false]', gated: true },
  { method: "eth_getBlockByHash",     namespace: "eth", category: "Block",       desc: "Eth-shaped block by hash.", paramsExample: '["0x0000000000000000000000000000000000000000000000000000000000000000", false]', gated: true },
  { method: "eth_getTransactionByHash", namespace: "eth", category: "Transaction", desc: "Eth-shaped tx by hash.", paramsExample: '["0x0000000000000000000000000000000000000000000000000000000000000000"]', gated: true },
  { method: "eth_getTransactionReceipt", namespace: "eth", category: "Transaction", desc: "Receipt + logs for an executed tx.", paramsExample: '["0x0000000000000000000000000000000000000000000000000000000000000000"]', gated: true },
  { method: "eth_call",               namespace: "eth", category: "Utility",     desc: "Read-only contract call.", paramsExample: '[{"to":"0x...","data":"0x..."},"latest"]', gated: true },
  { method: "eth_estimateGas",        namespace: "eth", category: "Utility",     desc: "Estimate gas for a call.", paramsExample: '[{"to":"0x...","data":"0x..."}]', gated: true },
  { method: "eth_sendRawTransaction", namespace: "eth", category: "Transaction", desc: "Submit a raw eth-shaped signed tx.", paramsExample: '["0x..."]', gated: true },

  // ── net_* / web3_* (informational, gated) ───────────────────────────────
  { method: "net_version",            namespace: "net",  category: "Network",   desc: "Network id (\"7878\").", paramsExample: "[]", gated: true },
  { method: "net_listening",          namespace: "net",  category: "Network",   desc: "True if the node is listening for peers.", paramsExample: "[]", gated: true },
  { method: "net_peerCount",          namespace: "net",  category: "Network",   desc: "Connected-peer count (hex).", paramsExample: "[]", gated: true },
  { method: "web3_clientVersion",     namespace: "web3", category: "Identity",  desc: "Node version via web3 namespace.", paramsExample: "[]", gated: true },
  { method: "web3_sha3",              namespace: "web3", category: "Utility",   desc: "keccak-256 hash of input bytes (hex).", paramsExample: '["0x68656c6c6f"]', gated: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Method Catalog — searchable, categorized list with one-click "Try" handoff
// to the RPC Console tab. Acts as the primary discovery surface for the API.
// ─────────────────────────────────────────────────────────────────────────────
function MethodCatalog({ onTry }: { onTry: (method: string, params: string) => void }) {
  const [q, setQ] = useState("");
  const [ns, setNs] = useState<"all" | "zbx" | "eth" | "net" | "web3">("all");
  const [showGated, setShowGated] = useState(true);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return RPC_CATALOG.filter((e) => {
      if (ns !== "all" && e.namespace !== ns) return false;
      if (!showGated && e.gated) return false;
      if (!needle) return true;
      return (
        e.method.toLowerCase().includes(needle) ||
        e.desc.toLowerCase().includes(needle) ||
        e.category.toLowerCase().includes(needle)
      );
    });
  }, [q, ns, showGated]);

  const grouped = useMemo(() => {
    const m = new Map<string, CatalogEntry[]>();
    for (const e of filtered) {
      const k = `${e.namespace.toUpperCase()} · ${e.category}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: RPC_CATALOG.length, zbx: 0, eth: 0, net: 0, web3: 0 };
    for (const e of RPC_CATALOG) out[e.namespace]++;
    return out;
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2 flex-wrap">
          <span className="p-1.5 rounded-md text-violet-400 bg-violet-500/10">
            <BookOpen className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-sm font-semibold">RPC Method Catalog</h3>
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} of {RPC_CATALOG.length} methods
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setShowGated((v) => !v)}
              className={`text-[10px] px-2 py-1 rounded border transition flex items-center gap-1 ${
                showGated ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-border text-muted-foreground"
              }`}
              title="Toggle ZVM-gated (--features zvm) methods"
              data-testid="button-toggle-gated"
            >
              {showGated ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              gated
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by method name, description, or category…"
              className="flex-1 px-3 py-2 text-xs rounded-md bg-background border border-border focus:border-violet-500 outline-none"
              data-testid="input-catalog-search"
            />
          </div>

          <div className="flex gap-1 flex-wrap">
            {(["all", "zbx", "eth", "net", "web3"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setNs(k)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition ${
                  ns === k
                    ? "border-violet-500/60 bg-violet-500/15 text-violet-200"
                    : "border-border hover:border-violet-500/40 hover:bg-violet-500/5"
                }`}
                data-testid={`button-catalog-ns-${k}`}
              >
                {k === "all" ? "All" : `${k}_*`} <span className="text-muted-foreground">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
          No methods match. Try clearing the filters.
        </div>
      )}

      {grouped.map(([group, entries]) => (
        <div key={group} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/20 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {group}
          </div>
          <div className="divide-y divide-border/50">
            {entries.map((e) => (
              <div key={e.method} className="p-3 flex items-start gap-3 hover:bg-muted/20 transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs font-mono font-semibold text-violet-300">{e.method}</code>
                    {e.gated && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold uppercase tracking-wide">
                        zvm-gated
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{e.desc}</p>
                  <code className="block text-[10px] font-mono text-cyan-400 mt-1 break-all">params: {e.paramsExample}</code>
                </div>
                <button
                  onClick={() => onTry(e.method, e.paramsExample)}
                  className="shrink-0 px-2.5 py-1 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-200 text-[11px] font-semibold hover:bg-violet-500/25 transition flex items-center gap-1"
                  data-testid={`button-try-${e.method}`}
                >
                  <Play className="h-3 w-3" /> Try
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Console — enhanced raw dispatcher with:
//   • per-call latency (ms)
//   • call history (last 20, replayable + deletable)
//   • copy-as-curl / copy-as-fetch snippets
//   • pretty / raw JSON toggle
//   • method autocomplete from RPC_CATALOG
// Accepts an optional `seed` to be driven from the Method Catalog "Try" buttons.
// ─────────────────────────────────────────────────────────────────────────────
type ConsoleHistoryEntry = {
  id: string;
  method: string;
  params: string;
  ok: boolean;
  ms: number;
  at: number;
  result: unknown;
  error: string | null;
};

const HISTORY_KEY = "zbx.zvm.console.history.v1";
const HISTORY_MAX = 20;

// Strictly validate each entry against the expected shape. A malformed
// payload (older schema, hand-edited storage, partial write) used to brick
// the console tab via `cannot read properties of null` during render —
// here we silently drop bad rows instead.
function isValidHistoryEntry(e: unknown): e is ConsoleHistoryEntry {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.method === "string" &&
    typeof o.params === "string" &&
    typeof o.ok === "boolean" &&
    typeof o.ms === "number" &&
    typeof o.at === "number" &&
    (o.error === null || typeof o.error === "string")
  );
}

function loadHistory(): ConsoleHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidHistoryEntry).slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(items: ConsoleHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    /* ignore quota */
  }
}

function RpcConsole({ seed }: { seed: ConsoleSeed | null }) {
  const [method, setMethod] = useState("zbx_blockNumber");
  const [params, setParams] = useState("[]");
  const [resp, setResp] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [pretty, setPretty] = useState(true);
  const [history, setHistory] = useState<ConsoleHistoryEntry[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Bootstrap history from localStorage on mount.
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // React to seed handoffs from the Method Catalog. We compare on `nonce`
  // (a timestamp) so re-clicking the SAME catalog row still re-fires the
  // effect, which is the intuitive UX.
  useEffect(() => {
    if (!seed) return;
    setMethod(seed.method);
    setParams(seed.params);
    setResp(null);
    setErr(null);
    setLastMs(null);
  }, [seed?.nonce, seed?.method, seed?.params]);

  // Filter the catalog for autocomplete suggestions. We only show when the
  // user is actively editing the method input (and there's at least one char).
  const suggestions = useMemo(() => {
    const q = method.trim().toLowerCase();
    if (!q) return [];
    return RPC_CATALOG
      .filter((e) => e.method.toLowerCase().includes(q) && e.method.toLowerCase() !== q)
      .slice(0, 8);
  }, [method]);

  async function run() {
    setErr(null);
    setResp(null);
    setLoading(true);
    setLastMs(null);
    const start = performance.now();
    let ok = false;
    let result: unknown = null;
    let errorMsg: string | null = null;
    try {
      const p = JSON.parse(params);
      if (!Array.isArray(p)) throw new Error("params must be a JSON array");
      result = await rpc<unknown>(method.trim(), p);
      setResp(result);
      ok = true;
    } catch (e: unknown) {
      errorMsg = e instanceof Error ? e.message : String(e);
      setErr(errorMsg);
    } finally {
      const ms = Math.round(performance.now() - start);
      setLastMs(ms);
      setLoading(false);
      // Push to history (newest first). De-dupe consecutive identical calls
      // by the same {method, params} so a quick double-click doesn't spam
      // the list with two identical rows.
      const entry: ConsoleHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method: method.trim(),
        params,
        ok,
        ms,
        at: Date.now(),
        result,
        error: errorMsg,
      };
      setHistory((prev) => {
        const top = prev[0];
        if (top && top.method === entry.method && top.params === entry.params) {
          // Replace top entry instead of pushing duplicate.
          const next = [entry, ...prev.slice(1)].slice(0, HISTORY_MAX);
          saveHistory(next);
          return next;
        }
        const next = [entry, ...prev].slice(0, HISTORY_MAX);
        saveHistory(next);
        return next;
      });
    }
  }

  function replay(entry: ConsoleHistoryEntry) {
    setMethod(entry.method);
    setParams(entry.params);
    setResp(entry.result);
    setErr(entry.error);
    setLastMs(entry.ms);
  }

  function deleteEntry(id: string) {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    saveHistory([]);
  }

  // Build snippets the user can paste into a shell or browser devtools.
  // The endpoint is intentionally relative ("/api/rpc") — it works in this
  // dashboard's preview pane and is the most-portable starting point.
  //
  // IMPORTANT: parse `params` exactly once inside a single try/catch and
  // fall back to an empty array if invalid. Earlier versions parsed twice
  // (the second outside any guard), which crashed render whenever the user
  // typed intermediate-invalid JSON like `[`.
  const curlSnippet = useMemo(() => {
    let parsedParams: unknown[] = [];
    try {
      const v = JSON.parse(params);
      if (Array.isArray(v)) parsedParams = v;
    } catch { /* keep empty array fallback */ }
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: method.trim(),
      params: parsedParams,
    });
    return `curl -X POST /api/rpc \\\n  -H 'Content-Type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
  }, [method, params]);

  const fetchSnippet = useMemo(() => {
    // The fetch snippet inlines the params text verbatim so the user sees
    // exactly what they typed. We pretty-print only when valid; otherwise
    // we leave the raw text and trust the user to fix it before pasting.
    let pretty = params;
    try {
      const v = JSON.parse(params);
      if (Array.isArray(v)) pretty = JSON.stringify(v, null, 2);
    } catch { /* keep raw text */ }
    return `await fetch("/api/rpc", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    jsonrpc: "2.0",\n    id: 1,\n    method: ${JSON.stringify(method.trim())},\n    params: ${pretty},\n  }),\n}).then(r => r.json());`;
  }, [method, params]);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard not available — ignore */
    }
  }

  const respDisplay = useMemo(() => {
    if (resp === null || resp === undefined) return "";
    if (pretty) return JSON.stringify(resp, null, 2);
    return JSON.stringify(resp);
  }, [resp, pretty]);

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-4">
      {/* Main console column */}
      <div className="space-y-4">
        <ToolCard title="RPC Console" icon={Terminal} accent="orange" wide>
          <div className="space-y-3">
            <div className="grid md:grid-cols-[1fr_1fr_auto] gap-2">
              <div className="relative">
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">
                  method
                </label>
                <input
                  value={method}
                  onChange={(e) => { setMethod(e.target.value); setShowSuggest(true); }}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  placeholder="zbx_blockNumber"
                  className="w-full mt-1 px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-orange-500 outline-none"
                  data-testid="input-console-method"
                />
                {showSuggest && suggestions.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg max-h-56 overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.method}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setMethod(s.method);
                          setParams(s.paramsExample);
                          setShowSuggest(false);
                        }}
                        className="w-full px-3 py-1.5 text-left text-[11px] font-mono hover:bg-orange-500/10 flex items-center justify-between gap-2"
                      >
                        <span className="text-foreground">{s.method}</span>
                        <span className="text-[9px] text-muted-foreground truncate">{s.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">
                  params (JSON array)
                </label>
                <input
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                  placeholder="[]"
                  className="w-full mt-1 px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-orange-500 outline-none"
                  data-testid="input-console-params"
                />
              </div>
              <div className="flex flex-col justify-end">
                <button
                  onClick={run}
                  disabled={loading || !method.trim()}
                  className="px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-400 text-orange-950 text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                  data-testid="button-console-send"
                >
                  <Send className="h-3.5 w-3.5" /> {loading ? "dispatching…" : "Send RPC"}
                </button>
              </div>
            </div>

            {err && <ErrorBox msg={err} />}

            {(resp !== null || lastMs !== null) && (
              <div className="rounded-md border border-border bg-background/40 overflow-hidden">
                <div className="px-3 py-1.5 border-b border-border bg-muted/30 flex items-center gap-2 flex-wrap text-[10px] font-mono">
                  <span className="text-muted-foreground uppercase font-bold">result</span>
                  {lastMs !== null && (
                    <span
                      className={`px-1.5 py-0.5 rounded border ${
                        lastMs < 200
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : lastMs < 800
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                          : "border-red-500/30 bg-red-500/10 text-red-300"
                      }`}
                      data-testid="text-console-latency"
                    >
                      <Clock className="inline h-2.5 w-2.5 mr-0.5" /> {lastMs} ms
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => setPretty((p) => !p)}
                      className="px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 transition"
                    >
                      {pretty ? "raw" : "pretty"}
                    </button>
                    <button
                      onClick={() => copyText("result", respDisplay)}
                      className="px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 transition flex items-center gap-1"
                    >
                      {copied === "result" ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                      copy
                    </button>
                  </div>
                </div>
                <pre className="p-3 text-xs font-mono break-all whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {respDisplay || "—"}
                </pre>
              </div>
            )}

            {/* Snippet panel — exposes the same call as cURL + fetch so the
                user can take their working query out of the playground and
                into a script. */}
            <details className="rounded-md border border-border bg-background/40">
              <summary className="px-3 py-2 cursor-pointer text-[11px] font-semibold flex items-center gap-2">
                <Code2 className="h-3 w-3 text-cyan-400" /> Copy as cURL / fetch
              </summary>
              <div className="p-3 space-y-3 border-t border-border">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">cURL</span>
                    <button
                      onClick={() => copyText("curl", curlSnippet)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 transition flex items-center gap-1"
                    >
                      {copied === "curl" ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                      copy
                    </button>
                  </div>
                  <pre className="p-2 bg-background/60 rounded text-[10px] font-mono whitespace-pre-wrap break-all">
                    {curlSnippet}
                  </pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">JS fetch</span>
                    <button
                      onClick={() => copyText("fetch", fetchSnippet)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 transition flex items-center gap-1"
                    >
                      {copied === "fetch" ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                      copy
                    </button>
                  </div>
                  <pre className="p-2 bg-background/60 rounded text-[10px] font-mono whitespace-pre-wrap break-all">
                    {fetchSnippet}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        </ToolCard>
      </div>

      {/* History sidebar — last N calls, click to replay, X to delete. */}
      <div className="rounded-xl border border-border bg-card overflow-hidden h-fit">
        <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-cyan-400" />
          <h3 className="text-sm font-semibold">History</h3>
          <span className="text-[10px] text-muted-foreground">{history.length}/{HISTORY_MAX}</span>
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 transition flex items-center gap-1"
              data-testid="button-history-clear"
            >
              <Trash2 className="h-2.5 w-2.5" /> clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="p-4 text-[11px] text-muted-foreground text-center">
            No calls yet. Send an RPC to populate history.
          </div>
        ) : (
          <div className="divide-y divide-border/50 max-h-[600px] overflow-y-auto">
            {history.map((e) => (
              <div key={e.id} className="p-2.5 hover:bg-muted/20 transition group" data-testid="history-entry">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${e.ok ? "bg-emerald-400" : "bg-red-400"}`} />
                  <code className="text-[11px] font-mono font-semibold flex-1 truncate">{e.method}</code>
                  <button
                    onClick={() => deleteEntry(e.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition"
                    title="Remove from history"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="text-[9px] font-mono text-muted-foreground truncate mb-1">
                  {e.params}
                </div>
                <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                  <span>{new Date(e.at).toLocaleTimeString()}</span>
                  <span className="flex items-center gap-2">
                    <span className={e.ms < 200 ? "text-emerald-400" : e.ms < 800 ? "text-amber-400" : "text-red-400"}>
                      {e.ms}ms
                    </span>
                    <button
                      onClick={() => replay(e)}
                      className="px-1.5 py-0.5 rounded border border-border hover:border-cyan-500/40 hover:text-cyan-300 transition flex items-center gap-1"
                    >
                      <RotateCw className="h-2.5 w-2.5" /> replay
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Tx Stream — auto-refreshing view of the chain's recent-txs ring buffer
// with kind-filter, live/paused toggle, age countdown, and click-to-inspect
// (jumps the user back to the Search tab seeded with the tx hash).
// ─────────────────────────────────────────────────────────────────────────────
type StreamTx = {
  seq: number; height: number; timestamp_ms: number;
  hash: string; from: string; to: string;
  amount: string; fee: string; nonce: number;
  kind: string; kind_index: number;
};

function TxStreamPanel({ onCrossLink }: { onCrossLink: (v: string) => void }) {
  const [txs, setTxs] = useState<StreamTx[]>([]);
  const [stored, setStored] = useState<number | null>(null);
  const [totalIndexed, setTotalIndexed] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [limit, setLimit] = useState(50);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [err, setErr] = useState<string | null>(null);
  const [lastTickMs, setLastTickMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0); // for the age countdown
  const fetching = useRef(false);

  async function fetchOnce() {
    if (fetching.current) return;
    fetching.current = true;
    const start = performance.now();
    try {
      const r = await rpc<{ returned: number; stored: number; total_indexed: number; max_cap: number; txs: StreamTx[] }>(
        "zbx_recentTxs",
        [Math.max(1, Math.min(limit, 1000))],
      );
      setTxs(Array.isArray(r?.txs) ? r.txs : []);
      setStored(r?.stored ?? null);
      setTotalIndexed(r?.total_indexed ?? null);
      setErr(null);
      setLastTickMs(Math.round(performance.now() - start));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      fetching.current = false;
    }
  }

  // Poll every 3s. When paused, the interval still ticks the age clock so
  // "Xs ago" labels keep counting up — just no network activity.
  useEffect(() => {
    fetchOnce();
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (!paused) fetchOnce();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, limit]);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const t of txs) if (t.kind) set.add(t.kind);
    return ["all", ...Array.from(set).sort()];
  }, [txs]);

  const filtered = useMemo(() => {
    if (kindFilter === "all") return txs;
    return txs.filter((t) => t.kind === kindFilter);
  }, [txs, kindFilter]);

  const ageLabel = (ms: number) => {
    if (!ms) return "—";
    const dt = Date.now() - ms;
    if (dt < 0) return "0s";
    if (dt < 60_000) return `${Math.round(dt / 1000)}s ago`;
    if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`;
    return `${Math.round(dt / 3_600_000)}h ago`;
  };

  // Use `tick` to subscribe — the dependency keeps re-renders cheap.
  void tick;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2 flex-wrap">
          <span className="p-1.5 rounded-md text-emerald-400 bg-emerald-500/10">
            <Radio className={`h-3.5 w-3.5 ${paused ? "" : "animate-pulse"}`} />
          </span>
          <h3 className="text-sm font-semibold">Live Tx Stream</h3>
          <span className="text-[10px] text-muted-foreground">
            zbx_recentTxs · cap 1000 · auto-refresh 3s
          </span>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {lastTickMs !== null && (
              <span className="text-[10px] font-mono text-muted-foreground">
                <Clock className="inline h-2.5 w-2.5 mr-0.5" /> {lastTickMs}ms
              </span>
            )}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-[10px] px-2 py-1 rounded border border-border bg-background"
              data-testid="select-stream-limit"
            >
              {[20, 50, 100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button
              onClick={() => setPaused((p) => !p)}
              className={`text-[10px] px-2 py-1 rounded border transition flex items-center gap-1 ${
                paused
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              }`}
              data-testid="button-stream-toggle"
            >
              {paused ? <><Play className="h-3 w-3" /> resume</> : <><Pause className="h-3 w-3" /> pause</>}
            </button>
            <button
              onClick={() => fetchOnce()}
              className="text-[10px] px-2 py-1 rounded border border-border hover:bg-muted/50 transition flex items-center gap-1"
              data-testid="button-stream-refresh"
            >
              <RotateCw className="h-3 w-3" /> refresh
            </button>
          </div>
        </div>

        <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap text-[11px]">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Kind:</span>
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                kindFilter === k
                  ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-200"
                  : "border-border hover:border-cyan-500/30"
              }`}
            >
              {k}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {filtered.length} shown · {stored ?? "—"} stored · {totalIndexed?.toLocaleString() ?? "—"} total
          </span>
        </div>

        {err && (
          <div className="p-3">
            <ErrorBox msg={err} />
          </div>
        )}

        {filtered.length === 0 && !err && (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {paused ? "Stream paused. Click resume to continue." : "Waiting for transactions…"}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="divide-y divide-border/50 max-h-[640px] overflow-y-auto">
            {filtered.map((t) => (
              <div key={`${t.hash}-${t.seq}`} className="p-2.5 grid md:grid-cols-[auto_1fr_1fr_auto_auto] gap-2 items-center text-[11px] hover:bg-muted/20 transition">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border border-violet-500/40 bg-violet-500/10 text-violet-300 uppercase">
                    {t.kind}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">#{t.height}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] uppercase text-muted-foreground">from</div>
                  <code className="font-mono truncate block text-[10px]">{t.from || "—"}</code>
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] uppercase text-muted-foreground">to</div>
                  <code className="font-mono truncate block text-[10px]">{t.to || "—"}</code>
                </div>
                <div className="text-right">
                  <div className="text-[9px] uppercase text-muted-foreground">amount</div>
                  <div className="font-mono font-semibold">{fmtAmountWei(t.amount)}</div>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="text-[9px] text-muted-foreground" title={new Date(t.timestamp_ms).toISOString()}>
                    {ageLabel(t.timestamp_ms)}
                  </span>
                  <button
                    onClick={() => onCrossLink(t.hash)}
                    title="Inspect tx in Search tab"
                    className="px-1.5 py-0.5 rounded border border-border hover:border-cyan-500/40 hover:text-cyan-300 transition flex items-center gap-0.5 text-[10px]"
                    data-testid="button-stream-inspect"
                  >
                    <ArrowUpRight className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Insights — composite read of zbx_chainInfo + zbx_supply +
// zbx_listValidators with refresh + per-section error tolerance. Each section
// fails independently so a flaky validator-listing call doesn't blank out the
// supply card.
// ─────────────────────────────────────────────────────────────────────────────
function NetworkInsightsPanel() {
  const [chainInfo, setChainInfo] = useState<unknown>(null);
  const [supply, setSupply] = useState<unknown>(null);
  const [validators, setValidators] = useState<unknown>(null);
  const [err, setErr] = useState<{ chainInfo?: string; supply?: string; validators?: string }>({});
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    const [ci, sp, vs] = await Promise.all([
      rpc<unknown>("zbx_chainInfo").then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
      rpc<unknown>("zbx_supply").then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
      rpc<unknown>("zbx_listValidators").then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
    ]);
    const nextErr: typeof err = {};
    if (ci.ok) setChainInfo(ci.r); else nextErr.chainInfo = ci.e instanceof Error ? ci.e.message : String(ci.e);
    if (sp.ok) setSupply(sp.r); else nextErr.supply = sp.e instanceof Error ? sp.e.message : String(sp.e);
    if (vs.ok) setValidators(vs.r); else nextErr.validators = vs.e instanceof Error ? vs.e.message : String(vs.e);
    setErr(nextErr);
    setRefreshing(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, []);

  // Validators returns either an array or an object {validators: [...]}.
  // Normalise so the UI just iterates one shape.
  const validatorList = useMemo(() => {
    const v = validators as any;
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.validators)) return v.validators;
    if (v && Array.isArray(v.items)) return v.items;
    return [] as any[];
  }, [validators]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-muted/50 disabled:opacity-50 transition flex items-center gap-1.5"
          data-testid="button-network-refresh"
        >
          <RotateCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "refreshing…" : "refresh"}
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <ToolCard title="Chain Info" icon={Server} accent="violet">
          {err.chainInfo ? <ErrorBox msg={err.chainInfo} /> : (
            <pre className="text-[11px] font-mono break-all whitespace-pre-wrap max-h-80 overflow-y-auto">
              {chainInfo ? JSON.stringify(chainInfo, null, 2) : "—"}
            </pre>
          )}
        </ToolCard>
        <ToolCard title="Supply" icon={Coins} accent="amber">
          {err.supply ? <ErrorBox msg={err.supply} /> : (
            <pre className="text-[11px] font-mono break-all whitespace-pre-wrap max-h-80 overflow-y-auto">
              {supply ? JSON.stringify(supply, null, 2) : "—"}
            </pre>
          )}
        </ToolCard>
      </div>

      <ToolCard title={`Validators (${validatorList.length})`} icon={ShieldCheck} accent="emerald" wide>
        {err.validators ? <ErrorBox msg={err.validators} /> : validatorList.length === 0 ? (
          <p className="text-xs text-muted-foreground">No validators returned by zbx_listValidators.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_1fr_auto] px-2 py-1.5 bg-muted/30 text-[10px] uppercase font-bold text-muted-foreground tracking-wide">
              <span>Address / Pubkey</span>
              <span className="text-right">Stake</span>
              <span className="text-right">Power</span>
              <span className="text-right">Active</span>
            </div>
            <div className="divide-y divide-border/50 max-h-[420px] overflow-y-auto">
              {validatorList.map((v: any, i: number) => {
                const addr = v.address ?? v.pubkey ?? v.id ?? "—";
                const stake = v.stake ?? v.bonded ?? v.amount ?? null;
                const power = v.voting_power ?? v.power ?? null;
                // Validators may surface "is active" as either a boolean
                // (`active`) or a string status (`status === "active"`); fall
                // back to truthy if neither field is present.
                const active = v.active != null
                  ? Boolean(v.active)
                  : v.status != null
                    ? v.status === "active"
                    : true;
                return (
                  <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] px-2 py-1.5 text-[11px] items-center hover:bg-muted/20 transition">
                    <code className="font-mono truncate">{String(addr)}</code>
                    <span className="text-right font-mono">{stake !== null ? fmtAmountWei(String(stake)) : "—"}</span>
                    <span className="text-right font-mono">{power !== null ? String(power) : "—"}</span>
                    <span className={`text-right text-[10px] font-bold ${active ? "text-emerald-400" : "text-muted-foreground"}`}>
                      {active ? "✓" : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ToolCard>
    </div>
  );
}

// Format a wei amount (decimal string) as ZBX with 4 decimals. Tolerates
// hex strings and undefined values gracefully.
function fmtAmountWei(v: string | undefined | null): string {
  if (!v) return "0 ZBX";
  try {
    const big = v.startsWith("0x") ? BigInt(v) : BigInt(v);
    const wei = big;
    const ZBX = 10n ** 18n;
    const whole = wei / ZBX;
    const frac = wei % ZBX;
    if (frac === 0n) return `${whole.toString()} ZBX`;
    const fracStr = (frac + ZBX).toString().slice(1).padStart(18, "0").slice(0, 4);
    return `${whole.toString()}.${fracStr} ZBX`;
  } catch {
    return `${v} wei`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared atoms
// ─────────────────────────────────────────────────────────────────────────────
function ToolCard({ title, icon: Icon, accent, wide, children }: {
  title: string; icon: any; accent: string; wide?: boolean; children: React.ReactNode;
}) {
  const ring: Record<string, string> = {
    emerald: "border-emerald-500/30",
    violet: "border-violet-500/30",
    cyan: "border-cyan-500/30",
    amber: "border-amber-500/30",
    orange: "border-orange-500/30",
  };
  const accentCls: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    violet: "text-violet-400 bg-violet-500/10",
    cyan: "text-cyan-400 bg-cyan-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    orange: "text-orange-400 bg-orange-500/10",
  };
  return (
    <div className={`rounded-xl border ${ring[accent] ?? "border-border"} bg-card overflow-hidden ${wide ? "" : ""}`}>
      <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <span className={`p-1.5 rounded-md ${accentCls[accent] ?? ""}`}><Icon className="h-3.5 w-3.5" /></span>
        <h3 className="text-sm font-semibold font-mono">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Kv({ label, value, mono, highlight, color }: {
  label: string; value: React.ReactNode; mono?: boolean; highlight?: boolean; color?: string;
}) {
  const colorCls: Record<string, string> = {
    emerald: "text-emerald-400",
    violet: "text-violet-400",
    red: "text-red-400",
  };
  const valCls = highlight
    ? `font-bold ${color ? colorCls[color] : "text-primary"}`
    : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-2 text-xs py-0.5 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${valCls} text-right break-all`}>{value}</span>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="p-2 rounded-md border border-red-500/40 bg-red-500/5 text-xs flex items-start gap-2">
      <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
      <code className="text-red-300 break-all">{msg}</code>
    </div>
  );
}

function short(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.length < 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe hex/BigInt parsers — RPC fields can be null/""/"0x" and BigInt() throws
// on those. These return null on failure so JSX can render "—" instead of
// crashing the page.
// ─────────────────────────────────────────────────────────────────────────────
function hexToBigInt(hex: unknown): bigint | null {
  if (hex === null || hex === undefined) return null;
  if (typeof hex !== "string") return null;
  const s = hex.trim();
  if (!s || s === "0x" || s === "0X") return 0n;
  try { return BigInt(s); } catch { return null; }
}
function hexToNum(hex: unknown): number | null {
  const b = hexToBigInt(hex);
  if (b === null) return null;
  // Safe: explorer values fit in Number range easily for chain id / block number
  return Number(b);
}
function fmtBig(hex: unknown, fallback = "—"): string {
  const b = hexToBigInt(hex);
  return b === null ? fallback : b.toString();
}
function fmtZbx(hex: unknown, decimals = 6, fallback = "—"): string {
  const b = hexToBigInt(hex);
  if (b === null) return fallback;
  // Convert wei → ZBX without losing precision
  const denom = 10n ** 18n;
  const whole = b / denom;
  const frac = b % denom;
  if (frac === 0n) return `${whole.toString()}`;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}
function fmtTimestamp(hex: unknown): string {
  const n = hexToNum(hex);
  if (n === null || n <= 0) return "—";
  return new Date(n * 1000).toLocaleString();
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartSearch — unified address / hash / block / contract / Pay-ID lookup
// ─────────────────────────────────────────────────────────────────────────────
type DetectKind =
  | "address"        // 0x + 40 hex
  | "hash"           // 0x + 64 hex (block or tx)
  | "block_number"   // pure decimal or 0x hex (<= 16 chars)
  | "block_tag"      // latest|earliest|pending|finalized|safe
  | "pay_id"         // alphanumeric / @username style
  | "unknown"
  | "empty";

function detectKind(raw: string): DetectKind {
  const s = raw.trim();
  if (!s) return "empty";
  const lower = s.toLowerCase();
  if (["latest", "earliest", "pending", "finalized", "safe"].includes(lower)) return "block_tag";
  if (/^0x[0-9a-f]{40}$/i.test(s)) return "address";
  if (/^0x[0-9a-f]{64}$/i.test(s)) return "hash";
  if (/^\d+$/.test(s)) return "block_number";
  if (/^0x[0-9a-f]{1,16}$/i.test(s)) return "block_number";
  // Pay-ID: starts with @ or 3-32 chars alphanum + dot/underscore/dash
  if (/^@?[a-z0-9][a-z0-9._-]{2,31}$/i.test(s)) return "pay_id";
  return "unknown";
}

function kindMeta(k: DetectKind): { label: string; color: string; icon: any; help: string } {
  switch (k) {
    case "address":      return { label: "ZVM Address",  color: "emerald", icon: Wallet,    help: "20-byte account or contract" };
    case "hash":         return { label: "32-byte Hash", color: "amber",   icon: Hash,      help: "Block or tx hash" };
    case "block_number": return { label: "Block Number", color: "cyan",    icon: Box,       help: "Decimal or 0x-hex height" };
    case "block_tag":    return { label: "Block Tag",    color: "cyan",    icon: Box,       help: "latest / earliest / pending" };
    case "pay_id":       return { label: "Pay-ID",       color: "violet",  icon: AtSign,    help: "Human alias → address" };
    case "empty":        return { label: "—",            color: "muted",   icon: Compass,   help: "Type to search" };
    case "unknown":      return { label: "Unknown",      color: "red",     icon: AlertCircle, help: "Format not recognised" };
  }
}

function SmartSearch({ seed, onSeed }: { seed: string; onSeed: (v: string) => void }) {
  const [query, setQuery] = useState<string>("");
  const [committed, setCommitted] = useState<string>("");
  const [running, setRunning] = useState(false);

  // Allow other components / sample buttons to seed the query.
  useEffect(() => {
    if (seed && seed !== query) {
      setQuery(seed);
      setCommitted(seed);
      onSeed("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const detected = detectKind(query);
  const meta = kindMeta(detected);
  const Icon = meta.icon;
  const canSearch = detected !== "empty" && detected !== "unknown";

  function submit() {
    if (!canSearch) return;
    setRunning(true);
    setCommitted(query.trim());
    // running is just a brief flash; child will manage its own loading
    setTimeout(() => setRunning(false), 250);
  }

  const samples = [
    { label: "Pool admin (address)", value: "0x40907000ac0a1a73e4cd89889b4d7ee8980c0315" },
    { label: "AMM pool (contract addr)", value: "0x7a73776170000000000000000000000000000000" },
    { label: "Block #1", value: "1" },
    { label: "latest", value: "latest" },
  ];

  const accent: Record<string, string> = {
    emerald: "border-emerald-500/40 bg-emerald-500/5 text-emerald-300",
    amber:   "border-amber-500/40 bg-amber-500/5 text-amber-300",
    cyan:    "border-cyan-500/40 bg-cyan-500/5 text-cyan-300",
    violet:  "border-violet-500/40 bg-violet-500/5 text-violet-300",
    red:     "border-red-500/40 bg-red-500/5 text-red-300",
    muted:   "border-border bg-muted/20 text-muted-foreground",
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-background to-violet-500/5 p-4 md:p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Compass className="h-5 w-5 text-primary" />
        <h2 className="text-base font-bold tracking-tight">Smart Search</h2>
        <span className="text-[10px] text-muted-foreground font-mono">address · hash · block · contract · Pay-ID</span>
      </div>
      <div className="text-[10px] text-muted-foreground bg-card/40 border border-border rounded-md px-2.5 py-1.5 leading-relaxed flex items-start gap-1.5">
        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
        <span>
          <span className="font-semibold text-foreground">How lookups work:</span> numeric block lookups use the native <code className="font-mono">zbx_getBlockByNumber</code> path.
          Hash lookups try <code className="font-mono">eth_getBlockByHash</code> /
          <code className="font-mono"> eth_getTransactionByHash</code> first and fall back to the native indexed-tx ring buffer.
        </span>
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="0x… address / 0x… hash / block # / Pay-ID"
            className="w-full pl-9 pr-24 py-2.5 text-sm font-mono rounded-lg bg-background border border-border focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(""); setCommitted(""); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted/50 text-muted-foreground"
              title="clear">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button onClick={submit} disabled={!canSearch || running}
          className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 shrink-0">
          <Search className="h-4 w-4" /> {running ? "searching…" : "Search"}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-muted-foreground">detected:</span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono uppercase tracking-wide ${accent[meta.color]}`}>
          <Icon className="h-3 w-3" /> {meta.label}
        </span>
        <span className="text-muted-foreground">{meta.help}</span>
        <span className="ml-auto text-muted-foreground">samples:</span>
        {samples.map((s) => (
          <button key={s.label} onClick={() => { setQuery(s.value); setCommitted(s.value); }}
            className="px-2 py-0.5 rounded text-[10px] font-mono border border-border hover:bg-primary/10 hover:border-primary/40 transition">
            {s.label}
          </button>
        ))}
      </div>

      {committed && <SmartResult query={committed} kind={detectKind(committed)} onCrossLink={(v) => { setQuery(v); setCommitted(v); }} />}
    </div>
  );
}

function SmartResult({ query, kind, onCrossLink }: { query: string; kind: DetectKind; onCrossLink: (v: string) => void }) {
  if (kind === "address")                              return <AddressResult addr={query.toLowerCase()} onCrossLink={onCrossLink} />;
  if (kind === "block_number" || kind === "block_tag") return <BlockResult tag={query.toLowerCase()} onCrossLink={onCrossLink} />;
  if (kind === "hash")                                 return <HashResult hash={query.toLowerCase()} onCrossLink={onCrossLink} />;
  if (kind === "pay_id")                               return <PayIdResult alias={query.replace(/^@/, "")} onCrossLink={onCrossLink} />;
  if (kind === "unknown")                              return <ErrorBox msg={`Cannot detect type for "${query}". Expected: 0x-address (40 hex), 0x-hash (64 hex), block number, 'latest', or Pay-ID alias.`} />;
  return null;
}

// — Address result ────────────────────────────────────────────────────────────
function AddressResult({ addr, onCrossLink }: { addr: string; onCrossLink: (v: string) => void }) {
  const [data, setData] = useState<{
    balance: string | null; nonce: string | null; code: string | null;
    zusd: string | null; lp: string | null;
    err: string | null; loading: boolean;
  }>({ balance: null, nonce: null, code: null, zusd: null, lp: null, err: null, loading: true });

  useEffect(() => {
    let mounted = true;
    setData({ balance: null, nonce: null, code: null, zusd: null, lp: null, err: null, loading: true });
    (async () => {
      try {
        // All four primary calls use the always-on zbx_* / aliased-zbx
        // namespace: zbx_getBalance is a same-handler alias of eth_getBalance
        // (rpc.rs:141), and zbx_getNonce is the native nonce accessor
        // (rpc.rs:148). eth_getCode requires --features zvm so we wrap
        // with .catch(() => null) and let the UI render "EOA" gracefully
        // when the chain doesn't expose code-checking.
        const [bal, non, c, zu, lp] = await Promise.all([
          rpc<string>("zbx_getBalance", [addr, "latest"]).catch((e) => { throw e; }),
          rpc<unknown>("zbx_getNonce", [addr]).catch(() => 0),
          rpc<string>("eth_getCode", [addr, "latest"]).catch(() => null),
          rpc<any>("zbx_getZusdBalance", [addr]).catch(() => null),
          rpc<any>("zbx_getLpBalance", [addr]).catch(() => null),
        ]);
        if (!mounted) return;
        const nonceNum = parseNonceLocal(non);
        setData({ balance: bal, nonce: String(nonceNum), code: c, zusd: zu, lp, err: null, loading: false });
      } catch (e: any) {
        if (mounted) setData((d) => ({ ...d, err: e?.message ?? String(e), loading: false }));
      }
    })();
    return () => { mounted = false; };
  }, [addr]);

  const isContract = !!data.code && data.code !== "0x" && data.code !== "0x0";
  const codeBytes = data.code && data.code !== "0x" ? (data.code.length - 2) / 2 : 0;
  const zusdAny: any = data.zusd;
  const lpAny: any = data.lp;
  const zusdRaw: string | null = zusdAny ? (typeof zusdAny === "string" ? zusdAny : (zusdAny.balance ?? zusdAny.zusd ?? null)) : null;
  const lpRaw: string | null = lpAny ? (typeof lpAny === "string" ? lpAny : (lpAny.balance ?? lpAny.lp ?? null)) : null;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-emerald-500/5 flex items-center gap-2 flex-wrap">
        <Wallet className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-bold">Account</span>
        {isContract && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-violet-500/40 bg-violet-500/10 text-violet-300">CONTRACT</span>}
        {!data.loading && !isContract && data.code !== null && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">EOA</span>}
        {!data.loading && data.code === null && <span title="eth_getCode unavailable — node likely built without --features zvm" className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-amber-500/40 bg-amber-500/10 text-amber-300">ACCOUNT · code-check off</span>}
        <code className="ml-auto text-[11px] font-mono text-muted-foreground break-all">{addr}</code>
      </div>
      <div className="p-4 space-y-3">
        {data.err && <ErrorBox msg={data.err} />}
        {data.loading && <div className="text-xs text-muted-foreground">loading account…</div>}
        {!data.loading && !data.err && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatTile label="ZBX balance" value={data.balance ? fmtZbx(data.balance, 6, "0") : "—"} accent="emerald" />
              <StatTile label="zUSD balance" value={zusdRaw ? fmtZbx(zusdRaw, 4, "0") : "0"} accent="cyan" />
              <StatTile label="LP balance"   value={lpRaw ? fmtZbx(lpRaw, 6, "0") : "0"} accent="violet" />
              <StatTile label="nonce"        value={data.nonce ? fmtBig(data.nonce, "0") : "0"} accent="amber" />
            </div>
            {isContract && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-muted-foreground">Bytecode · {codeBytes.toLocaleString()} bytes</div>
                <details>
                  <summary className="cursor-pointer text-xs text-violet-300 hover:underline inline-flex items-center gap-1">
                    <Code2 className="h-3 w-3" /> show / hide bytecode
                  </summary>
                  <pre className="mt-1 p-2 bg-background/60 border border-border rounded text-[10px] font-mono break-all whitespace-pre-wrap max-h-48 overflow-y-auto">{data.code}</pre>
                </details>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <button onClick={() => navigator.clipboard.writeText(addr)} className="px-2 py-1 rounded border border-border hover:bg-muted/30 inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> copy address
              </button>
              <button onClick={() => onCrossLink("latest")} className="px-2 py-1 rounded border border-border hover:bg-muted/30 inline-flex items-center gap-1">
                <Box className="h-3 w-3" /> latest block
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// — Block result ──────────────────────────────────────────────────────────────
// Block fetch uses TWO sources because the on-chain `eth_getBlockByNumber`
// currently ignores the height parameter and always returns the tip — only
// tags like `latest` / `earliest` / `pending` work via the ZVM passthrough.
// For numeric heights we fall back to the native `zbx_getBlockByNumber`
// which respects the requested height and returns the canonical block.
function BlockResult({ tag, onCrossLink }: { tag: string; onCrossLink: (v: string) => void }) {
  const [data, setData] = useState<{
    height: number | null;
    display: any | null;        // normalised view-model
    rawSource: "eth" | "zbx" | null;
    blockTxs: any[] | null;     // native txs filtered to this height
    err: string | null;
    loading: boolean;
  }>({ height: null, display: null, rawSource: null, blockTxs: null, err: null, loading: true });

  useEffect(() => {
    let mounted = true;
    setData({ height: null, display: null, rawSource: null, blockTxs: null, err: null, loading: true });
    (async () => {
      try {
        const isNumeric = /^\d+$/.test(tag) || /^0x[0-9a-f]+$/i.test(tag);
        let display: any = null;
        let height: number | null = null;
        let rawSource: "eth" | "zbx" = "eth";

        if (isNumeric) {
          // Native path — respects the requested height.
          const targetHeight = /^\d+$/.test(tag)
            ? parseInt(tag, 10)
            : parseInt(tag.slice(2), 16);
          const native = await rpc<any>("zbx_getBlockByNumber", [targetHeight]).catch(() => null);
          if (!native || !native.header) {
            if (mounted) setData((d) => ({ ...d, err: `Block #${targetHeight} not found`, loading: false }));
            return;
          }
          rawSource = "zbx";
          height = native.header.height;
          display = {
            number: targetHeight,
            timestampDate: native.header.timestamp_ms ? new Date(native.header.timestamp_ms).toLocaleString() : "—",
            proposer: native.header.proposer ?? null,
            parentHash: native.header.parent_hash ?? null,
            txRoot: native.header.tx_root ?? null,
            stateRoot: native.header.state_root ?? null,
            txCount: Array.isArray(native.txs) ? native.txs.length : 0,
            gasUsedDisplay: "—",
            gasLimitDisplay: "—",
            baseFeeDisplay: "—",
            hash: null,
          };
        } else {
          // Block tag (latest/earliest/pending/finalized/safe) — eth handles these.
          const b = await rpc<any>("eth_getBlockByNumber", [tag, false]);
          if (!b) {
            if (mounted) setData((d) => ({ ...d, err: `Block "${tag}" returned null`, loading: false }));
            return;
          }
          rawSource = "eth";
          height = Number(hexToBigInt(b.number) ?? 0n);
          display = {
            number: height,
            timestampDate: fmtTimestamp(b.timestamp),
            proposer: b.miner ?? null,
            parentHash: b.parentHash ?? null,
            txRoot: b.transactionsRoot ?? null,
            stateRoot: b.stateRoot ?? null,
            txCount: Array.isArray(b.transactions) ? b.transactions.length : 0,
            gasUsedDisplay: fmtBig(b.gasUsed),
            gasLimitDisplay: fmtBig(b.gasLimit),
            baseFeeDisplay: b.baseFeePerGas ? `${fmtBig(b.baseFeePerGas)} wei` : "—",
            hash: b.hash ?? null,
          };
        }

        // Native tx index for richer per-block browsing (1000-tx cap).
        const recent = await rpc<any>("zbx_recentTxs", [1000]).catch(() => null);
        const blockTxs = recent && Array.isArray(recent.txs) && height !== null
          ? recent.txs.filter((t: any) => Number(t.height) === height)
          : [];

        if (mounted) setData({ height, display, rawSource, blockTxs, err: null, loading: false });
      } catch (e: any) {
        if (mounted) setData((d) => ({ ...d, err: e?.message ?? String(e), loading: false }));
      }
    })();
    return () => { mounted = false; };
  }, [tag]);

  const d = data.display;
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-cyan-500/5 flex items-center gap-2 flex-wrap">
        <Box className="h-4 w-4 text-cyan-400" />
        <span className="text-sm font-bold">Block</span>
        {d && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">#{d.number}</span>}
        {data.rawSource && <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase border border-border bg-muted/30 text-muted-foreground">via {data.rawSource}_*</span>}
        <code className="ml-auto text-[11px] font-mono text-muted-foreground">tag: {tag}</code>
      </div>
      <div className="p-4 space-y-3">
        {data.err && <ErrorBox msg={data.err} />}
        {data.loading && <div className="text-xs text-muted-foreground">loading block…</div>}
        {!data.loading && !d && !data.err && <div className="text-xs text-muted-foreground">block not found</div>}
        {d && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatTile label="number" value={`#${d.number}`} accent="cyan" />
              <StatTile label="timestamp" value={d.timestampDate} accent="muted" />
              <StatTile label="gasUsed / Limit" value={`${d.gasUsedDisplay} / ${d.gasLimitDisplay}`} accent="amber" />
              <StatTile label="baseFee" value={d.baseFeeDisplay} accent="violet" />
            </div>
            <div className="grid md:grid-cols-2 gap-2 text-xs">
              <Kv label="hash" value={short(d.hash)} mono />
              <Kv label="parentHash" value={short(d.parentHash)} mono />
              <Kv label="proposer / miner" value={
                d.proposer
                  ? <button onClick={() => onCrossLink(d.proposer)} className="text-emerald-300 hover:underline font-mono">{short(d.proposer)}</button>
                  : "—"
              } />
              <Kv label="tx count" value={d.txCount} highlight />
              <Kv label="txRoot" value={short(d.txRoot)} mono />
              <Kv label="stateRoot" value={short(d.stateRoot)} mono />
            </div>
            {data.blockTxs && data.blockTxs.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Native txs at height #{data.height} ({data.blockTxs.length})
                </div>
                <div className="space-y-1">
                  {data.blockTxs.map((t: any) => (
                    <div key={t.hash} className="p-2 rounded bg-background/40 border border-border/50 text-[11px] font-mono flex items-center gap-2 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[9px] uppercase">{t.kind ?? "?"}</span>
                      <button onClick={() => onCrossLink(t.hash)} className="text-cyan-300 hover:underline truncate max-w-[180px]" title={t.hash}>{short(t.hash)}</button>
                      <span className="text-muted-foreground">from</span>
                      <button onClick={() => onCrossLink(t.from)} className="text-emerald-300 hover:underline">{short(t.from)}</button>
                      <span className="text-muted-foreground">→</span>
                      <button onClick={() => onCrossLink(t.to)} className="text-emerald-300 hover:underline">{short(t.to)}</button>
                      <span className="ml-auto text-muted-foreground">fee {fmtZbx(t.fee, 6, "0")} ZBX</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// — Hash result (block hash OR tx hash) ───────────────────────────────────────
// Strategy:
//   1. Try `eth_getBlockByHash` — if a block comes back, route via BlockResult
//   2. Try `eth_getTransactionByHash` + receipt — render tx if either resolves
//   3. Fallback: scan `zbx_recentTxs` (1000-cap ring buffer) for the hash
//      and render the native indexed record. The chain currently does not
//      wire `eth_getTransactionByHash` / `eth_getBlockByHash` so this scan
//      is the practical lookup until Phase C.3.
const isHexAddress = (s: unknown): s is string =>
  typeof s === "string" && /^0x[0-9a-f]{40}$/i.test(s);

function HashResult({ hash, onCrossLink }: { hash: string; onCrossLink: (v: string) => void }) {
  const [data, setData] = useState<{
    tx: any | null;
    blockTag: string | null;
    err: string | null;
    loading: boolean;
    scanned: number;
  }>({ tx: null, blockTag: null, err: null, loading: true, scanned: 0 });

  useEffect(() => {
    let mounted = true;
    setData({ tx: null, blockTag: null, err: null, loading: true, scanned: 0 });
    (async () => {
      try {
        // 1) Block-hash lookup
        const block = await rpc<any>("eth_getBlockByHash", [hash, false]).catch(() => null);
        if (block && block.number) {
          const heightHex = block.number as string;
          const heightDec = Number(hexToBigInt(heightHex) ?? 0n);
          if (mounted) setData({ tx: null, blockTag: String(heightDec), err: null, loading: false, scanned: 0 });
          return;
        }
        // 2) Native eth_* tx lookup
        const [ethTx, ethRcpt] = await Promise.all([
          rpc<any>("eth_getTransactionByHash", [hash]).catch(() => null),
          rpc<any>("eth_getTransactionReceipt", [hash]).catch(() => null),
        ]);
        if (ethTx || ethRcpt) {
          if (mounted) setData({ tx: { ...(ethTx ?? {}), receipt: ethRcpt, source: "eth_*" }, blockTag: null, err: null, loading: false, scanned: 0 });
          return;
        }
        // 3) Native indexed-tx fallback
        const r = await rpc<any>("zbx_recentTxs", [1000]).catch(() => null);
        const list = r && Array.isArray(r.txs) ? r.txs : [];
        const found = list.find((t: any) => (t.hash ?? "").toLowerCase() === hash);
        if (mounted) {
          if (found) setData({ tx: { ...found, source: "zbx_recentTxs" }, blockTag: null, err: null, loading: false, scanned: list.length });
          else setData({
            tx: null, blockTag: null, scanned: list.length, loading: false,
            err: `Hash not found in the recent tx window (${list.length} scanned). Try a block number, an address, or a more recent transaction hash.`,
          });
        }
      } catch (e: any) {
        if (mounted) setData((d) => ({ ...d, err: e?.message ?? String(e), loading: false }));
      }
    })();
    return () => { mounted = false; };
  }, [hash]);

  // If lookup resolved as a block hash, hand off to BlockResult
  if (data.blockTag) return <BlockResult tag={data.blockTag} onCrossLink={onCrossLink} />;

  const tx = data.tx;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-amber-500/5 flex items-center gap-2 flex-wrap">
        <Hash className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-bold">Hash</span>
        {tx && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-amber-500/40 bg-amber-500/10 text-amber-300">TX FOUND</span>}
        <code className="ml-auto text-[11px] font-mono text-muted-foreground break-all">{short(hash)}</code>
      </div>
      <div className="p-4 space-y-3">
        {data.loading && <div className="text-xs text-muted-foreground">searching block + tx + native index…</div>}
        {data.err && <ErrorBox msg={data.err} />}
        {tx && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatTile label="block height" value={tx.height ? `#${tx.height}` : (tx.blockNumber ? `#${fmtBig(tx.blockNumber)}` : "pending")} accent="cyan" />
              <StatTile label="kind" value={tx.kind ?? tx.type ?? "—"} accent="amber" />
              <StatTile label="value (ZBX)" value={tx.amount ? fmtZbx(tx.amount, 6, "0") : (tx.value ? fmtZbx(tx.value, 6, "0") : "0")} accent="emerald" />
              <StatTile label="fee (ZBX)" value={tx.fee ? fmtZbx(tx.fee, 6, "0") : "—"} accent="violet" />
            </div>
            <div className="grid md:grid-cols-2 gap-2 text-xs">
              <Kv label="from" value={
                isHexAddress(tx.from)
                  ? <button onClick={() => onCrossLink(tx.from)} className="text-emerald-300 hover:underline font-mono">{short(tx.from)}</button>
                  : <span className="text-muted-foreground">—</span>
              } />
              <Kv label="to" value={
                isHexAddress(tx.to)
                  ? <button onClick={() => onCrossLink(tx.to)} className="text-emerald-300 hover:underline font-mono">{short(tx.to)}</button>
                  : <span className="text-muted-foreground italic">{tx.to ? "—" : "contract create"}</span>
              } />
              <Kv label="nonce" value={tx.nonce ?? "—"} mono />
              <Kv label="timestamp" value={tx.timestamp_ms ? new Date(tx.timestamp_ms).toLocaleString() : "—"} />
            </div>
            {tx.height !== undefined && (
              <button onClick={() => onCrossLink(String(tx.height))}
                className="text-xs px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 inline-flex items-center gap-1.5">
                <Box className="h-3 w-3" /> View block #{tx.height}
              </button>
            )}
            <div className="text-[10px] text-muted-foreground font-mono">source: {tx.source ?? "?"}</div>
          </>
        )}
      </div>
    </div>
  );
}

// — Pay-ID result ─────────────────────────────────────────────────────────────
function PayIdResult({ alias, onCrossLink }: { alias: string; onCrossLink: (v: string) => void }) {
  const [data, setData] = useState<{ result: any | null; err: string | null; loading: boolean; }>(
    { result: null, err: null, loading: true }
  );

  useEffect(() => {
    let mounted = true;
    setData({ result: null, err: null, loading: true });
    (async () => {
      try {
        const r = await rpc<any>("zbx_lookupPayId", [alias]);
        if (mounted) setData({ result: r, err: null, loading: false });
      } catch (e: any) {
        if (mounted) setData({ result: null, err: e?.message ?? String(e), loading: false });
      }
    })();
    return () => { mounted = false; };
  }, [alias]);

  const r = data.result;
  const linkedAddr: string | null = r?.address ?? r?.owner ?? null;
  return (
    <div className="rounded-xl border border-violet-500/30 bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-violet-500/5 flex items-center gap-2 flex-wrap">
        <AtSign className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-bold">Pay-ID</span>
        <code className="ml-auto text-[11px] font-mono text-muted-foreground">@{alias}</code>
      </div>
      <div className="p-4 space-y-3">
        {data.loading && <div className="text-xs text-muted-foreground">resolving alias…</div>}
        {data.err && <ErrorBox msg={data.err} />}
        {r && !data.err && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <StatTile label="alias" value={`@${alias}`} accent="violet" />
              <StatTile label="address" value={linkedAddr ? short(linkedAddr) : "—"} accent="emerald" />
              <StatTile label="status" value={linkedAddr ? "RESOLVED" : "NOT FOUND"} accent={linkedAddr ? "emerald" : "amber"} />
            </div>
            {linkedAddr && (
              <button onClick={() => onCrossLink(linkedAddr)}
                className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 inline-flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3" /> Open address
              </button>
            )}
            <details>
              <summary className="cursor-pointer text-[10px] text-muted-foreground">raw response</summary>
              <pre className="mt-1 p-2 bg-background/60 border border-border rounded text-[10px] font-mono break-all whitespace-pre-wrap max-h-40 overflow-y-auto">{JSON.stringify(r, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

// — Stat tile (used by all result panels) ─────────────────────────────────────
function StatTile({ label, value, accent }: { label: string; value: React.ReactNode; accent: string }) {
  const ring: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5",
    cyan:    "border-cyan-500/30 bg-cyan-500/5",
    violet:  "border-violet-500/30 bg-violet-500/5",
    amber:   "border-amber-500/30 bg-amber-500/5",
    muted:   "border-border bg-muted/20",
  };
  return (
    <div className={`p-2.5 rounded-lg border ${ring[accent] ?? "border-border"}`}>
      <div className="text-[9px] uppercase font-mono text-muted-foreground tracking-wide truncate">{label}</div>
      <div className="text-sm font-bold tabular-nums mt-1 truncate">{value}</div>
    </div>
  );
}
