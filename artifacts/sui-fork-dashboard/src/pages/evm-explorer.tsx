import React, { useEffect, useState } from "react";
import { rpc } from "@/lib/zbx-rpc";
import {
  Cpu, Search, Send, Box, Hash, Wallet, Code2, Zap, Wifi,
  Check, Copy, AlertCircle, ChevronRight, Layers, Activity, Sparkles,
  AtSign, Compass, FileText, ExternalLink, X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// EVM Explorer — Phase C.2 native zbx_* + eth_* RPC playground
// Native zbx_* methods are always available; eth_*/net_*/web3_* only when the
// node binary is built with --features evm. UI prefers zbx_* labels for the
// always-on path and falls back to eth_* labels for EVM-only methods.
// ─────────────────────────────────────────────────────────────────────────────
export default function EvmExplorer() {
  const [seed, setSeed] = useState<string>("");
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Header />
      <SmartSearch seed={seed} onSeed={setSeed} />
      <NetStatusGrid />

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
      <RawDispatcher />
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
              <Wifi className="h-3 w-3" /> EVM ENDPOINT LIVE
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-violet-500/40 bg-violet-500/10 text-violet-300">
              <Cpu className="h-3 w-3" /> Phase C.2 — Cancun
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
              <Hash className="h-3 w-3" /> chain_id 0x1ec6
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-3">
            <Cpu className="h-8 w-8 text-violet-400" /> EVM Explorer
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Native Zebvix RPC playground. <span className="font-mono text-foreground">zbx_*</span> methods (always-on)
            aur <span className="font-mono text-foreground">eth_*</span>/<span className="font-mono text-foreground">net_*</span>/<span className="font-mono text-foreground">web3_*</span> EVM-namespace
            (gated behind <span className="font-mono text-foreground">--features evm</span>) directly Zebvix L1 par execute hote hain — koi proxy emulation nahi.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Net status grid — mix of always-on zbx_* and EVM-gated eth_*/net_*/web3_*
// `zbx_blockNumber` returns an object {height, hex, hash, timestamp_ms,
// proposer} per rpc.rs:125-139, so we read `.height` (number) for display
// and reconstruct a hex view-string. The accept-string branch is defensive
// only (in case a future schema change returns a bare hex string), but the
// canonical response is the object form. Other tiles (gasPrice /
// clientVersion / syncing) require --features evm and gracefully render
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
        rpc<string>("eth_chainId").catch(() => null),
        rpc<any>("zbx_blockNumber").catch(() => null),
        rpc<string>("eth_gasPrice").catch(() => null),
        rpc<string>("net_version").catch(() => null),
        rpc<string>("web3_clientVersion").catch(() => null),
        rpc<any>("eth_syncing").catch(() => null),
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
    { label: "eth_chainId", value: data.chainId, sub: cidNum !== null ? `${cidNum}` : "" },
    { label: "zbx_blockNumber", value: data.blockHex, sub: data.blockNum !== null ? `#${data.blockNum.toLocaleString()}` : "" },
    { label: "eth_gasPrice", value: data.gasPrice, sub: gpNum !== null ? `${gpNum.toString()} wei` : "" },
    { label: "net_version", value: data.netVersion, sub: data.netVersion ? "decimal" : "" },
    { label: "web3_clientVersion", value: data.clientVersion, sub: "" },
    { label: "eth_syncing", value: data.syncing === false ? "false" : data.syncing ? "true" : null, sub: data.syncing === false ? "in sync" : "" },
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
// works on every Zebvix node regardless of --features evm).
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
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… (20-byte EVM address)"
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
// Nonce + Code Tool — zbx_getNonce (always-on) + eth_getCode (EVM-gated)
// `zbx_getNonce` returns u64 number (NOT hex) per rpc.rs:148-153, so we
// accept the raw number and format it. `eth_getCode` only works when the
// node is built with --features evm — we wrap with .catch() so a missing
// EVM feature doesn't blow up the whole inspect (we still show nonce +
// "EOA (EVM disabled)" hint instead of an error toast).
// ─────────────────────────────────────────────────────────────────────────────
function NonceCodeTool() {
  const [addr, setAddr] = useState("");
  const [nonce, setNonce] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [evmDisabled, setEvmDisabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setErr("Invalid address"); return; }
    setLoading(true); setErr(null); setNonce(null); setCode(null); setEvmDisabled(false);
    try {
      const [n, c] = await Promise.all([
        rpc<unknown>("zbx_getNonce", [addr.toLowerCase()]),
        rpc<string>("eth_getCode", [addr.toLowerCase(), "latest"]).catch((e: any) => {
          if (typeof e?.message === "string" && /method not found/i.test(e.message)) {
            return "__EVM_DISABLED__";
          }
          throw e;
        }),
      ]);
      setNonce(parseNonceLocal(n));
      if (c === "__EVM_DISABLED__") { setEvmDisabled(true); setCode(null); }
      else setCode(c);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  const isContract = !!code && code !== "0x" && code !== "0x0";
  return (
    <ToolCard title="zbx_getNonce + eth_getCode" icon={Code2} accent="violet">
      <div className="space-y-2">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… (account or contract)"
          className="w-full px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-primary outline-none" />
        <button onClick={lookup} disabled={loading || !addr}
          className="w-full px-3 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 text-violet-950 text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> {loading ? "fetching…" : "Inspect account"}
        </button>
        {err && <ErrorBox msg={err} />}
        {(nonce !== null || code !== null || evmDisabled) && (
          <div className="space-y-1 pt-2 text-xs">
            {nonce !== null && <Kv label="nonce" value={`${nonce.toLocaleString()}`} mono />}
            {evmDisabled ? (
              <Kv label="account type" value="EOA · code-check unavailable (EVM disabled on this node)" highlight color="amber" />
            ) : code !== null && (
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
// hex string for forward-compat with EVM-bridged nonces. Mirrors the same
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
// Block Tool — eth_getBlockByNumber
// ─────────────────────────────────────────────────────────────────────────────
function BlockTool() {
  const [tag, setTag] = useState("latest");
  const [block, setBlock] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    setLoading(true); setErr(null); setBlock(null);
    try {
      const param = /^\d+$/.test(tag) ? `0x${parseInt(tag, 10).toString(16)}` : tag;
      const b = await rpc<any>("eth_getBlockByNumber", [param, false]);
      setBlock(b);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  return (
    <ToolCard title="eth_getBlockByNumber" icon={Box} accent="cyan">
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
            <Kv label="number" value={`${fmtBig(block.number)} (${block.number ?? "—"})`} mono />
            <Kv label="hash" value={short(block.hash)} mono />
            <Kv label="parent" value={short(block.parentHash)} mono />
            <Kv label="timestamp" value={fmtTimestamp(block.timestamp)} />
            <Kv label="miner" value={short(block.miner)} mono />
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
// Tx Tool — eth_getTransactionByHash + eth_getTransactionReceipt
// ─────────────────────────────────────────────────────────────────────────────
function TxTool() {
  const [hash, setHash] = useState("");
  const [tx, setTx] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) { setErr("Invalid tx hash (need 0x + 64 hex)"); return; }
    setLoading(true); setErr(null); setTx(null); setReceipt(null);
    try {
      const [t, r] = await Promise.all([
        rpc<any>("eth_getTransactionByHash", [hash.toLowerCase()]),
        rpc<any>("eth_getTransactionReceipt", [hash.toLowerCase()]).catch(() => null),
      ]);
      setTx(t); setReceipt(r);
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
        {(tx || receipt) && (
          <div className="grid md:grid-cols-2 gap-3 pt-2 text-xs">
            <div className="p-3 rounded-md border border-border bg-background/40">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2">Transaction</div>
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
              ) : <div className="text-muted-foreground">no receipt yet (pending or not found)</div>}
            </div>
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw RPC Dispatcher — any method
// ─────────────────────────────────────────────────────────────────────────────
function RawDispatcher() {
  const [method, setMethod] = useState("eth_blockNumber");
  const [params, setParams] = useState("[]");
  const [resp, setResp] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setErr(null); setResp(null); setLoading(true);
    try {
      const p = JSON.parse(params);
      if (!Array.isArray(p)) throw new Error("params must be a JSON array");
      const r = await rpc<any>(method.trim(), p);
      setResp(r);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  // Presets are split into two groups: always-on zbx_* native methods (work
  // on every Zebvix node regardless of build flags) and EVM-namespace eth_*/
  // net_*/web3_* methods (only respond when the node is built with
  // --features evm). The zbx_* set is shown first so users hit working
  // examples by default.
  const presets = [
    // ── zbx_* always-on ──────────────────────────────────────────────────
    { label: "zbx_blockNumber", method: "zbx_blockNumber", params: "[]" },
    { label: "zbx_chainInfo", method: "zbx_chainInfo", params: "[]" },
    { label: "zbx_supply", method: "zbx_supply", params: "[]" },
    { label: "zbx_listValidators", method: "zbx_listValidators", params: "[]" },
    { label: "zbx_getNonce(0x0)", method: "zbx_getNonce", params: '["0x0000000000000000000000000000000000000000"]' },
    { label: "zbx_getBalance(0x0)", method: "zbx_getBalance", params: '["0x0000000000000000000000000000000000000000","latest"]' },
    { label: "zbx_getBlockByNumber(0)", method: "zbx_getBlockByNumber", params: "[0]" },
    { label: "zbx_recentTxs(50)", method: "zbx_recentTxs", params: "[50]" },
    // ── eth_*/net_*/web3_* EVM-gated ─────────────────────────────────────
    { label: "eth_chainId", method: "eth_chainId", params: "[]" },
    { label: "net_version", method: "net_version", params: "[]" },
    { label: "eth_blockNumber", method: "eth_blockNumber", params: "[]" },
    { label: "eth_gasPrice", method: "eth_gasPrice", params: "[]" },
    { label: "web3_clientVersion", method: "web3_clientVersion", params: "[]" },
    { label: "eth_getBlockByNumber(latest)", method: "eth_getBlockByNumber", params: '["latest", false]' },
  ];

  return (
    <ToolCard title="Raw JSON-RPC Dispatcher" icon={Zap} accent="orange" wide>
      <div className="space-y-3">
        <div className="flex gap-1 flex-wrap">
          {presets.map((p) => (
            <button key={p.label} onClick={() => { setMethod(p.method); setParams(p.params); }}
              className="px-2 py-1 rounded text-[10px] font-mono border border-border hover:bg-orange-500/10 hover:border-orange-500/40 transition">
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">method</label>
            <input value={method} onChange={(e) => setMethod(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-orange-500 outline-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">params (JSON array)</label>
            <input value={params} onChange={(e) => setParams(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-orange-500 outline-none" />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="w-full px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-400 text-orange-950 text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
          <Send className="h-3.5 w-3.5" /> {loading ? "dispatching…" : "Send RPC"}
        </button>
        {err && <ErrorBox msg={err} />}
        {resp !== null && (
          <div>
            <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">result</div>
            <pre className="p-3 bg-background/60 border border-border rounded-md text-xs font-mono break-all whitespace-pre-wrap max-h-64 overflow-y-auto">{JSON.stringify(resp, null, 2)}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  );
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
    case "address":      return { label: "EVM Address",  color: "emerald", icon: Wallet,    help: "20-byte account or contract" };
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
      <div className="text-[10px] text-amber-300/90 bg-amber-500/5 border border-amber-500/30 rounded-md px-2.5 py-1.5 leading-relaxed flex items-start gap-1.5">
        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Heads-up:</span> numeric block lookups use the native <code className="font-mono">zbx_getBlockByNumber</code> path
          (the EVM passthrough returns tip for any height). Hash lookups try <code className="font-mono">eth_getBlockByHash</code> /
          <code className="font-mono"> eth_getTransactionByHash</code> first and fall back to the native indexed-tx ring buffer
          while the on-chain Phase C.3 wiring is pending.
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
        // (rpc.rs:148). eth_getCode requires --features evm so we wrap
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
        {!data.loading && data.code === null && <span title="eth_getCode unavailable — node likely built without --features evm" className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-amber-500/40 bg-amber-500/10 text-amber-300">ACCOUNT · code-check off</span>}
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
// tags like `latest` / `earliest` / `pending` work via the EVM passthrough.
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
            err: `Hash not found in native tx index (${list.length} indexed). On-chain eth_getBlockByHash / eth_getTransactionByHash are not yet wired in evm_rpc — try a block number, an address, or a recent tx hash.`,
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
