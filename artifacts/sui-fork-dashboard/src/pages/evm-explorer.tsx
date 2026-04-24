import React, { useEffect, useState } from "react";
import { rpc } from "@/lib/zbx-rpc";
import {
  Cpu, Search, Send, Box, Hash, Wallet, Code2, Zap, Wifi,
  Check, Copy, AlertCircle, ChevronRight, Layers, Activity, Sparkles,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// EVM Explorer — Phase C.2 native eth_* RPC playground
// ─────────────────────────────────────────────────────────────────────────────
export default function EvmExplorer() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Header />
      <NetStatusGrid />

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
            Native EVM JSON-RPC ka playground. <span className="font-mono text-foreground">eth_*</span>, <span className="font-mono text-foreground">net_*</span> aur <span className="font-mono text-foreground">web3_*</span> methods directly Zebvix L1 par execute hote hain — koi proxy emulation nahi.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Net status grid — eth_chainId, eth_blockNumber, eth_gasPrice, net_version
// ─────────────────────────────────────────────────────────────────────────────
function NetStatusGrid() {
  const [data, setData] = useState<{
    chainId: string | null; blockNumber: string | null; gasPrice: string | null;
    netVersion: string | null; clientVersion: string | null; syncing: any;
  }>({ chainId: null, blockNumber: null, gasPrice: null, netVersion: null, clientVersion: null, syncing: null });

  useEffect(() => {
    let mounted = true;
    async function tick() {
      const [cid, bn, gp, nv, cv, syn] = await Promise.all([
        rpc<string>("eth_chainId").catch(() => null),
        rpc<string>("eth_blockNumber").catch(() => null),
        rpc<string>("eth_gasPrice").catch(() => null),
        rpc<string>("net_version").catch(() => null),
        rpc<string>("web3_clientVersion").catch(() => null),
        rpc<any>("eth_syncing").catch(() => null),
      ]);
      if (mounted) setData({ chainId: cid, blockNumber: bn, gasPrice: gp, netVersion: nv, clientVersion: cv, syncing: syn });
    }
    tick();
    const t = window.setInterval(tick, 4000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const cidNum = hexToNum(data.chainId);
  const bnNum = hexToBigInt(data.blockNumber);
  const gpNum = hexToBigInt(data.gasPrice);
  const cells = [
    { label: "eth_chainId", value: data.chainId, sub: cidNum !== null ? `${cidNum}` : "" },
    { label: "eth_blockNumber", value: data.blockNumber, sub: bnNum !== null ? `#${bnNum.toLocaleString()}` : "" },
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
// Balance Tool — eth_getBalance
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
      const b = await rpc<string>("eth_getBalance", [addr.toLowerCase(), "latest"]);
      setBalance(b);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  return (
    <ToolCard title="eth_getBalance" icon={Wallet} accent="emerald">
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
// Nonce + Code Tool — eth_getTransactionCount + eth_getCode
// ─────────────────────────────────────────────────────────────────────────────
function NonceCodeTool() {
  const [addr, setAddr] = useState("");
  const [nonce, setNonce] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setErr("Invalid address"); return; }
    setLoading(true); setErr(null); setNonce(null); setCode(null);
    try {
      const [n, c] = await Promise.all([
        rpc<string>("eth_getTransactionCount", [addr.toLowerCase(), "latest"]),
        rpc<string>("eth_getCode", [addr.toLowerCase(), "latest"]),
      ]);
      setNonce(n); setCode(c);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  const isContract = code && code !== "0x" && code !== "0x0";
  return (
    <ToolCard title="eth_getTransactionCount + eth_getCode" icon={Code2} accent="violet">
      <div className="space-y-2">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… (account or contract)"
          className="w-full px-3 py-2 text-xs font-mono rounded-md bg-background border border-border focus:border-primary outline-none" />
        <button onClick={lookup} disabled={loading || !addr}
          className="w-full px-3 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 text-violet-950 text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> {loading ? "fetching…" : "Inspect account"}
        </button>
        {err && <ErrorBox msg={err} />}
        {(nonce || code) && (
          <div className="space-y-1 pt-2 text-xs">
            {nonce && <Kv label="nonce" value={`${fmtBig(nonce)} (${nonce})`} mono />}
            {code && (
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

  const presets = [
    { label: "eth_blockNumber", method: "eth_blockNumber", params: "[]" },
    { label: "eth_chainId", method: "eth_chainId", params: "[]" },
    { label: "eth_gasPrice", method: "eth_gasPrice", params: "[]" },
    { label: "net_version", method: "net_version", params: "[]" },
    { label: "web3_clientVersion", method: "web3_clientVersion", params: "[]" },
    { label: "eth_getBalance(0x0)", method: "eth_getBalance", params: '["0x0000000000000000000000000000000000000000","latest"]' },
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
