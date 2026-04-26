// Unified ZBX <-> wZBX bridge widget. Single card, both directions.
// Uses the in-browser Zebvix wallet (same secp256k1 key works on Zebvix L1
// and BSC because both use ETH-standard address derivation), so no
// MetaMask is required for either leg.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link as WLink } from "wouter";
import {
  ArrowDown,
  Wallet as WalletIcon,
  ArrowLeftRight,
  Loader2,
  Flame,
  Lock,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Copy,
  RefreshCw,
  Activity,
  ShieldCheck,
  Network,
  Clock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/contexts/wallet-context";
import {
  bscErc20Allowance,
  bscErc20Balance,
  bscNativeBalance,
  approveWzbxInBrowser,
  burnToZebvixInBrowser,
  fmtUnits18,
  parseUnits18,
  type BscBridgeConfig,
  type RelayerStatus,
} from "@/lib/bsc-bridge";
import {
  recentBridgeOutEvents,
  sendBridgeOut,
  type BridgeOutEvent,
} from "@/lib/bridge";
import { rpc, weiHexToZbx } from "@/lib/zbx-rpc";

const API_BASE = "/api";
const ZBX_DECIMALS = 18;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return (await r.json()) as T;
}

function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a || a.length <= head + tail + 2) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

function fmtAge(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function CopyBtn({ value, label = "Copy" }: { value: string; label?: string }) {
  const { toast } = useToast();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        toast({ title: label });
      }}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title={label}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

type Direction = "z2bsc" | "bsc2z";

// ────────────────────────────────────────────────────────────────────────────
// Header status — relayer + RPC heads
// ────────────────────────────────────────────────────────────────────────────

