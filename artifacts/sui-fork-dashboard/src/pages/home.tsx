import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { rpc, weiHexToZbx, shortAddr, weiToUsd, fmtUsd } from "@/lib/zbx-rpc";
import {
  Activity, Box, Users, Coins, ArrowLeftRight, Wifi, ShieldCheck, Hash,
  TrendingUp, Layers, Cpu, Sparkles, Search, Wallet, ArrowUpDown, AtSign,
  Shield, Droplets, GitBranch, Rocket, Copy, ExternalLink, Check, Flame,
  Zap, Smartphone, Code2, Network as NetworkIcon, FileCode2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface BlockInfo {
  hash: string; height: number; proposer: string; timestamp_ms: number; tx_count: number;
}
interface PriceInfo { zbx_usd: string; source: string; }
interface SupplyInfo {
  height: number; minted_wei: string; max_wei: string;
  burned_wei?: string; premine_wei?: string;
  pool_seed_wei?: string; circulating_wei?: string;
}
interface ValidatorInfo {
  validators?: Array<{ address: string; voting_power: number }>;
  total_voting_power?: number; quorum?: number;
}
interface FeeBounds {
  min_fee_wei: string; max_fee_wei: string; recommended_fee_wei: string;
  min_usd?: number; max_usd?: number; source?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission Control (Home)
// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const [tip, setTip] = useState<BlockInfo | null>(null);
  const [recent, setRecent] = useState<BlockInfo[]>([]);
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [supply, setSupply] = useState<SupplyInfo | null>(null);
  const [vals, setVals] = useState<ValidatorInfo | null>(null);
  const [fee, setFee] = useState<FeeBounds | null>(null);
  const [evmChainHex, setEvmChainHex] = useState<string | null>(null);
  const [evmGasPriceHex, setEvmGasPriceHex] = useState<string | null>(null);
  const [msCount, setMsCount] = useState<number | null>(null);
  const [payIdCount, setPayIdCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(false);
  const lastHeightRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    async function tick() {
      try {
        const tipRes = await rpc<BlockInfo>("zbx_blockNumber");
        if (!mounted) return;
        setTip(tipRes); setErr(null);
        if (lastHeightRef.current && tipRes.height > lastHeightRef.current) {
          setFlash(true); setTimeout(() => mounted && setFlash(false), 800);
        }
        lastHeightRef.current = tipRes.height;

        // Recent 8 blocks (parallel)
        const heights: number[] = [];
        for (let i = 0; i < 8; i++) if (tipRes.height - i >= 0) heights.push(tipRes.height - i);
        const blocks = await Promise.all(heights.map(async (h) => {
          try {
            const r = await rpc<any>("zbx_getBlockByNumber", [h]);
            if (!r) return null;
            const hdr = r.header ?? r;
            return {
              hash: r.hash ?? hdr.hash ?? `h${h}`,
              height: hdr.height ?? h,
              proposer: hdr.proposer ?? "",
              timestamp_ms: hdr.timestamp_ms ?? 0,
              tx_count: Array.isArray(r.txs) ? r.txs.length : 0,
            } as BlockInfo;
          } catch { return null; }
        }));
        if (mounted) setRecent(blocks.filter((b): b is BlockInfo => !!b));

        // Secondary parallel fetch
        Promise.all([
          rpc<PriceInfo>("zbx_getPriceUSD").catch(() => null),
          rpc<SupplyInfo>("zbx_supply").catch(() => null),
          rpc<ValidatorInfo>("zbx_listValidators").catch(() => null),
          rpc<FeeBounds>("zbx_feeBounds").catch(() => null),
          rpc<{ total: number }>("zbx_multisigCount").catch(() => null),
          rpc<{ total: number }>("zbx_payIdCount").catch(() => null),
          rpc<string>("eth_chainId").catch(() => null),
          rpc<string>("eth_gasPrice").catch(() => null),
        ]).then(([pr, sup, va, fb, ms, pid, ec, eg]) => {
          if (!mounted) return;
          if (pr) setPrice(pr);
          if (sup) setSupply(sup);
          if (va) setVals(va);
          if (fb) setFee(fb);
          if (ms) setMsCount(ms.total);
          if (pid) setPayIdCount(pid.total);
          if (ec) setEvmChainHex(ec);
          if (eg) setEvmGasPriceHex(eg);
        });
      } catch (e) {
        if (mounted) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    tick();
    timer = window.setInterval(tick, 5000);
    return () => { mounted = false; if (timer) clearInterval(timer); };
  }, []);

  const priceNum = price ? parseFloat(price.zbx_usd) : 0;
  const circulating = supply?.circulating_wei ?? "0";
  const marketCap = priceNum && supply ? weiToUsd(circulating, priceNum) : 0;
  const fdvCap = priceNum && supply ? weiToUsd(supply.max_wei, priceNum) : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Hero tip={tip} flash={flash} err={err} loading={loading} price={price}
        validatorCount={vals?.validators?.length ?? 0}
        evmChainHex={evmChainHex} />

      {err && (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/5 text-sm flex gap-2 backdrop-blur">
          <Wifi className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-red-500 mb-1">VPS RPC unreachable</div>
            <code className="text-xs text-muted-foreground break-all">{err}</code>
            <div className="text-xs text-muted-foreground mt-1">
              Node should be reachable at <span className="font-mono">93.127.213.192:8545</span>. Service: <span className="font-mono">zebvix.service</span>
            </div>
          </div>
        </div>
      )}

      {/* PHASE STATUS BANNER */}
      <PhaseBanner />

      {/* KPI ROW */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Box} tone="cyan" label="Block Height"
          value={tip ? `#${tip.height.toLocaleString()}` : "—"}
          sub={tip ? `proposer ${shortAddr(tip.proposer, 4, 4)}` : "loading"} flash={flash} />
        <Kpi icon={TrendingUp} tone="emerald" label="ZBX Price"
          value={price ? `$${formatPrice(parseFloat(price.zbx_usd))}` : "—"}
          sub={price?.source ?? ""} />
        <Kpi icon={Coins} tone="violet" label="Market Cap"
          value={marketCap ? fmtUsd(marketCap) : "—"}
          sub={supply ? `circ ${weiHexToZbx(circulating)} ZBX` : ""} />
        <Kpi icon={Layers} tone="amber" label="FDV"
          value={fdvCap ? fmtUsd(fdvCap) : "—"}
          sub={supply ? `max ${weiHexToZbx(supply.max_wei)}` : ""} />
      </div>

      {/* SECONDARY KPIS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MiniKpi icon={Users} label="Validators" value={vals?.validators?.length ?? "—"}
          sub={vals?.quorum ? `quorum ${vals.quorum}` : ""} />
        <MiniKpi icon={Shield} label="Multisigs" value={msCount ?? "—"} />
        <MiniKpi icon={AtSign} label="Pay-IDs" value={payIdCount ?? "—"} />
        <MiniKpi icon={Flame} label="Gas (rec.)"
          value={fee ? `${weiHexToZbx(fee.recommended_fee_wei)} ZBX` : "—"}
          sub={fee?.source ?? ""} />
        <MiniKpi icon={Cpu} label="EVM gasPrice"
          value={evmGasPriceHex ? `${weiHexToZbx(evmGasPriceHex)} ZBX` : "—"}
          sub={evmChainHex ? `chain ${evmChainHex}` : ""} />
      </div>

      {/* RECENT BLOCKS RIBBON */}
      <RecentBlocksRibbon recent={recent} />

      {/* QUICK ACCESS GRID */}
      <QuickAccessGrid />

      {/* CHAIN IDENTITY + CONNECT */}
      <div className="grid lg:grid-cols-2 gap-4">
        <ChainIdentityCard />
        <MetaMaskConnectCard />
      </div>

      {/* DEV INTEGRATION SNIPPETS */}
      <DevIntegrationSection />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────────────
function Hero({ tip, flash, err, loading, price, validatorCount, evmChainHex }: {
  tip: BlockInfo | null; flash: boolean; err: string | null; loading: boolean;
  price: PriceInfo | null; validatorCount: number; evmChainHex: string | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-violet-500/5 to-cyan-500/10 p-6">
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{
        background: "radial-gradient(circle at 80% 20%, rgba(124,58,237,.18), transparent 50%), radial-gradient(circle at 10% 90%, rgba(34,211,238,.12), transparent 50%)",
      }} />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="emerald" pulse={!err}>
              <Wifi className="h-3 w-3" />{err ? "OFFLINE" : loading ? "CONNECTING" : "MAINNET LIVE"}
            </Badge>
            <Badge tone="violet"><Hash className="h-3 w-3" />chain_id 7878</Badge>
            <Badge tone="cyan"><ShieldCheck className="h-3 w-3" />{validatorCount} validators</Badge>
            <Badge tone="amber"><Cpu className="h-3 w-3" />Phase C.2 EVM</Badge>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground to-foreground/60 flex items-center gap-3">
            <Activity className="h-9 w-9 md:h-10 md:w-10 text-primary" />
            Zebvix Mission Control
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Real-time on-chain telemetry for the Zebvix L1. Native EVM (Cancun) JSON-RPC live at <span className="font-mono text-foreground">93.127.213.192:8545</span> · auto-refresh 5s.
          </p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Link href="/live-chain">
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Open Live Chain
              </button>
            </Link>
            <Link href="/evm-explorer">
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted/50 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" /> EVM Explorer
              </button>
            </Link>
            <Link href="/block-explorer">
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted/50 flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" /> Block Explorer
              </button>
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 min-w-[200px]">
          <div className={`text-5xl md:text-6xl font-bold tabular-nums transition-all ${flash ? "text-emerald-400 scale-110" : "text-foreground"}`}>
            {tip ? `#${tip.height.toLocaleString()}` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">current block · {evmChainHex ?? "—"}</div>
          {price && (
            <div className="text-xl font-semibold tabular-nums mt-2">
              ${formatPrice(parseFloat(price.zbx_usd))}<span className="text-xs text-muted-foreground ml-1.5">/ ZBX</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase Banner
// ─────────────────────────────────────────────────────────────────────────────
function PhaseBanner() {
  const phases = [
    { id: "B.10", label: "Native Rust L1", status: "LIVE" },
    { id: "B.11", label: "USD-pegged fees + AMM", status: "LIVE" },
    { id: "B.12", label: "BSC Bridge", status: "LIVE" },
    { id: "C.1", label: "EVM Skeleton", status: "LIVE" },
    { id: "C.2", label: "EVM JSON-RPC", status: "LIVE" },
    { id: "C.3", label: "Foundry Contracts", status: "NEXT" },
  ];
  return (
    <div className="rounded-xl border border-border bg-card/40 backdrop-blur p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Roadmap Status</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {phases.map((p) => (
          <div key={p.id} className={`p-2.5 rounded-lg border text-center ${
            p.status === "LIVE"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-border bg-muted/20"
          }`}>
            <div className="text-[10px] text-muted-foreground font-mono">{p.id}</div>
            <div className="text-xs font-semibold mt-0.5">{p.label}</div>
            <div className={`text-[10px] mt-1 font-bold ${
              p.status === "LIVE" ? "text-emerald-400" : "text-amber-400"
            }`}>{p.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI components
// ─────────────────────────────────────────────────────────────────────────────
function Kpi({ icon: Icon, tone, label, value, sub, flash }: {
  icon: any; tone: string; label: string; value: React.ReactNode; sub?: string; flash?: boolean;
}) {
  const toneCls: Record<string, string> = {
    cyan: "text-cyan-400 bg-cyan-500/10",
    emerald: "text-emerald-400 bg-emerald-500/10",
    violet: "text-violet-400 bg-violet-500/10",
    amber: "text-amber-400 bg-amber-500/10",
  };
  return (
    <div className={`p-4 rounded-xl border border-border bg-card transition-all ${flash ? "ring-2 ring-emerald-500/40 scale-[1.02]" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className={`p-1.5 rounded-lg ${toneCls[tone] ?? ""}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <div className="text-xl md:text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground truncate mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniKpi({ icon: Icon, label, value, sub }: {
  icon: any; label: string; value: React.ReactNode; sub?: string;
}) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card/60">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-sm font-bold tabular-nums mt-1 truncate">{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground truncate mt-0.5">{sub}</div>}
    </div>
  );
}

function Badge({ tone, children, pulse }: { tone: string; children: React.ReactNode; pulse?: boolean }) {
  const toneCls: Record<string, string> = {
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    violet: "border-violet-500/40 bg-violet-500/10 text-violet-300",
    cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${toneCls[tone] ?? ""} ${pulse ? "animate-pulse" : ""}`}>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent Blocks Ribbon
// ─────────────────────────────────────────────────────────────────────────────
function RecentBlocksRibbon({ recent }: { recent: BlockInfo[] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Box className="h-4 w-4 text-primary" /> Recent Blocks (last {recent.length})
        </h3>
        <Link href="/block-explorer">
          <span className="text-[10px] text-primary hover:underline cursor-pointer flex items-center gap-1">
            full explorer <ExternalLink className="h-3 w-3" />
          </span>
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-1 p-2">
        {recent.length === 0 && (
          <div className="col-span-full p-4 text-center text-xs text-muted-foreground">loading blocks…</div>
        )}
        {recent.map((b) => (
          <div key={b.hash} className="p-2 rounded-md border border-border bg-card/60 hover:bg-muted/30 transition cursor-default">
            <div className="text-[10px] text-muted-foreground font-mono">#{b.height}</div>
            <div className="text-xs font-semibold tabular-nums mt-0.5">{b.tx_count} txs</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">{ageStr(b.timestamp_ms)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Access Grid
// ─────────────────────────────────────────────────────────────────────────────
function QuickAccessGrid() {
  const items = [
    { href: "/live-chain", icon: Activity, title: "Live Chain", desc: "Real-time telemetry, blocks, validators, economy", tone: "emerald" },
    { href: "/evm-explorer", icon: Cpu, title: "EVM Explorer", desc: "Phase C.2 native eth_* RPC playground", tone: "violet" },
    { href: "/block-explorer", icon: Search, title: "Block Explorer", desc: "Browse blocks, txs, addresses", tone: "cyan" },
    { href: "/wallet", icon: Wallet, title: "ZBX Wallet", desc: "Web wallet — send, receive, sign", tone: "amber" },
    { href: "/swap", icon: ArrowUpDown, title: "Swap", desc: "AMM ZBX/zUSD trading", tone: "emerald" },
    { href: "/staking", icon: TrendingUp, title: "Staking", desc: "Delegate ZBX, earn rewards", tone: "violet" },
    { href: "/bridge", icon: ArrowLeftRight, title: "BSC Bridge", desc: "Phase B.12 — bridge ZBX ↔ BSC", tone: "cyan" },
    { href: "/multisig-explorer", icon: Shield, title: "Multisig", desc: "On-chain m-of-n vault management", tone: "amber" },
    { href: "/payid-resolver", icon: AtSign, title: "Pay-ID", desc: "Human-readable address resolver", tone: "emerald" },
    { href: "/faucet", icon: Droplets, title: "Faucet", desc: "Testnet ZBX dispenser", tone: "violet" },
    { href: "/connect-wallet", icon: Smartphone, title: "Mobile Wallet", desc: "Flutter wallet pairing & QR", tone: "cyan" },
    { href: "/balance-lookup", icon: Search, title: "Balance Check", desc: "Inspect any address state", tone: "amber" },
  ];
  const toneRing: Record<string, string> = {
    emerald: "hover:border-emerald-500/50 hover:bg-emerald-500/5",
    violet: "hover:border-violet-500/50 hover:bg-violet-500/5",
    cyan: "hover:border-cyan-500/50 hover:bg-cyan-500/5",
    amber: "hover:border-amber-500/50 hover:bg-amber-500/5",
  };
  const iconCls: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    violet: "text-violet-400 bg-violet-500/10",
    cyan: "text-cyan-400 bg-cyan-500/10",
    amber: "text-amber-400 bg-amber-500/10",
  };
  return (
    <div>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" /> Chain Services
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((it) => (
          <Link key={it.href} href={it.href}>
            <div className={`p-4 rounded-xl border border-border bg-card cursor-pointer transition-all ${toneRing[it.tone]}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`p-1.5 rounded-lg ${iconCls[it.tone]}`}><it.icon className="h-4 w-4" /></span>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </div>
              <div className="text-sm font-semibold">{it.title}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{it.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain Identity Card
// ─────────────────────────────────────────────────────────────────────────────
function ChainIdentityCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <NetworkIcon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Chain Identity</h3>
      </div>
      <div className="space-y-2.5 text-xs">
        <Row label="Name" value="Zebvix Mainnet" />
        <Row label="Native Token" value="ZBX (18 decimals)" />
        <Row label="Chain ID" value="7878 (0x1ec6)" mono />
        <Row label="RPC HTTP" value="http://93.127.213.192:8545" mono copy />
        <Row label="Consensus" value="Tendermint BFT (Phase B.2)" />
        <Row label="EVM" value="Native (Cancun) — Phase C.2 LIVE" />
        <Row label="VPS" value="srv1266996" mono />
        <Row label="Service" value="zebvix.service" mono />
      </div>
    </div>
  );
}

function Row({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-foreground ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
        {copy && (
          <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="text-muted-foreground hover:text-foreground transition" title="copy">
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MetaMask Connect Card
// ─────────────────────────────────────────────────────────────────────────────
function MetaMaskConnectCard() {
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function addToMetaMask() {
    const eth = (window as any).ethereum;
    if (!eth) {
      setResult("MetaMask not installed in this browser");
      return;
    }
    setAdding(true);
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x1ec6",
          chainName: "Zebvix Mainnet",
          nativeCurrency: { name: "Zebvix", symbol: "ZBX", decimals: 18 },
          rpcUrls: ["http://93.127.213.192:8545"],
          blockExplorerUrls: [window.location.origin],
        }],
      });
      setResult("Added to MetaMask — chain id 7878");
    } catch (e: any) {
      setResult(e?.message ?? "user rejected");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-amber-500/5 to-orange-500/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold">Connect MetaMask</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        Phase C.2 LIVE means MetaMask, Foundry, ethers.js — sab kaam karte hain. Native EVM JSON-RPC bind hai 8545 pe.
      </p>
      <button onClick={addToMetaMask} disabled={adding}
        className="w-full px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-semibold text-sm flex items-center justify-center gap-2 transition disabled:opacity-50">
        {adding ? "Adding…" : <><Zap className="h-4 w-4" /> Add Zebvix to MetaMask</>}
      </button>
      {result && (
        <div className="mt-3 p-2 rounded-md bg-card border border-border text-[10px] font-mono break-all">{result}</div>
      )}
      <div className="mt-3 text-[10px] text-muted-foreground">
        Manual config: chain id <span className="font-mono text-foreground">7878</span>, RPC <span className="font-mono text-foreground">http://93.127.213.192:8545</span>, symbol <span className="font-mono text-foreground">ZBX</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev Integration Section
// ─────────────────────────────────────────────────────────────────────────────
function DevIntegrationSection() {
  const tabs = [
    {
      id: "ethers", label: "ethers.js", icon: Code2,
      code: `import { JsonRpcProvider, formatEther } from "ethers";

const provider = new JsonRpcProvider("http://93.127.213.192:8545");
const block = await provider.getBlockNumber();
const bal   = await provider.getBalance("0xYourAddress");
console.log({ block, bal: formatEther(bal), chainId: 7878 });`,
    },
    {
      id: "foundry", label: "Foundry / cast", icon: FileCode2,
      code: `# Query head block
cast block-number --rpc-url http://93.127.213.192:8545

# Get balance
cast balance 0xYourAddress --rpc-url http://93.127.213.192:8545

# Deploy contract
forge create src/MyToken.sol:MyToken \\
  --rpc-url http://93.127.213.192:8545 \\
  --private-key $PRIVATE_KEY \\
  --chain-id 7878`,
    },
    {
      id: "curl", label: "raw curl", icon: TerminalIcon,
      code: `curl -s http://93.127.213.192:8545 \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# → {"jsonrpc":"2.0","id":1,"result":"0x1ec6"}

curl -s http://93.127.213.192:8545 \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'`,
    },
  ];
  const [active, setActive] = useState(tabs[0].id);
  const [copied, setCopied] = useState(false);
  const cur = tabs.find((t) => t.id === active)!;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" /> Developer Integration — Phase C.2 EVM
        </h3>
        <button onClick={() => { navigator.clipboard.writeText(cur.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          {copied ? <><Check className="h-3 w-3 text-emerald-400" /> copied</> : <><Copy className="h-3 w-3" /> copy</>}
        </button>
      </div>
      <div className="flex gap-1 p-1 border-b border-border bg-card">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
              active === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <pre className="p-4 text-xs overflow-x-auto bg-background/40 font-mono leading-relaxed">{cur.code}</pre>
    </div>
  );
}

function TerminalIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatPrice(p: number): string {
  if (!isFinite(p)) return "0";
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}
function ageStr(ms: number): string {
  if (!ms) return "—";
  const ds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (ds < 60) return `${ds}s ago`;
  if (ds < 3600) return `${Math.floor(ds / 60)}m ago`;
  return `${Math.floor(ds / 3600)}h ago`;
}