function HealthRow({
  cfg,
  relayer,
  zHead,
  bscHead,
}: {
  cfg: BscBridgeConfig | undefined;
  relayer: RelayerStatus | undefined;
  zHead: number | null;
  bscHead: number | null;
}) {
  const relayerOk = relayer?.ok === true;
  const validatorOk = (relayer?.bsc?.threshold ?? 0) > 0;
  const sigCount = relayer?.signers?.count ?? 0;
  const threshold = relayer?.bsc?.threshold ?? 1;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
      <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Zebvix L1 head
        </div>
        <div className="font-mono text-sm tabular-nums text-foreground">
          {zHead === null ? "—" : `#${zHead.toLocaleString()}`}
        </div>
      </div>
      <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          BSC head
        </div>
        <div className="font-mono text-sm tabular-nums text-foreground">
          {bscHead === null ? "—" : `#${bscHead.toLocaleString()}`}
        </div>
      </div>
      <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Relayer
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${
              relayerOk
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                : relayer?.configured
                  ? "bg-rose-400"
                  : "bg-muted-foreground/40"
            }`}
          />
          <span className={relayerOk ? "text-emerald-400" : "text-muted-foreground"}>
            {relayerOk ? "online" : relayer?.configured ? "offline" : "n/a"}
          </span>
        </div>
      </div>
      <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Validators
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${
              validatorOk
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                : "bg-muted-foreground/40"
            }`}
          />
          <span className="font-mono tabular-nums">
            {sigCount}/{threshold}
          </span>
          {cfg?.bsc_chain_id && (
            <span className="text-muted-foreground text-[11px]">
              · M-of-N
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Chain pill — clickable card representing one side of the bridge
// ────────────────────────────────────────────────────────────────────────────

function ChainPill({
  side,
  chainName,
  chainAccent,
  asset,
  balance,
  loading,
  badge,
}: {
  side: "from" | "to";
  chainName: string;
  chainAccent: string;
  asset: string;
  balance: string | null;
  loading: boolean;
  badge?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {side === "from" ? "From" : "To"}
        </div>
        {badge && (
          <Badge variant="outline" className="text-[10px] py-0 px-1.5">
            {badge}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center ${chainAccent}`}
        >
          <Network className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-foreground truncate">{chainName}</div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {asset}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Balance
          </div>
          <div className="font-mono tabular-nums text-sm">
            {loading ? "…" : (balance ?? "—")}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Activity row — one historical bridge op
// ────────────────────────────────────────────────────────────────────────────

interface ActivityItem {
  kind: "z2bsc" | "approve" | "burn";
  hash: string;
  amountWei: bigint;
  timestamp: number;
  link: string;
  destExplorerLink?: string;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const label =
    item.kind === "z2bsc"
      ? "ZBX → wZBX"
      : item.kind === "approve"
        ? "Approve wZBX"
        : "wZBX → ZBX";
  const Icon = item.kind === "approve" ? Lock : item.kind === "burn" ? Flame : ArrowLeftRight;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/30 transition-colors group">
      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-muted-foreground font-mono hover:text-primary inline-flex items-center gap-1 truncate"
        >
          {shortAddr(item.hash, 8, 6)}
          <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono tabular-nums text-sm font-semibold text-foreground">
          {fmtUnits18(item.amountWei, 4)}
        </div>
        <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {fmtAge(item.timestamp)}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main widget
// ────────────────────────────────────────────────────────────────────────────

export default function UnifiedBridge() {
  const { toast } = useToast();
  const { active: activeWallet, isRemote } = useWallet();
  const browserAddr = activeWallet?.address.toLowerCase() ?? null;
  // Mobile-paired wallets expose an address but no signing key — bridge
  // operations require either a local key or MetaMask.
  const browserKey =
    activeWallet && activeWallet.kind !== "remote"
      ? activeWallet.privateKey || null
      : null;

  const [direction, setDirection] = useState<Direction>("z2bsc");
  const [amountStr, setAmountStr] = useState("");
  const [destAddr, setDestAddr] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "submit">(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{
    hash: string;
    direction: Direction;
    kind: "approve" | "submit";
    amountWei: bigint;
    submittedAt: number;
  } | null>(null);

  // Config
  const cfgQ = useQuery({
    queryKey: ["bridge", "bsc-config"],
    queryFn: () => fetchJson<BscBridgeConfig>(`${API_BASE}/bridge/bsc-config`),
    staleTime: 60_000,
  });
  const relayerQ = useQuery({
    queryKey: ["bridge", "relayer-status"],
    queryFn: () => fetchJson<RelayerStatus>(`${API_BASE}/bridge/relayer-status`),
    refetchInterval: 10_000,
  });
  const cfg = cfgQ.data;
  const cfgReady = !!(cfg?.wzbx_address && cfg?.bridge_address);

  // ── Live balances / chain heads ────────────────────────────────────────
  const zHeadQ = useQuery({
    queryKey: ["zbx-block-number"],
    queryFn: async () => {
      const hex = await rpc<string>("eth_blockNumber", []);
      return parseInt(hex, 16);
    },
    refetchInterval: 6_000,
  });
  const bscHeadQ = useQuery({
    queryKey: ["bsc-block-number", cfg?.bsc_rpc_url ?? ""],
    queryFn: async () => {
      if (!cfg?.bsc_rpc_url) return null;
      const r = await fetch(cfg.bsc_rpc_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
      });
      const j = (await r.json()) as { result?: string };
      return j.result ? parseInt(j.result, 16) : null;
    },
    enabled: !!cfg?.bsc_rpc_url,
    refetchInterval: 6_000,
  });

  const zbxBalQ = useQuery({
    queryKey: ["zbx-balance", browserAddr ?? ""],
    queryFn: async () => {
      if (!browserAddr) return null;
      const hex = await rpc<string>("zbx_getBalance", [browserAddr]);
      return weiHexToZbx(hex);
    },
    enabled: !!browserAddr,
    refetchInterval: 8_000,
  });

  const wzbxBalQ = useQuery({
    queryKey: ["wzbx-balance", cfg?.wzbx_address ?? "", browserAddr ?? ""],
    queryFn: async () => {
      if (!cfg?.wzbx_address || !browserAddr) return null;
      return bscErc20Balance(cfg.bsc_rpc_url, cfg.wzbx_address, browserAddr);
    },
    enabled: !!(cfg?.wzbx_address && browserAddr),
    refetchInterval: 10_000,
  });

  const bnbBalQ = useQuery({
    queryKey: ["bnb-balance", browserAddr ?? ""],
    queryFn: async () => {
      if (!cfg?.bsc_rpc_url || !browserAddr) return null;
      return bscNativeBalance(cfg.bsc_rpc_url, browserAddr);
    },
    enabled: !!(cfg?.bsc_rpc_url && browserAddr),
    refetchInterval: 10_000,
  });

  const allowanceQ = useQuery({
    queryKey: [
      "wzbx-allowance",
      cfg?.wzbx_address ?? "",
      cfg?.bridge_address ?? "",
      browserAddr ?? "",
    ],
    queryFn: async () => {
      if (!cfg?.wzbx_address || !cfg?.bridge_address || !browserAddr) return null;
      return bscErc20Allowance(
        cfg.bsc_rpc_url,
        cfg.wzbx_address,
        browserAddr,
        cfg.bridge_address,
      );
    },
    enabled: !!(cfg?.wzbx_address && cfg?.bridge_address && browserAddr),
    refetchInterval: 10_000,
  });

  // ── Recent Z->BSC events for the active wallet (local activity feed) ──
  const recentZEventsQ = useQuery({
    queryKey: ["bridge-out-events"],
    queryFn: () => recentBridgeOutEvents(50),
    refetchInterval: 12_000,
  });

  // ── Form derived ───────────────────────────────────────────────────────
  const amountWei = useMemo(() => {
    if (!amountStr.trim()) return 0n;
    try {
      return parseUnits18(amountStr);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const sourceBal = direction === "z2bsc" ? zbxBalQ.data : wzbxBalQ.data;
  const sourceBalWei: bigint | null = useMemo(() => {
    if (sourceBal === null || sourceBal === undefined) return null;
    if (direction === "z2bsc") {
      try {
        return parseUnits18(String(sourceBal));
      } catch {
        return null;
      }
    }
    return sourceBal as bigint;
  }, [sourceBal, direction]);

  const allowanceKnown = allowanceQ.data !== null && allowanceQ.data !== undefined;
  // Only suggest "approve" once we have a real reading. Otherwise we'd flash
  // an Approve button to a user whose allowance is actually already sufficient.
  const allowanceLoading =
    direction === "bsc2z" && !!browserAddr && cfgReady && !allowanceKnown;
  const needsApprove =
    direction === "bsc2z" &&
    amountWei > 0n &&
    allowanceKnown &&
    (allowanceQ.data as bigint) < amountWei;

  const lowBnb =
    direction === "bsc2z" &&
    bnbBalQ.data !== null &&
    bnbBalQ.data !== undefined &&
    bnbBalQ.data < 100_000_000_000_000n; // < 0.0001 BNB

  const insufficientBalance =
    sourceBalWei !== null && amountWei > 0n && amountWei > sourceBalWei;

  const validRecipient = /^0x[0-9a-fA-F]{40}$/.test(destAddr.trim());

  // SAFETY: when the active wallet changes (or first appears), force-reset the
  // recipient to the new wallet's address and clear the in-flight tx panel.
  // Previously we only auto-filled when destAddr was empty, which let the
  // recipient silently persist across wallet switches — a real-funds footgun
  // (user could burn/lock to the previous wallet's address by mistake).
  useEffect(() => {
    if (!browserAddr) {
      setDestAddr("");
      setLastTx(null);
      setErr(null);
      setBusy(null);
      return;
    }
    setDestAddr(browserAddr);
    setLastTx(null);
    setErr(null);
    // Clear `busy` too — any in-flight tx from the previous wallet's session
    // would otherwise leave the new wallet's UI permanently disabled, since
    // the handler's finally-block only clears busy when the wallet snapshot
    // still matches.
    setBusy(null);
    // Intentionally only depend on browserAddr — we WANT to overwrite
    // whatever was previously typed when the user changes wallet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserAddr]);

  // Always-fresh ref to the active wallet so async handlers can detect a
  // mid-flight wallet swap and refuse to populate `lastTx`/`err` with
  // results that belong to the old wallet session.
  const browserAddrRef = useRef(browserAddr);
  useEffect(() => {
    browserAddrRef.current = browserAddr;
  }, [browserAddr]);

  function flipDirection() {
    setDirection((d) => (d === "z2bsc" ? "bsc2z" : "z2bsc"));
    setErr(null);
    setLastTx(null);
  }

  function setMax() {
    if (sourceBalWei === null) return;
    setAmountStr(fmtUnits18(sourceBalWei));
  }

  // ── Action handlers ────────────────────────────────────────────────────
  async function onApprove() {
    if (!cfg || !browserAddr) return;
    if (isRemote || !browserKey) {
      const m = isRemote
        ? "Bridge needs a local signing key. Disconnect the mobile wallet (or pair a MetaMask wallet on BSC) to approve."
        : "no in-browser wallet active";
      setErr(m);
      toast({ title: "Cannot approve", description: m, variant: "destructive" });
      return;
    }
    const startedFor = browserAddr;
    setErr(null);
    setBusy("approve");
    try {
      const hash = await approveWzbxInBrowser(cfg, browserKey, amountWei);
      // SAFETY: wallet may have changed mid-flight. Toast the user (so they
      // know their click landed) but do NOT populate the in-card tx panel
      // for the new wallet's session.
      if (browserAddrRef.current !== startedFor) {
        toast({ title: "Approve submitted (previous wallet)", description: shortAddr(hash, 10, 8) });
        return;
      }
      setLastTx({
        hash,
        direction,
        kind: "approve",
        amountWei,
        submittedAt: Date.now(),
      });
      toast({ title: "Approve submitted", description: shortAddr(hash, 10, 8) });
      setTimeout(() => allowanceQ.refetch(), 5_000);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (browserAddrRef.current === startedFor) setErr(m);
      toast({ title: "Approve failed", description: m, variant: "destructive" });
    } finally {
      if (browserAddrRef.current === startedFor) setBusy(null);
    }
  }

  async function onSubmit() {
    if (!cfg || !browserAddr) return;
    if (isRemote || !browserKey) {
      const m = isRemote
        ? "Bridge needs a local signing key. Disconnect the mobile wallet (or pair a MetaMask wallet on BSC) to submit."
        : "no in-browser wallet active";
      setErr(m);
      toast({ title: "Cannot submit", description: m, variant: "destructive" });
      return;
    }
    const startedFor = browserAddr;
    setErr(null);
    setBusy("submit");
    try {
      let hash: string;
      if (direction === "z2bsc") {
        if (!cfg.zebvix_zbx_asset_id) {
          throw new Error("zebvix_zbx_asset_id not configured (operator: set ZEBVIX_ZBX_ASSET_ID)");
        }
        const r = await sendBridgeOut({
          privateKeyHex: browserKey,
          assetId: cfg.zebvix_zbx_asset_id,
          amount: amountStr.trim(),
          assetDecimals: ZBX_DECIMALS,
          destAddress: destAddr.trim(),
        });
        hash = r.hash;
      } else {
        hash = await burnToZebvixInBrowser(cfg, browserKey, destAddr.trim(), amountWei);
      }
      if (browserAddrRef.current !== startedFor) {
        toast({
          title: direction === "z2bsc"
            ? "Bridge-out submitted (previous wallet)"
            : "Burn submitted (previous wallet)",
          description: shortAddr(hash, 10, 8),
        });
        return;
      }
      setLastTx({
        hash,
        direction,
        kind: "submit",
        amountWei,
        submittedAt: Date.now(),
      });
      toast({
        title: direction === "z2bsc" ? "Bridge-out submitted" : "Burn submitted",
        description: shortAddr(hash, 10, 8),
      });
      setAmountStr("");
      setTimeout(() => {
        zbxBalQ.refetch();
        wzbxBalQ.refetch();
        bnbBalQ.refetch();
        allowanceQ.refetch();
        recentZEventsQ.refetch();
      }, 6_000);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (browserAddrRef.current === startedFor) setErr(m);
      toast({
        title: direction === "z2bsc" ? "Bridge-out failed" : "Burn failed",
        description: m,
        variant: "destructive",
      });
    } finally {
      if (browserAddrRef.current === startedFor) setBusy(null);
    }
  }

  // ── Activity feed (Z->BSC events filtered to active wallet) ───────────
  const activity: ActivityItem[] = useMemo(() => {
    if (!browserAddr || !recentZEventsQ.data?.events) return [];
    const items: ActivityItem[] = [];
    for (const ev of recentZEventsQ.data.events as BridgeOutEvent[]) {
      if (ev.from?.toLowerCase() !== browserAddr) continue;
      let amt = 0n;
      try {
        amt = BigInt(ev.amount);
      } catch {
        // ignore
      }
      items.push({
        kind: "z2bsc",
        hash: ev.tx_hash,
        amountWei: amt,
        timestamp: Date.now() - (zHeadQ.data && ev.height ? (zHeadQ.data - ev.height) * 2_000 : 0),
        link: `/block-explorer?q=${ev.tx_hash}`,
      });
    }
    if (lastTx) {
      items.unshift({
        kind: lastTx.direction === "z2bsc" ? "z2bsc" : (lastTx.kind === "approve" ? "approve" : "burn"),
        hash: lastTx.hash,
        amountWei: lastTx.amountWei,
        timestamp: lastTx.submittedAt,
        link:
          lastTx.direction === "z2bsc"
            ? `/block-explorer?q=${lastTx.hash}`
            : `${cfg?.bsc_explorer ?? "https://bscscan.com"}/tx/${lastTx.hash}`,
      });
    }
    // Dedupe by hash, keep first occurrence (which is the most recent if we
    // unshift the lastTx) and sort by timestamp desc.
    const seen = new Set<string>();
    const deduped = items.filter((i) => {
      const k = i.hash.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    deduped.sort((a, b) => b.timestamp - a.timestamp);
    return deduped.slice(0, 6);
  }, [recentZEventsQ.data, browserAddr, zHeadQ.data, lastTx, cfg?.bsc_explorer]);

  // ── Submit-button label/state ─────────────────────────────────────────
  const submitDisabled =
    !!busy ||
    !browserAddr ||
    !cfgReady ||
    amountWei === 0n ||
    !validRecipient ||
    insufficientBalance ||
    lowBnb ||
    isRemote;

  const sourceLabel = direction === "z2bsc" ? "Zebvix L1" : "BSC Mainnet";
  const sourceAsset = direction === "z2bsc" ? "ZBX (native)" : "wZBX (BEP-20)";
  const sourceAccent = direction === "z2bsc" ? "bg-emerald-400/10 text-emerald-400" : "bg-amber-400/10 text-amber-400";
  const destLabel = direction === "z2bsc" ? "BSC Mainnet" : "Zebvix L1";
  const destAsset = direction === "z2bsc" ? "wZBX (BEP-20)" : "ZBX (native)";
  const destAccent = direction === "z2bsc" ? "bg-amber-400/10 text-amber-400" : "bg-emerald-400/10 text-emerald-400";
  const sourceBalDisplay = direction === "z2bsc"
    ? (zbxBalQ.data ?? null)
    : (wzbxBalQ.data !== null && wzbxBalQ.data !== undefined ? fmtUnits18(wzbxBalQ.data, 6) : null);
  const destBalDisplay = direction === "z2bsc"
    ? (wzbxBalQ.data !== null && wzbxBalQ.data !== undefined ? fmtUnits18(wzbxBalQ.data, 6) : null)
    : (zbxBalQ.data ?? null);

  return (
    <div className="space-y-6">
      {/* ── Top: live status ─────────────────────────────────────── */}
      <HealthRow
        cfg={cfg}
        relayer={relayerQ.data}
        zHead={zHeadQ.data ?? null}
        bscHead={bscHeadQ.data ?? null}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* ── Main bridge card ──────────────────────────────────── */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">Bridge ZBX</h2>
              <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/40">
                Live · Mainnet
              </Badge>
            </div>
            <button
              type="button"
              onClick={() => {
                zbxBalQ.refetch();
                wzbxBalQ.refetch();
                bnbBalQ.refetch();
                allowanceQ.refetch();
              }}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40 transition-colors"
              title="Refresh balances"
            >
              <RefreshCw className="h-3.5 w-3.5" /> refresh
            </button>
          </div>

          {/* Wallet header */}
          {!browserAddr ? (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" />
              <div className="flex-1">
                <strong>No active wallet.</strong>{" "}
                <WLink href="/wallet" className="text-primary hover:underline">
                  Create or import one
                </WLink>{" "}
                to use the bridge. Same key works on both chains.
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
              <WalletIcon className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">
                    {activeWallet?.label ?? "wallet"}
                  </span>
                  <span className="font-mono text-muted-foreground truncate">
                    {browserAddr}
                  </span>
                  <CopyBtn value={browserAddr} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Same address on Zebvix L1 + BSC (ETH-standard derivation, no network switch needed)
                </div>
              </div>
            </div>
          )}

          {!cfgReady && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" />
              <div>
                <strong>Bridge contracts not yet wired.</strong> Operator: set{" "}
                <code className="text-xs bg-muted px-1 rounded">BSC_WZBX_ADDRESS</code> +{" "}
                <code className="text-xs bg-muted px-1 rounded">BSC_BRIDGE_ADDRESS</code> in api-server env.
              </div>
            </div>
          )}

          {/* From / Swap / To */}
          <div className="space-y-2 relative">
            <ChainPill
              side="from"
              chainName={sourceLabel}
              chainAccent={sourceAccent}
              asset={sourceAsset}
              balance={sourceBalDisplay}
              loading={direction === "z2bsc" ? zbxBalQ.isLoading : wzbxBalQ.isLoading}
              badge={direction === "z2bsc" ? "chain 7878" : `chain ${cfg?.bsc_chain_id ?? 56}`}
            />
            <div className="flex justify-center -my-3 relative z-10">
              <button
                type="button"
                onClick={flipDirection}
                className="h-9 w-9 rounded-full bg-card border-2 border-border hover:border-primary hover:bg-primary/10 transition-colors flex items-center justify-center group"
                title="Flip direction"
              >
                <ArrowDown className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:rotate-180 transition-all duration-300" />
              </button>
            </div>
            <ChainPill
              side="to"
              chainName={destLabel}
              chainAccent={destAccent}
              asset={destAsset}
              balance={destBalDisplay}
              loading={direction === "z2bsc" ? wzbxBalQ.isLoading : zbxBalQ.isLoading}
              badge={direction === "z2bsc" ? `chain ${cfg?.bsc_chain_id ?? 56}` : "chain 7878"}
            />
          </div>

          {/* Amount + Recipient */}
          <div className="space-y-3">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Amount
                </label>
                {sourceBalWei !== null && sourceBalWei > 0n && (
                  <button
                    type="button"
                    onClick={setMax}
                    className="text-[10px] text-primary hover:underline"
                  >
                    use max
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="font-mono text-lg tabular-nums pr-16"
                  disabled={!browserAddr || !cfgReady || !!busy}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                  {direction === "z2bsc" ? "ZBX" : "wZBX"}
                </div>
              </div>
              {insufficientBalance && (
                <div className="text-[11px] text-rose-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Insufficient {direction === "z2bsc" ? "ZBX" : "wZBX"} balance
                </div>
              )}
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Recipient on {destLabel}
                </label>
                {browserAddr && (
                  <button
                    type="button"
                    onClick={() => setDestAddr(browserAddr)}
                    className="text-[10px] text-primary hover:underline"
                  >
                    use my address
                  </button>
                )}
              </div>
              <Input
                type="text"
                placeholder="0x… (40 hex chars)"
                value={destAddr}
                onChange={(e) => setDestAddr(e.target.value)}
                className="font-mono text-sm"
                disabled={!browserAddr || !cfgReady || !!busy}
              />
              {destAddr.trim() && !validRecipient && (
                <div className="text-[11px] text-rose-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Recipient must be 0x + 40 hex chars
                </div>
              )}
            </div>
          </div>

          {/* Fees / hints */}
          <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-center justify-between">
              <span>Estimated arrival</span>
              <span className="font-mono">
                {direction === "z2bsc" ? "~30 sec" : "~60 sec (15 BSC confs)"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Source-chain fee</span>
              <span className="font-mono">
                {direction === "z2bsc" ? "~0.0001 ZBX" : "~0.0000023 BNB"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Destination mint gas</span>
              <span className="font-mono text-emerald-400">paid by relayer</span>
            </div>
            {direction === "bsc2z" && (
              <div className="flex items-center justify-between">
                <span>Allowance</span>
                <span className="font-mono">
                  {allowanceQ.data === null || allowanceQ.data === undefined
                    ? "…"
                    : `${fmtUnits18(allowanceQ.data, 4)} wZBX`}
                </span>
              </div>
            )}
          </div>

          {lowBnb && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-400 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Low BNB on this address — burn tx needs ~0.0000025 BNB for gas. Top up before submitting.
              </span>
            </div>
          )}

          {isRemote && (
            <div className="rounded-md border border-cyan-400/40 bg-cyan-400/5 p-2.5 text-xs text-cyan-300 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Mobile wallet paired — bridge transactions need a local signing key.
                Disconnect the mobile wallet from the topbar (or use MetaMask on BSC) to continue.
              </span>
            </div>
          )}

          {/* Action button */}
          <div>
            {allowanceLoading && amountWei > 0n ? (
              <Button disabled className="w-full h-12 text-base">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking allowance…
              </Button>
            ) : needsApprove ? (
              <Button
                onClick={onApprove}
                disabled={!!busy || amountWei === 0n || !browserAddr || !cfgReady}
                className="w-full h-12 text-base"
              >
                {busy === "approve" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4 mr-2" />
                )}
                Step 1 of 2 — Approve {amountStr || "0"} wZBX
              </Button>
            ) : (
              <Button
                onClick={onSubmit}
                disabled={submitDisabled}
                className="w-full h-12 text-base"
              >
                {busy === "submit" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : direction === "z2bsc" ? (
                  <Lock className="h-4 w-4 mr-2" />
                ) : (
                  <Flame className="h-4 w-4 mr-2" />
                )}
                {direction === "z2bsc"
                  ? `Bridge ${amountStr || "0"} ZBX → wZBX`
                  : `Burn ${amountStr || "0"} wZBX → ZBX`}
              </Button>
            )}
          </div>

          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              <div className="break-all">{err}</div>
            </div>
          )}

          {lastTx && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <strong>
                  {lastTx.kind === "approve"
                    ? "Approve submitted"
                    : lastTx.direction === "z2bsc"
                      ? "Bridge-out submitted on Zebvix"
                      : "Burn submitted on BSC"}
                </strong>
              </div>
              <a
                href={
                  lastTx.direction === "z2bsc"
                    ? `/block-explorer?q=${lastTx.hash}`
                    : `${cfg?.bsc_explorer ?? "https://bscscan.com"}/tx/${lastTx.hash}`
                }
                target={lastTx.direction === "z2bsc" ? "_self" : "_blank"}
                rel={lastTx.direction === "z2bsc" ? undefined : "noopener noreferrer"}
                className="break-all font-mono hover:text-primary inline-flex items-center gap-1"
              >
                {lastTx.hash}
                <ExternalLink className="h-3 w-3" />
              </a>
              {lastTx.kind === "submit" && (
                <div className="text-[11px] text-muted-foreground pt-1 border-t border-primary/20">
                  Relayer is watching for this. Destination mint will appear in
                  recent activity within ~{lastTx.direction === "z2bsc" ? "30 sec" : "60 sec"}.
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ── Side: Recent activity for this wallet ─────────────── */}
        <Card className="p-4 space-y-3 self-start">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold">Your recent bridges</h3>
          </div>
          {!browserAddr ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              Connect a wallet to see history.
            </div>
          ) : activity.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              No bridge activity yet for this address.
            </div>
          ) : (
            <div className="space-y-1 -mx-1">
              {activity.map((it) => (
                <ActivityRow key={`${it.hash}-${it.kind}`} item={it} />
              ))}
            </div>
          )}
          <div className="pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
            Showing Zebvix-side BridgeOut events for your address (last 50
            global events scanned). BSC burns appear after submit.
          </div>
        </Card>
      </div>

      {/* ── Contract addresses footer ─────────────────────────────── */}
      {cfg && cfgReady && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold">Verified contracts</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                wZBX (BEP-20) on {cfg.bsc_chain_name}
              </div>
              <div className="flex items-center gap-2 font-mono mt-1 break-all">
                <a
                  href={`${cfg.bsc_explorer}/address/${cfg.wzbx_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary inline-flex items-center gap-1"
                >
                  {cfg.wzbx_address}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <CopyBtn value={cfg.wzbx_address} />
              </div>
            </div>
            <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                ZebvixBridge on {cfg.bsc_chain_name}
              </div>
              <div className="flex items-center gap-2 font-mono mt-1 break-all">
                <a
                  href={`${cfg.bsc_explorer}/address/${cfg.bridge_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary inline-flex items-center gap-1"
                >
                  {cfg.bridge_address}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <CopyBtn value={cfg.bridge_address} />
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
