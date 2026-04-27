// Pay-ID Resolver workbench.
// ───────────────────────────────────────────────────────────────────────────
// Four tabs: Resolver / My Pay-ID Card / Bulk Resolve / Recent.
// Sticky right sidebar with active wallet, network info, "How it works",
// and an in-page activity log.  All scrubbed of any 64-hex / mnemonic-shaped
// runs as defence in depth — this page never sees private keys, but the
// scrubber guards against any future accidental leak.
//
// Banner Studio renders a real, scannable QR-coded SVG that can be downloaded
// either as PNG (canvas-rasterised) or SVG (vector, scales to any size).
// Three themes (Neon / Midnight / Light) and three aspect ratios
// (Square 1080 / Wide 1200x630 / Story 1080x1920).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SVGProps,
} from "react";
import { Link } from "wouter";
import {
  AtSign,
  Search,
  ArrowRight,
  AlertCircle,
  UserPlus,
  Copy,
  CheckCircle2,
  Wallet as WalletIcon,
  Hash,
  QrCode,
  Download,
  RefreshCw,
  ScanLine,
  Image as ImageIcon,
  ExternalLink,
  Activity,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Trash2,
  Share2,
  FileImage,
  FileCode2,
  Database,
  Sparkles,
  Eye,
  EyeOff,
  Globe,
  ShieldCheck,
  Inbox,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import { Badge } from "@/components/ui/badge";
import { SectionCard, Stat } from "@/components/ui/section-card";
import { useToast } from "@/hooks/use-toast";
import { lookupPayIdForward, lookupPayIdReverse, payIdCount } from "@/lib/payid";
import type { PayIdRecord } from "@/lib/payid";
import { useWallet } from "@/contexts/wallet-context";

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

const HISTORY_KEY = "zbx:payid:resolver:v1";
const HISTORY_MAX = 50;
const BULK_MAX = 50;
const FORWARD_DEBOUNCE_MS = 350;

type TabId = "resolver" | "card" | "bulk" | "history";
type ResolverKind = "forward" | "reverse";
type BannerTheme = "neon" | "midnight" | "light";
type BannerSize = "square" | "wide" | "story";

interface ResolverHistoryEntry {
  ts: number;
  kind: ResolverKind;
  query: string;
  result: string | null;
  name?: string | null;
}

interface BulkResultRow {
  raw: string;
  canonical: string | null;
  state: "pending" | "found" | "missing" | "invalid" | "error";
  address?: string;
  name?: string | null;
  error?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers — pure
// ───────────────────────────────────────────────────────────────────────────

function scrubSecrets(s: string): string {
  if (!s) return s;
  let out = s;
  out = out.replace(/0x[0-9a-fA-F]{64}/g, "0x[redacted]");
  out = out.replace(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, "[redacted]");
  out = out.replace(/\b(?:[a-z]{3,8} ){11,23}[a-z]{3,8}\b/g, "[mnemonic-redacted]");
  return out;
}

function canonicalisePayId(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/@zbx$/, "");
  if (!/^[a-z0-9_]{3,25}$/.test(stripped)) return null;
  return `${stripped}@zbx`;
}

function isValidAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

function payIdScanUri(payId: string, address: string): string {
  // Compact URI scannable by any QR reader. Keeps the on-chain Pay-ID handle
  // as the primary identifier and binds the address as a query param so
  // wallets can verify the mapping client-side without extra RPC.
  const handle = payId.trim().toLowerCase();
  const addr = address.trim().toLowerCase();
  return `payid:${handle}?address=${addr}&chain=zbx`;
}

function loadHistory(): ResolverHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is ResolverHistoryEntry => {
        return (
          x &&
          typeof x === "object" &&
          typeof x.ts === "number" &&
          (x.kind === "forward" || x.kind === "reverse") &&
          typeof x.query === "string" &&
          (x.result === null || typeof x.result === "string")
        );
      })
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(entries: ResolverHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(entries.slice(0, HISTORY_MAX)),
    );
  } catch {
    /* quota exceeded — non-fatal */
  }
}

function csvCell(s: string): string {
  if (s == null) return "";
  const needsQuote = /[",\n\r]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needsQuote ? `"${esc}"` : esc;
}

function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to read the URL.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function svgElementToPngBlob(
  svgEl: SVGSVGElement,
  pixelScale = 2,
): Promise<Blob> {
  // Make sure the serialized SVG carries an xmlns; otherwise Image() refuses.
  const cloned = svgEl.cloneNode(true) as SVGSVGElement;
  if (!cloned.getAttribute("xmlns")) {
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!cloned.getAttribute("xmlns:xlink")) {
    cloned.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  const xml = new XMLSerializer().serializeToString(cloned);
  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const vb = svgEl.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : Number(svgEl.getAttribute("width") || 1200);
  const h = vb && vb.height ? vb.height : Number(svgEl.getAttribute("height") || 630);

  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * pixelScale);
        canvas.height = Math.round(h * pixelScale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("canvas 2D context unavailable"));
          return;
        }
        ctx.scale(pixelScale, pixelScale);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("canvas.toBlob returned null"));
          },
          "image/png",
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image failed to load serialized SVG"));
    };
    img.src = url;
  });
}

function svgElementToSvgBlob(svgEl: SVGSVGElement): Blob {
  const cloned = svgEl.cloneNode(true) as SVGSVGElement;
  if (!cloned.getAttribute("xmlns")) {
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!cloned.getAttribute("xmlns:xlink")) {
    cloned.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  const xml = new XMLSerializer().serializeToString(cloned);
  return new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
}

// ───────────────────────────────────────────────────────────────────────────
// Live network count hook (race-safe)
// ───────────────────────────────────────────────────────────────────────────

function useLiveCount(intervalMs = 15_000) {
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const n = await payIdCount();
      if (seq === seqRef.current) {
        setCount(n);
        setErr(null);
      }
    } catch (e) {
      if (seq === seqRef.current) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { count, err, refresh };
}

// ───────────────────────────────────────────────────────────────────────────
// Auto-resolve current wallet's Pay-ID (race-safe, refresh on wallet change)
// ───────────────────────────────────────────────────────────────────────────

function useMyPayId(address?: string) {
  const [rec, setRec] = useState<PayIdRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!address) {
      setRec(null);
      setErr(null);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setErr(null);
    try {
      const r = await lookupPayIdReverse(address);
      if (seq === seqRef.current) {
        setRec(r ?? null);
      }
    } catch (e) {
      if (seq === seqRef.current) {
        setErr(e instanceof Error ? e.message : String(e));
        setRec(null);
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rec, loading, err, refresh };
}

// ───────────────────────────────────────────────────────────────────────────
// Page component
// ───────────────────────────────────────────────────────────────────────────

export default function PayIdResolver() {
  const { toast } = useToast();
  const { active } = useWallet();
  const { count, refresh: refreshCount } = useLiveCount();
  const { rec: myRec, loading: myLoading, refresh: refreshMine } = useMyPayId(
    active?.address,
  );

  const [tab, setTab] = useState<TabId>("resolver");
  const [history, setHistory] = useState<ResolverHistoryEntry[]>(() => loadHistory());

  // Activity log (ephemeral). Every entry is scrubbed of secret-shaped runs.
  const [activity, setActivity] = useState<
    { ts: number; msg: string; tone: "info" | "ok" | "warn" | "err" }[]
  >([]);
  const log = useCallback(
    (msg: string, tone: "info" | "ok" | "warn" | "err" = "info") => {
      const safe = scrubSecrets(msg);
      setActivity((prev) => [{ ts: Date.now(), msg: safe, tone }, ...prev].slice(0, 25));
    },
    [],
  );

  const copy = useCallback(
    (text: string, label = "Copied") => {
      navigator.clipboard.writeText(text).then(
        () => toast({ title: label }),
        () => toast({ title: "Copy failed", variant: "destructive" }),
      );
    },
    [toast],
  );

  const pushHistory = useCallback((entry: ResolverHistoryEntry) => {
    setHistory((prev) => {
      // Dedup most recent identical query (kind+query+result)
      const filtered = prev.filter(
        (e) =>
          !(
            e.kind === entry.kind &&
            e.query === entry.query &&
            e.result === entry.result
          ),
      );
      const next = [entry, ...filtered].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
    log("History cleared", "warn");
    toast({ title: "Local history cleared" });
  }, [log, toast]);

  // Tab DOM ids for ARIA wiring
  const tabIds: Record<TabId, { tab: string; panel: string }> = {
    resolver: { tab: "tab-resolver", panel: "panel-resolver" },
    card: { tab: "tab-card", panel: "panel-card" },
    bulk: { tab: "tab-bulk", panel: "panel-bulk" },
    history: { tab: "tab-history", panel: "panel-history" },
  };

  // Cross-tab handoff: when user clicks a row in History or a resolved chip,
  // we may want to jump back to Resolver tab pre-filled. Provide a setter.
  const [forwardSeed, setForwardSeed] = useState<string>("");
  const [reverseSeed, setReverseSeed] = useState<string>("");
  const jumpToResolver = useCallback(
    (kind: ResolverKind, value: string) => {
      if (kind === "forward") setForwardSeed(value);
      else setReverseSeed(value);
      setTab("resolver");
    },
    [],
  );

  // Seed banner studio with the user's own Pay-ID when available.
  const myCanonical = myRec?.pay_id ?? null;
  const myAddress = active?.address ?? null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* HERO */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Live RPC
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            Read-only
          </Badge>
          <Badge variant="outline" className="text-purple-400 border-purple-500/40">
            QR &amp; Banner Studio
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1
            className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3"
            data-testid="text-page-title"
          >
            <AtSign className="w-7 h-7 text-primary" />
            Pay-ID Resolver
          </h1>
          <Link href="/payid-register">
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              data-testid="button-go-register"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Register Pay-ID
              <ArrowRight className="h-3 w-3 opacity-70" />
            </button>
          </Link>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Resolve <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">handle@zbx</code>{" "}
          to an address, look up which Pay-ID belongs to an address, generate
          shareable QR-coded banners for your own Pay-ID, and run bulk lookups
          across many handles at once. Powered by{" "}
          <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">zbx_lookupPayId</code>{" "}
          and{" "}
          <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">zbx_getPayIdOf</code>.
        </p>
      </div>

      {/* STATS */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Total Registered"
          value={count ?? "—"}
          accent="primary"
          icon={AtSign}
          hint="Live, refreshes every 15s"
        />
        <Stat
          label="Format"
          value="<handle>@zbx"
          hint="3–25 chars, [a-z0-9_]"
          icon={Hash}
        />
        <Stat
          label="Mutability"
          value="Permanent"
          hint="One per address, on-chain"
          accent="warn"
          icon={ShieldCheck}
        />
        <Stat
          label="My Pay-ID"
          value={
            myLoading
              ? "Loading…"
              : myCanonical
                ? myCanonical
                : active
                  ? "Not registered"
                  : "No wallet"
          }
          hint={active ? shortAddr(active.address) : "Generate or import a wallet"}
          icon={WalletIcon}
          accent={myCanonical ? "primary" : undefined}
        />
      </div>

      {/* MAIN + SIDEBAR */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ── MAIN ──────────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Pay-ID resolver workbench"
            className="flex flex-wrap gap-2"
            onKeyDown={(e) => {
              if (
                e.key !== "ArrowLeft" &&
                e.key !== "ArrowRight" &&
                e.key !== "Home" &&
                e.key !== "End"
              )
                return;
              const order: TabId[] = ["resolver", "card", "bulk", "history"];
              const idx = order.indexOf(tab);
              if (idx < 0) return;
              let next = idx;
              if (e.key === "ArrowLeft") next = (idx - 1 + order.length) % order.length;
              else if (e.key === "ArrowRight") next = (idx + 1) % order.length;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = order.length - 1;
              if (next !== idx) {
                e.preventDefault();
                setTab(order[next]);
                requestAnimationFrame(() => {
                  const el = document.getElementById(tabIds[order[next]].tab);
                  if (el instanceof HTMLElement) el.focus();
                });
              }
            }}
          >
            <TabBtn
              tabId={tabIds.resolver.tab}
              panelId={tabIds.resolver.panel}
              active={tab === "resolver"}
              onClick={() => setTab("resolver")}
              icon={Search}
              label="Resolver"
              testid="tab-resolver"
            />
            <TabBtn
              tabId={tabIds.card.tab}
              panelId={tabIds.card.panel}
              active={tab === "card"}
              onClick={() => setTab("card")}
              icon={QrCode}
              label="My Pay-ID Card"
              testid="tab-card"
            />
            <TabBtn
              tabId={tabIds.bulk.tab}
              panelId={tabIds.bulk.panel}
              active={tab === "bulk"}
              onClick={() => setTab("bulk")}
              icon={ListChecks}
              label="Bulk Resolve"
              testid="tab-bulk"
            />
            <TabBtn
              tabId={tabIds.history.tab}
              panelId={tabIds.history.panel}
              active={tab === "history"}
              onClick={() => setTab("history")}
              icon={Database}
              label="Recent"
              testid="tab-history"
            />
          </div>

          {/* Panels */}
          {tab === "resolver" && (
            <div
              role="tabpanel"
              id={tabIds.resolver.panel}
              aria-labelledby={tabIds.resolver.tab}
              data-testid="panel-resolver"
            >
              <ResolverPanel
                forwardSeed={forwardSeed}
                reverseSeed={reverseSeed}
                onClearForwardSeed={() => setForwardSeed("")}
                onClearReverseSeed={() => setReverseSeed("")}
                onCopy={copy}
                onLog={log}
                onPushHistory={pushHistory}
                onRefreshCount={refreshCount}
              />
            </div>
          )}

          {tab === "card" && (
            <div
              role="tabpanel"
              id={tabIds.card.panel}
              aria-labelledby={tabIds.card.tab}
              data-testid="panel-card"
            >
              <MyCardPanel
                payId={myCanonical}
                address={myAddress}
                walletLabel={active?.label ?? null}
                loading={myLoading}
                onRefresh={refreshMine}
                onCopy={copy}
                onLog={log}
              />
            </div>
          )}

          {tab === "bulk" && (
            <div
              role="tabpanel"
              id={tabIds.bulk.panel}
              aria-labelledby={tabIds.bulk.tab}
              data-testid="panel-bulk"
            >
              <BulkPanel
                onCopy={copy}
                onLog={log}
                onPushHistory={pushHistory}
                onJumpToResolver={jumpToResolver}
              />
            </div>
          )}

          {tab === "history" && (
            <div
              role="tabpanel"
              id={tabIds.history.panel}
              aria-labelledby={tabIds.history.tab}
              data-testid="panel-history"
            >
              <HistoryPanel
                entries={history}
                onCopy={copy}
                onClear={clearHistory}
                onJumpToResolver={jumpToResolver}
              />
            </div>
          )}
        </div>

        {/* ── SIDEBAR ───────────────────────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <ActiveWalletCard
            address={active?.address ?? null}
            label={active?.label ?? null}
            kind={active?.kind ?? null}
            myPayId={myCanonical}
            myLoading={myLoading}
            onRefresh={refreshMine}
            onCopy={copy}
          />

          <NetworkInfoCard count={count} onRefresh={refreshCount} />

          <HowItWorks />

          <ActivityLog entries={activity} />
        </aside>
      </div>

      {/* What is a Pay-ID — full-width footer card */}
      <SectionCard title="What is a Pay-ID?" icon={Sparkles}>
        <div className="grid gap-4 md:grid-cols-2 text-sm text-muted-foreground">
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              Human-readable alias for a Zebvix address —{" "}
              <code className="font-mono text-foreground">alice@zbx</code> instead
              of a 42-char hex string.
            </li>
            <li>
              Stored on-chain via{" "}
              <code className="font-mono text-foreground">TxKind::RegisterPayId</code>{" "}
              so it lives forever in the canonical state.
            </li>
            <li>
              Forward lookup{" "}
              <code className="font-mono text-foreground">zbx_lookupPayId</code>{" "}
              resolves a handle to its address; reverse{" "}
              <code className="font-mono text-foreground">zbx_getPayIdOf</code>{" "}
              resolves an address to its handle.
            </li>
          </ul>
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              <strong className="text-foreground">Permanent and unique</strong> —
              one Pay-ID per address; once claimed, it cannot be transferred or
              reissued. Globally case-insensitive.
            </li>
            <li>
              QR codes encode a portable URI{" "}
              <code className="font-mono text-foreground">payid:handle@zbx?address=0x…&amp;chain=zbx</code>{" "}
              that any compliant wallet can parse.
            </li>
            <li>
              Bulk resolve runs lookups in parallel and gives you a CSV export of
              the results — no sensitive material is included.
            </li>
          </ul>
        </div>
      </SectionCard>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// TAB: Resolver
// ───────────────────────────────────────────────────────────────────────────

function ResolverPanel(props: {
  forwardSeed: string;
  reverseSeed: string;
  onClearForwardSeed: () => void;
  onClearReverseSeed: () => void;
  onCopy: (s: string, label?: string) => void;
  onLog: (msg: string, tone?: "info" | "ok" | "warn" | "err") => void;
  onPushHistory: (entry: ResolverHistoryEntry) => void;
  onRefreshCount: () => void;
}) {
  const {
    forwardSeed,
    reverseSeed,
    onClearForwardSeed,
    onClearReverseSeed,
    onCopy,
    onLog,
    onPushHistory,
    onRefreshCount,
  } = props;

  // Forward
  const [forwardQ, setForwardQ] = useState(forwardSeed);
  const [forwardRes, setForwardRes] = useState<{ rec: PayIdRecord; bal: string } | null>(null);
  const [forwardErr, setForwardErr] = useState<string | null>(null);
  const [forwardLoading, setForwardLoading] = useState(false);
  const forwardSeqRef = useRef(0);
  const forwardDebRef = useRef<number | null>(null);

  // Reverse
  const [reverseQ, setReverseQ] = useState(reverseSeed);
  const [reverseRes, setReverseRes] = useState<{ rec: PayIdRecord; bal: string } | null>(null);
  const [reverseErr, setReverseErr] = useState<string | null>(null);
  const [reverseLoading, setReverseLoading] = useState(false);
  const reverseSeqRef = useRef(0);

  // Apply seeds (handoff from other tabs)
  useEffect(() => {
    if (forwardSeed) {
      setForwardQ(forwardSeed);
      onClearForwardSeed();
    }
  }, [forwardSeed, onClearForwardSeed]);
  useEffect(() => {
    if (reverseSeed) {
      setReverseQ(reverseSeed);
      onClearReverseSeed();
    }
  }, [reverseSeed, onClearReverseSeed]);

  const lookupForward = useCallback(
    async (raw: string) => {
      const canonical = canonicalisePayId(raw);
      setForwardErr(null);
      setForwardRes(null);
      if (!canonical) {
        if (raw.trim()) {
          setForwardErr("Handle must be 3–25 chars, [a-z0-9_].");
        }
        return;
      }
      const seq = ++forwardSeqRef.current;
      setForwardLoading(true);
      onLog(`Forward lookup ${canonical}`, "info");
      try {
        const rec = await lookupPayIdForward(canonical);
        if (seq !== forwardSeqRef.current) return;
        const addr = rec?.address;
        const bal = addr
          ? await rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0")
          : "0x0";
        if (seq !== forwardSeqRef.current) return;
        setForwardRes({ rec: rec ?? {}, bal });
        if (rec?.address) {
          onLog(`Resolved ${canonical} → ${shortAddr(rec.address)}`, "ok");
          onPushHistory({
            ts: Date.now(),
            kind: "forward",
            query: canonical,
            result: rec.address,
            name: rec.name ?? null,
          });
        } else {
          onLog(`Not registered: ${canonical}`, "warn");
          onPushHistory({
            ts: Date.now(),
            kind: "forward",
            query: canonical,
            result: null,
          });
        }
        onRefreshCount();
      } catch (e) {
        if (seq !== forwardSeqRef.current) return;
        const safe = scrubSecrets(e instanceof Error ? e.message : String(e));
        setForwardErr(safe);
        onLog(`Forward error: ${safe}`, "err");
      } finally {
        if (seq === forwardSeqRef.current) setForwardLoading(false);
      }
    },
    [onLog, onPushHistory, onRefreshCount],
  );

  // Auto-lookup as user types (debounced).
  useEffect(() => {
    if (forwardDebRef.current) window.clearTimeout(forwardDebRef.current);
    if (!forwardQ.trim()) {
      setForwardRes(null);
      setForwardErr(null);
      return;
    }
    const v = forwardQ;
    forwardDebRef.current = window.setTimeout(() => {
      lookupForward(v);
    }, FORWARD_DEBOUNCE_MS);
    return () => {
      if (forwardDebRef.current) window.clearTimeout(forwardDebRef.current);
    };
  }, [forwardQ, lookupForward]);

  const lookupReverse = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      setReverseErr(null);
      setReverseRes(null);
      if (!isValidAddress(trimmed)) {
        if (trimmed) setReverseErr("Address must be 0x + 40 hex chars.");
        return;
      }
      const seq = ++reverseSeqRef.current;
      setReverseLoading(true);
      onLog(`Reverse lookup ${shortAddr(trimmed)}`, "info");
      try {
        const rec = await lookupPayIdReverse(trimmed);
        if (seq !== reverseSeqRef.current) return;
        const bal = await rpc<string>("zbx_getBalance", [trimmed]).catch(() => "0x0");
        if (seq !== reverseSeqRef.current) return;
        setReverseRes({ rec: rec ?? {}, bal });
        if (rec?.pay_id) {
          onLog(`Found ${shortAddr(trimmed)} → ${rec.pay_id}`, "ok");
          onPushHistory({
            ts: Date.now(),
            kind: "reverse",
            query: trimmed.toLowerCase(),
            result: rec.pay_id,
            name: rec.name ?? null,
          });
        } else {
          onLog(`No Pay-ID for ${shortAddr(trimmed)}`, "warn");
          onPushHistory({
            ts: Date.now(),
            kind: "reverse",
            query: trimmed.toLowerCase(),
            result: null,
          });
        }
      } catch (e) {
        if (seq !== reverseSeqRef.current) return;
        const safe = scrubSecrets(e instanceof Error ? e.message : String(e));
        setReverseErr(safe);
        onLog(`Reverse error: ${safe}`, "err");
      } finally {
        if (seq === reverseSeqRef.current) setReverseLoading(false);
      }
    },
    [onLog, onPushHistory],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Forward */}
      <SectionCard
        title="Pay-ID → Address"
        subtitle="Live as you type"
        icon={Search}
        tone="primary"
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                value={forwardQ}
                onChange={(e) => setForwardQ(e.target.value.toLowerCase())}
                placeholder="alice"
                className="w-full rounded-md border border-border bg-background py-2 pl-3 pr-16 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                onKeyDown={(e) => e.key === "Enter" && lookupForward(forwardQ)}
                data-testid="input-forward"
                aria-label="Pay-ID handle"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                @zbx
              </span>
            </div>
            <button
              onClick={() => lookupForward(forwardQ)}
              disabled={!forwardQ.trim() || forwardLoading}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-forward-lookup"
              aria-label="Run forward lookup"
            >
              {forwardLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </button>
          </div>

          <div aria-live="polite" className="min-h-[1.25rem] text-xs">
            {forwardLoading && (
              <span className="text-muted-foreground">Resolving…</span>
            )}
            {!forwardLoading && forwardErr && (
              <span className="text-red-300" data-testid="text-forward-error">
                {forwardErr}
              </span>
            )}
            {!forwardLoading &&
              !forwardErr &&
              forwardQ.trim() &&
              forwardRes &&
              !forwardRes.rec?.address && (
                <span className="text-amber-300" data-testid="text-forward-not-found">
                  Handle is not registered.
                </span>
              )}
          </div>

          {forwardRes?.rec?.address && (
            <ResolvedRecord
              kind="forward"
              rec={forwardRes.rec}
              balance={forwardRes.bal}
              onCopy={onCopy}
            />
          )}
        </div>
      </SectionCard>

      {/* Reverse */}
      <SectionCard
        title="Address → Pay-ID"
        subtitle="Reverse lookup any 0x address"
        icon={Hash}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={reverseQ}
              onChange={(e) => setReverseQ(e.target.value.trim())}
              placeholder="0x..."
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              onKeyDown={(e) => e.key === "Enter" && lookupReverse(reverseQ)}
              data-testid="input-reverse"
              aria-label="Wallet address"
            />
            <button
              onClick={() => lookupReverse(reverseQ)}
              disabled={!reverseQ.trim() || reverseLoading}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-reverse-lookup"
              aria-label="Run reverse lookup"
            >
              {reverseLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </button>
          </div>

          <div aria-live="polite" className="min-h-[1.25rem] text-xs">
            {reverseLoading && (
              <span className="text-muted-foreground">Resolving…</span>
            )}
            {!reverseLoading && reverseErr && (
              <span className="text-red-300" data-testid="text-reverse-error">
                {reverseErr}
              </span>
            )}
            {!reverseLoading &&
              !reverseErr &&
              reverseQ.trim() &&
              isValidAddress(reverseQ) &&
              reverseRes &&
              !reverseRes.rec?.pay_id && (
                <span className="text-amber-300" data-testid="text-reverse-not-found">
                  No Pay-ID for {shortAddr(reverseQ)}.
                </span>
              )}
          </div>

          {reverseRes?.rec?.pay_id && (
            <ResolvedRecord
              kind="reverse"
              rec={{ ...reverseRes.rec, address: reverseQ }}
              balance={reverseRes.bal}
              onCopy={onCopy}
            />
          )}

          {!reverseRes?.rec?.pay_id &&
            !reverseLoading &&
            !reverseErr &&
            reverseQ.trim() &&
            isValidAddress(reverseQ) &&
            reverseRes && (
              <Link href="/payid-register">
                <button className="inline-flex items-center gap-1.5 text-xs text-primary underline">
                  Register one for this address
                  <ArrowRight className="h-3 w-3" />
                </button>
              </Link>
            )}
        </div>
      </SectionCard>
    </div>
  );
}

function ResolvedRecord(props: {
  kind: ResolverKind;
  rec: PayIdRecord;
  balance: string;
  onCopy: (s: string, label?: string) => void;
}) {
  const { kind, rec, balance, onCopy } = props;
  const handle = rec.pay_id ?? "";
  const address = rec.address ?? "";
  const uri = handle && address ? payIdScanUri(handle, address) : "";
  const [showQr, setShowQr] = useState(false);

  return (
    <div
      className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs"
      data-testid={kind === "forward" ? "result-forward" : "result-reverse"}
    >
      {kind === "forward" ? (
        <>
          <ResultRow
            label="Address"
            value={
              <code
                className="font-mono break-all text-primary"
                data-testid="text-forward-address"
              >
                {address}
              </code>
            }
            onCopy={() => onCopy(address)}
          />
          {handle && (
            <ResultRow
              label="Pay-ID"
              value={<code className="font-mono text-foreground">{handle}</code>}
              onCopy={() => onCopy(handle)}
            />
          )}
        </>
      ) : (
        <>
          <ResultRow
            label="Pay-ID"
            value={
              <code
                className="font-mono text-base font-semibold text-primary"
                data-testid="text-reverse-payid"
              >
                {handle}
              </code>
            }
            onCopy={() => onCopy(handle)}
          />
          {address && (
            <ResultRow
              label="Address"
              value={<code className="font-mono break-all">{address}</code>}
              onCopy={() => onCopy(address)}
            />
          )}
        </>
      )}

      {rec.name && (
        <ResultRow
          label="Display name"
          value={<span className="font-medium">{rec.name}</span>}
        />
      )}

      <ResultRow
        label="Balance"
        value={
          <span
            className="font-mono text-emerald-300"
            data-testid="text-balance"
          >
            {weiHexToZbx(balance)} ZBX
          </span>
        }
      />

      {uri && (
        <div className="pt-1">
          <button
            onClick={() => setShowQr((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            data-testid="button-toggle-qr"
            aria-expanded={showQr}
          >
            <QrCode className="h-3.5 w-3.5" />
            {showQr ? "Hide QR" : "Show scannable QR"}
            {showQr ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          {showQr && (
            <div className="mt-2 inline-block rounded bg-white p-2">
              <QRCodeSVG
                value={uri}
                size={140}
                level="M"
                includeMargin={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// TAB: My Pay-ID Card  (QR + Banner Studio)
// ───────────────────────────────────────────────────────────────────────────

function MyCardPanel(props: {
  payId: string | null;
  address: string | null;
  walletLabel: string | null;
  loading: boolean;
  onRefresh: () => void;
  onCopy: (s: string, label?: string) => void;
  onLog: (msg: string, tone?: "info" | "ok" | "warn" | "err") => void;
}) {
  const { payId, address, walletLabel, loading, onRefresh, onCopy, onLog } = props;

  if (!address) {
    return (
      <SectionCard title="No active wallet" icon={WalletIcon}>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            To generate your Pay-ID card and share it, first connect a wallet.
          </p>
          <div className="flex gap-2">
            <Link href="/wallet">
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                data-testid="button-go-wallet"
              >
                <WalletIcon className="h-3.5 w-3.5" />
                Open wallet
              </button>
            </Link>
            <Link href="/import-wallet">
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
                data-testid="button-go-import"
              >
                Import existing
              </button>
            </Link>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (loading) {
    return (
      <SectionCard title="Resolving your Pay-ID…" icon={RefreshCw}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Looking up on-chain Pay-ID for {shortAddr(address)}
        </div>
      </SectionCard>
    );
  }

  if (!payId) {
    return (
      <SectionCard title="No Pay-ID registered yet" icon={Inbox} tone="warn">
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            The active wallet{" "}
            <code className="font-mono text-foreground">{shortAddr(address)}</code>{" "}
            does not yet have a Pay-ID. Register one to unlock the QR card and
            shareable banner.
          </p>
          <div className="flex gap-2">
            <Link href="/payid-register">
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                data-testid="button-go-register-cta"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Register a Pay-ID
              </button>
            </Link>
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
              data-testid="button-refresh-mine"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </SectionCard>
    );
  }

  // Has Pay-ID — render the studio.
  return (
    <BannerStudio
      payId={payId}
      address={address}
      walletLabel={walletLabel}
      onCopy={onCopy}
      onLog={onLog}
      onRefresh={onRefresh}
    />
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Banner Studio
// ───────────────────────────────────────────────────────────────────────────

const THEME_STYLES: Record<
  BannerTheme,
  {
    bg: string;
    bgGrad: { from: string; to: string };
    grid: string;
    text: string;
    textMuted: string;
    accent: string;
    qrBg: string;
    qrFg: string;
    label: string;
  }
> = {
  neon: {
    bg: "#0a0a0f",
    bgGrad: { from: "#0a0a0f", to: "#15082a" },
    grid: "rgba(168, 85, 247, 0.08)",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.65)",
    accent: "#a855f7",
    qrBg: "#ffffff",
    qrFg: "#0a0a0f",
    label: "Neon",
  },
  midnight: {
    bg: "#020617",
    bgGrad: { from: "#020617", to: "#0c1d3d" },
    grid: "rgba(56, 189, 248, 0.08)",
    text: "#f8fafc",
    textMuted: "rgba(248,250,252,0.65)",
    accent: "#38bdf8",
    qrBg: "#ffffff",
    qrFg: "#020617",
    label: "Midnight",
  },
  light: {
    bg: "#fafafa",
    bgGrad: { from: "#ffffff", to: "#e2e8f0" },
    grid: "rgba(15, 23, 42, 0.06)",
    text: "#0f172a",
    textMuted: "rgba(15,23,42,0.65)",
    accent: "#7c3aed",
    qrBg: "#0f172a",
    qrFg: "#ffffff",
    label: "Light",
  },
};

const SIZE_DIMS: Record<BannerSize, { w: number; h: number; label: string; aspect: string }> = {
  square: { w: 1080, h: 1080, label: "Square 1080", aspect: "1:1 (Instagram, X)" },
  wide: { w: 1200, h: 630, label: "Wide 1200×630", aspect: "1.91:1 (OpenGraph, Discord)" },
  story: { w: 1080, h: 1920, label: "Story 1080×1920", aspect: "9:16 (Instagram Story)" },
};

function BannerStudio(props: {
  payId: string;
  address: string;
  walletLabel: string | null;
  onCopy: (s: string, label?: string) => void;
  onLog: (msg: string, tone?: "info" | "ok" | "warn" | "err") => void;
  onRefresh: () => void;
}) {
  const { payId, address, walletLabel, onCopy, onLog, onRefresh } = props;

  const [theme, setTheme] = useState<BannerTheme>("neon");
  const [size, setSize] = useState<BannerSize>("wide");
  const [tagline, setTagline] = useState<string>(walletLabel ?? "");
  const [showAddressOnBanner, setShowAddressOnBanner] = useState(true);
  const [downloading, setDownloading] = useState<"png" | "svg" | null>(null);

  const bannerRef = useRef<SVGSVGElement | null>(null);
  const uri = useMemo(() => payIdScanUri(payId, address), [payId, address]);

  const onDownloadPng = useCallback(async () => {
    if (!bannerRef.current) return;
    setDownloading("png");
    try {
      const blob = await svgElementToPngBlob(bannerRef.current, 2);
      const safeName = payId.replace(/[^a-z0-9_-]/gi, "_");
      triggerDownload(blob, `payid-${safeName}-${size}.png`);
      onLog(`Downloaded PNG banner for ${payId}`, "ok");
    } catch (e) {
      const safe = scrubSecrets(e instanceof Error ? e.message : String(e));
      onLog(`PNG export failed: ${safe}`, "err");
    } finally {
      setDownloading(null);
    }
  }, [payId, size, onLog]);

  const onDownloadSvg = useCallback(() => {
    if (!bannerRef.current) return;
    setDownloading("svg");
    try {
      const blob = svgElementToSvgBlob(bannerRef.current);
      const safeName = payId.replace(/[^a-z0-9_-]/gi, "_");
      triggerDownload(blob, `payid-${safeName}-${size}.svg`);
      onLog(`Downloaded SVG banner for ${payId}`, "ok");
    } catch (e) {
      const safe = scrubSecrets(e instanceof Error ? e.message : String(e));
      onLog(`SVG export failed: ${safe}`, "err");
    } finally {
      setDownloading(null);
    }
  }, [payId, size, onLog]);

  const onShare = useCallback(async () => {
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    const shareText = `${payId} on Zebvix Chain\n${uri}`;
    if (nav.share) {
      try {
        await nav.share({
          title: payId,
          text: shareText,
          url: uri,
        });
        onLog("Shared via system share sheet", "ok");
        return;
      } catch {
        // fall through to clipboard
      }
    }
    onCopy(shareText, "Share text copied");
  }, [payId, uri, onCopy, onLog]);

  return (
    <div className="space-y-4">
      {/* Compact info strip */}
      <SectionCard
        title="My Pay-ID"
        subtitle={`Active wallet: ${walletLabel ?? shortAddr(address)}`}
        icon={CheckCircle2}
        tone="primary"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Pay-ID
            </div>
            <code
              className="font-mono text-2xl font-semibold text-primary break-all"
              data-testid="text-my-payid"
            >
              {payId}
            </code>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pt-2">
              Address
            </div>
            <code className="font-mono text-xs text-foreground break-all">
              {address}
            </code>
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => onCopy(payId)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/40"
              data-testid="button-copy-mine-payid"
            >
              <Copy className="h-3 w-3" />
              Copy Pay-ID
            </button>
            <button
              onClick={() => onCopy(uri)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/40"
              data-testid="button-copy-uri"
            >
              <Copy className="h-3 w-3" />
              Copy scan URI
            </button>
            <button
              onClick={onShare}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/40"
              data-testid="button-share"
            >
              <Share2 className="h-3 w-3" />
              Share
            </button>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/40"
              data-testid="button-refresh-mine"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Studio controls + preview */}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Controls */}
        <SectionCard title="Studio" icon={Sparkles} subtitle="Theme · size · tagline">
          <div className="space-y-4 text-xs">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                Theme
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["neon", "midnight", "light"] as BannerTheme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    aria-pressed={theme === t}
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-medium transition ${
                      theme === t
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                    data-testid={`button-theme-${t}`}
                  >
                    {THEME_STYLES[t].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                Size
              </div>
              <div className="space-y-1">
                {(Object.keys(SIZE_DIMS) as BannerSize[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    aria-pressed={size === s}
                    className={`w-full text-left rounded-md border px-2 py-1.5 text-[11px] transition ${
                      size === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                    data-testid={`button-size-${s}`}
                  >
                    <div className="font-medium">{SIZE_DIMS[s].label}</div>
                    <div className="text-[9px] opacity-70">{SIZE_DIMS[s].aspect}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Tagline (optional)
              </label>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value.slice(0, 60))}
                placeholder="Builder · ZBX maxi · …"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                data-testid="input-tagline"
                maxLength={60}
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                {tagline.length}/60
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showAddressOnBanner}
                onChange={(e) => setShowAddressOnBanner(e.target.checked)}
                className="mt-0.5"
                data-testid="checkbox-show-address"
              />
              <div>
                <div className="text-[11px] font-medium text-foreground">
                  Show address on banner
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Toggle off if you only want the Pay-ID + QR visible.
                </div>
              </div>
            </label>

            <div className="space-y-1.5 pt-2 border-t border-border/40">
              <button
                onClick={onDownloadPng}
                disabled={!!downloading}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-download-png"
              >
                {downloading === "png" ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileImage className="h-3.5 w-3.5" />
                )}
                Download PNG
              </button>
              <button
                onClick={onDownloadSvg}
                disabled={!!downloading}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card/40 px-3 py-2 text-xs font-medium hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-download-svg"
              >
                {downloading === "svg" ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileCode2 className="h-3.5 w-3.5" />
                )}
                Download SVG
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Preview */}
        <SectionCard
          title="Preview"
          subtitle={`${SIZE_DIMS[size].label} · ${THEME_STYLES[theme].label}`}
          icon={ImageIcon}
        >
          <div
            className="rounded-md border border-border/60 bg-muted/10 p-3 overflow-auto"
            data-testid="container-banner-preview"
          >
            <BannerSvg
              ref={bannerRef}
              payId={payId}
              address={address}
              tagline={tagline}
              theme={theme}
              size={size}
              showAddress={showAddressOnBanner}
              uri={uri}
            />
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            The QR encodes{" "}
            <code className="font-mono text-foreground break-all">{uri}</code> —
            scan with any wallet that supports the{" "}
            <code className="font-mono text-foreground">payid:</code> URI scheme.
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// Banner SVG component — pure render, no side effects, drives both preview
// and download (downloader serialises this exact element).
const BannerSvg = React.forwardRef<
  SVGSVGElement,
  {
    payId: string;
    address: string;
    tagline: string;
    theme: BannerTheme;
    size: BannerSize;
    showAddress: boolean;
    uri: string;
  }
>(function BannerSvg(
  { payId, address, tagline, theme, size, showAddress, uri },
  ref,
) {
  const t = THEME_STYLES[theme];
  const dims = SIZE_DIMS[size];
  const W = dims.w;
  const H = dims.h;

  // QR target box — choose location & size by aspect.
  let qrSize: number;
  let qrX: number;
  let qrY: number;
  let textX: number;
  let textPayIdY: number;
  let textTaglineY: number;
  let textAddressY: number;
  let textBrandY: number;
  let textFooterY: number;
  let payIdFont: number;
  let brandFont: number;
  let taglineFont: number;
  let addressFont: number;
  let footerFont: number;
  let textAlign: "left" | "center" = "left";

  if (size === "square") {
    qrSize = 460;
    qrX = (W - qrSize) / 2;
    qrY = 220;
    textX = W / 2;
    textBrandY = 110;
    textPayIdY = 180;
    textTaglineY = qrY + qrSize + 100;
    textAddressY = qrY + qrSize + 160;
    textFooterY = H - 70;
    brandFont = 36;
    payIdFont = 84;
    taglineFont = 32;
    addressFont = 24;
    footerFont = 20;
    textAlign = "center";
  } else if (size === "wide") {
    qrSize = 360;
    qrX = W - qrSize - 70;
    qrY = (H - qrSize) / 2;
    textX = 70;
    textBrandY = 90;
    textPayIdY = 220;
    textTaglineY = 290;
    textAddressY = 380;
    textFooterY = H - 60;
    brandFont = 28;
    payIdFont = 86;
    taglineFont = 30;
    addressFont = 22;
    footerFont = 18;
    textAlign = "left";
  } else {
    // story
    qrSize = 600;
    qrX = (W - qrSize) / 2;
    qrY = 380;
    textX = W / 2;
    textBrandY = 180;
    textPayIdY = 290;
    textTaglineY = qrY + qrSize + 120;
    textAddressY = qrY + qrSize + 200;
    textFooterY = H - 120;
    brandFont = 56;
    payIdFont = 124;
    taglineFont = 48;
    addressFont = 36;
    footerFont = 32;
    textAlign = "center";
  }

  const gradId = `bg-grad-${theme}-${size}`;
  const accentId = `accent-glow-${theme}-${size}`;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      style={{ maxWidth: "100%", height: "auto", display: "block" }}
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      data-testid="svg-banner"
      role="img"
      aria-label={`Pay-ID banner for ${payId}`}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={t.bgGrad.from} />
          <stop offset="100%" stopColor={t.bgGrad.to} />
        </linearGradient>
        <radialGradient id={accentId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={t.accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={t.accent} stopOpacity="0" />
        </radialGradient>
        <pattern
          id={`grid-${theme}-${size}`}
          width="60"
          height="60"
          patternUnits="userSpaceOnUse"
        >
          <path d="M 60 0 L 0 0 0 60" fill="none" stroke={t.grid} strokeWidth="1" />
        </pattern>
      </defs>

      {/* Base */}
      <rect width={W} height={H} fill={t.bg} />
      <rect width={W} height={H} fill={`url(#${gradId})`} />
      <rect width={W} height={H} fill={`url(#grid-${theme}-${size})`} />

      {/* Accent glow behind QR */}
      <circle cx={qrX + qrSize / 2} cy={qrY + qrSize / 2} r={qrSize * 0.9} fill={`url(#${accentId})`} />

      {/* Brand bar */}
      <rect x={0} y={0} width={W} height={6} fill={t.accent} />

      {/* Brand mark */}
      <text
        x={textAlign === "center" ? W / 2 : textX}
        y={textBrandY}
        textAnchor={textAlign === "center" ? "middle" : "start"}
        fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontWeight={700}
        fontSize={brandFont}
        fill={t.accent}
        letterSpacing={brandFont * 0.15}
      >
        ZEBVIX · PAY-ID
      </text>

      {/* Big Pay-ID handle */}
      <text
        x={textAlign === "center" ? W / 2 : textX}
        y={textPayIdY}
        textAnchor={textAlign === "center" ? "middle" : "start"}
        fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace"
        fontWeight={800}
        fontSize={payIdFont}
        fill={t.text}
      >
        {payId}
      </text>

      {/* Tagline */}
      {tagline && (
        <text
          x={textAlign === "center" ? W / 2 : textX}
          y={textTaglineY}
          textAnchor={textAlign === "center" ? "middle" : "start"}
          fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          fontWeight={500}
          fontSize={taglineFont}
          fill={t.textMuted}
        >
          {tagline}
        </text>
      )}

      {/* Address (truncated for the wide layout, full for square/story) */}
      {showAddress && (
        <text
          x={textAlign === "center" ? W / 2 : textX}
          y={textAddressY}
          textAnchor={textAlign === "center" ? "middle" : "start"}
          fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace"
          fontWeight={400}
          fontSize={addressFont}
          fill={t.textMuted}
        >
          {size === "wide" ? shortAddr(address, 10) : address}
        </text>
      )}

      {/* Footer */}
      <text
        x={textAlign === "center" ? W / 2 : textX}
        y={textFooterY}
        textAnchor={textAlign === "center" ? "middle" : "start"}
        fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontWeight={500}
        fontSize={footerFont}
        fill={t.textMuted}
        letterSpacing={footerFont * 0.05}
      >
        ZBX MAINNET · PERMANENT ON-CHAIN IDENTITY
      </text>

      {/* QR card — white pad behind QR for max contrast */}
      <rect
        x={qrX - 24}
        y={qrY - 24}
        width={qrSize + 48}
        height={qrSize + 48}
        rx={20}
        fill={t.qrBg}
        stroke={t.accent}
        strokeWidth={3}
      />

      {/* QR */}
      <g transform={`translate(${qrX}, ${qrY})`}>
        <QRCodeSVG
          value={uri}
          size={qrSize}
          level="M"
          bgColor={t.qrBg}
          fgColor={t.qrFg}
          includeMargin={false}
        />
      </g>
    </svg>
  );
});

// ───────────────────────────────────────────────────────────────────────────
// TAB: Bulk Resolve
// ───────────────────────────────────────────────────────────────────────────

function BulkPanel(props: {
  onCopy: (s: string, label?: string) => void;
  onLog: (msg: string, tone?: "info" | "ok" | "warn" | "err") => void;
  onPushHistory: (entry: ResolverHistoryEntry) => void;
  onJumpToResolver: (kind: ResolverKind, value: string) => void;
}) {
  const { onCopy, onLog, onPushHistory, onJumpToResolver } = props;
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BulkResultRow[]>([]);
  const [running, setRunning] = useState(false);
  const seqRef = useRef(0);
  const [hideAddresses, setHideAddresses] = useState(false);

  const candidates = useMemo(() => {
    return Array.from(
      new Set(
        text
          .split(/[\s,;\n\r]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ).slice(0, BULK_MAX);
  }, [text]);

  const tooMany = useMemo(() => {
    const all = text.split(/[\s,;\n\r]+/).map((x) => x.trim()).filter(Boolean);
    return all.length > BULK_MAX;
  }, [text]);

  const run = useCallback(async () => {
    if (!candidates.length) return;
    const seq = ++seqRef.current;
    setRunning(true);
    setRows(
      candidates.map((c) => ({
        raw: c,
        canonical: canonicalisePayId(c),
        state: canonicalisePayId(c) ? "pending" : "invalid",
      })),
    );
    onLog(`Bulk resolve: ${candidates.length} candidates`, "info");

    const work = candidates.map(async (c, idx) => {
      const canonical = canonicalisePayId(c);
      if (!canonical) return { idx, row: { raw: c, canonical: null, state: "invalid" as const } };
      try {
        const rec = await lookupPayIdForward(canonical);
        if (rec?.address) {
          return {
            idx,
            row: {
              raw: c,
              canonical,
              state: "found" as const,
              address: rec.address,
              name: rec.name ?? null,
            },
          };
        }
        return {
          idx,
          row: { raw: c, canonical, state: "missing" as const },
        };
      } catch (e) {
        return {
          idx,
          row: {
            raw: c,
            canonical,
            state: "error" as const,
            error: scrubSecrets(e instanceof Error ? e.message : String(e)),
          },
        };
      }
    });

    const out = await Promise.all(work);
    if (seq !== seqRef.current) return;

    setRows((prev) => {
      const next = [...prev];
      for (const r of out) next[r.idx] = r.row;
      return next;
    });

    let found = 0;
    let missing = 0;
    let invalid = 0;
    for (const r of out) {
      if (r.row.state === "found") found++;
      else if (r.row.state === "missing") missing++;
      else if (r.row.state === "invalid") invalid++;
      if (r.row.canonical) {
        onPushHistory({
          ts: Date.now(),
          kind: "forward",
          query: r.row.canonical,
          result: r.row.state === "found" ? r.row.address ?? null : null,
          name: r.row.state === "found" ? r.row.name ?? null : null,
        });
      }
    }
    onLog(
      `Bulk done — found ${found}, missing ${missing}, invalid ${invalid}`,
      found > 0 ? "ok" : "warn",
    );
    setRunning(false);
  }, [candidates, onLog, onPushHistory]);

  const exportCsv = useCallback(() => {
    if (!rows.length) return;
    const header = ["pay_id", "state", "address", "display_name"].join(",");
    const lines = rows.map((r) =>
      [
        csvCell(r.canonical ?? r.raw),
        csvCell(r.state),
        csvCell(r.address ?? ""),
        csvCell(r.name ?? ""),
      ].join(","),
    );
    const blob = new Blob([header + "\r\n" + lines.join("\r\n") + "\r\n"], {
      type: "text/csv;charset=utf-8",
    });
    triggerDownload(blob, `payid-bulk-${Date.now()}.csv`);
    onLog(`Exported ${rows.length}-row CSV`, "ok");
  }, [rows, onLog]);

  const exportJson = useCallback(() => {
    if (!rows.length) return;
    const safe = rows.map((r) => ({
      pay_id: r.canonical ?? r.raw,
      state: r.state,
      address: r.address ?? null,
      display_name: r.name ?? null,
    }));
    const blob = new Blob([JSON.stringify(safe, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    triggerDownload(blob, `payid-bulk-${Date.now()}.json`);
    onLog(`Exported ${rows.length}-row JSON`, "ok");
  }, [rows, onLog]);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Bulk Pay-ID resolver"
        subtitle={`Up to ${BULK_MAX} handles per batch`}
        icon={ListChecks}
      >
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"alice\nbob\ncharlie@zbx\n…"}
            className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="input-bulk"
            aria-label="Pay-ID candidates, one per line"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span data-testid="text-bulk-count">
                {candidates.length} unique candidate{candidates.length === 1 ? "" : "s"}
              </span>
              {tooMany && (
                <span className="text-amber-300">
                  Trimmed to {BULK_MAX} — paste fewer at a time.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setText("");
                  setRows([]);
                }}
                disabled={running || (!text && !rows.length)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-bulk-clear"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
              <button
                onClick={run}
                disabled={running || !candidates.length}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-bulk-run"
              >
                {running ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <ScanLine className="h-3 w-3" />
                )}
                Run resolve
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {rows.length > 0 && (
        <SectionCard
          title="Results"
          subtitle={`${rows.length} row${rows.length === 1 ? "" : "s"}`}
          icon={Database}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <button
                onClick={() => setHideAddresses((v) => !v)}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                data-testid="button-toggle-bulk-addr"
                aria-pressed={hideAddresses}
              >
                {hideAddresses ? (
                  <>
                    <Eye className="h-3 w-3" />
                    Show addresses
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3 w-3" />
                    Hide addresses
                  </>
                )}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportCsv}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-muted/40"
                  data-testid="button-bulk-csv"
                >
                  <Download className="h-3 w-3" />
                  CSV
                </button>
                <button
                  onClick={exportJson}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-muted/40"
                  data-testid="button-bulk-json"
                >
                  <Download className="h-3 w-3" />
                  JSON
                </button>
              </div>
            </div>

            <div className="overflow-auto rounded-md border border-border/60">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/30 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">Pay-ID</th>
                    <th className="px-2.5 py-1.5 font-medium">State</th>
                    <th className="px-2.5 py-1.5 font-medium">Address</th>
                    <th className="px-2.5 py-1.5 font-medium">Display name</th>
                    <th className="px-2.5 py-1.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.raw}-${i}`}
                      className="border-t border-border/40"
                      data-testid={`row-bulk-${i}`}
                    >
                      <td className="px-2.5 py-1.5 font-mono">
                        {r.canonical ?? r.raw}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <BulkStatePill state={r.state} />
                      </td>
                      <td className="px-2.5 py-1.5 font-mono">
                        {r.address ? (
                          hideAddresses ? (
                            <span className="text-muted-foreground">•••</span>
                          ) : (
                            <span className="text-emerald-300">{shortAddr(r.address)}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {r.name ? (
                          <span>{r.name}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {r.canonical && (
                            <button
                              onClick={() =>
                                onJumpToResolver("forward", r.canonical!.replace(/@zbx$/, ""))
                              }
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Open in resolver"
                              data-testid={`button-bulk-open-${i}`}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                          {r.address && (
                            <button
                              onClick={() => onCopy(r.address!)}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Copy address"
                              data-testid={`button-bulk-copy-${i}`}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function BulkStatePill({ state }: { state: BulkResultRow["state"] }) {
  const map: Record<BulkResultRow["state"], { cls: string; label: string }> = {
    pending: {
      cls: "border-muted-foreground/40 text-muted-foreground bg-muted/20",
      label: "checking",
    },
    found: {
      cls: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
      label: "found",
    },
    missing: {
      cls: "border-amber-500/40 text-amber-300 bg-amber-500/10",
      label: "unregistered",
    },
    invalid: {
      cls: "border-red-500/40 text-red-300 bg-red-500/10",
      label: "invalid",
    },
    error: {
      cls: "border-red-500/40 text-red-300 bg-red-500/10",
      label: "error",
    },
  };
  const v = map[state];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${v.cls}`}
      data-testid={`pill-bulk-${state}`}
    >
      {v.label}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// TAB: Recent (history)
// ───────────────────────────────────────────────────────────────────────────

function HistoryPanel(props: {
  entries: ResolverHistoryEntry[];
  onCopy: (s: string, label?: string) => void;
  onClear: () => void;
  onJumpToResolver: (kind: ResolverKind, value: string) => void;
}) {
  const { entries, onCopy, onClear, onJumpToResolver } = props;
  const [showSecrets, setShowSecrets] = useState(false);
  const now = Date.now();

  if (!entries.length) {
    return (
      <SectionCard title="Recent lookups" icon={Database}>
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground py-4"
          data-testid="text-history-empty"
        >
          <Inbox className="h-4 w-4" />
          No lookups recorded on this device yet. Try the Resolver tab.
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Recent lookups"
      subtitle={`${entries.length} entr${entries.length === 1 ? "y" : "ies"} on this device`}
      icon={Database}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <button
            onClick={() => setShowSecrets((v) => !v)}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            data-testid="button-toggle-history-detail"
            aria-pressed={showSecrets}
          >
            {showSecrets ? (
              <>
                <EyeOff className="h-3 w-3" />
                Hide full addresses
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" />
                Show full addresses
              </>
            )}
          </button>
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1.5 text-red-300 hover:bg-red-500/10"
            data-testid="button-clear-history"
          >
            <Trash2 className="h-3 w-3" />
            Clear all
          </button>
        </div>

        <div className="overflow-auto rounded-md border border-border/60">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">When</th>
                <th className="px-2.5 py-1.5 font-medium">Kind</th>
                <th className="px-2.5 py-1.5 font-medium">Query</th>
                <th className="px-2.5 py-1.5 font-medium">Result</th>
                <th className="px-2.5 py-1.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={`${e.ts}-${i}`}
                  className="border-t border-border/40"
                  data-testid={`row-history-${i}`}
                >
                  <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">
                    {formatRelative(e.ts, now)}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        e.kind === "forward"
                          ? "border-primary/40 text-primary bg-primary/10"
                          : "border-purple-500/40 text-purple-300 bg-purple-500/10"
                      }`}
                    >
                      {e.kind}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 font-mono break-all">
                    {e.kind === "reverse" && !showSecrets
                      ? shortAddr(e.query)
                      : e.query}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono break-all">
                    {e.result == null ? (
                      <span className="text-amber-300">not found</span>
                    ) : e.kind === "forward" && !showSecrets ? (
                      <span className="text-emerald-300">{shortAddr(e.result)}</span>
                    ) : (
                      <span
                        className={
                          e.kind === "forward"
                            ? "text-emerald-300"
                            : "text-primary"
                        }
                      >
                        {e.result}
                      </span>
                    )}
                    {e.name && (
                      <span className="ml-1 text-muted-foreground">· {e.name}</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (e.kind === "forward") {
                            onJumpToResolver("forward", e.query.replace(/@zbx$/, ""));
                          } else {
                            onJumpToResolver("reverse", e.query);
                          }
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Re-run lookup"
                        data-testid={`button-history-rerun-${i}`}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                      {e.result && (
                        <button
                          onClick={() => onCopy(e.result!)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Copy result"
                          data-testid={`button-history-copy-${i}`}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-[10px] text-muted-foreground">
          History is stored locally on this device only — never sent to a server.
          Schema: timestamp, kind, query, result, optional display name. No
          private keys, mnemonics, or signing material.
        </div>
      </div>
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SIDEBAR
// ───────────────────────────────────────────────────────────────────────────

function ActiveWalletCard(props: {
  address: string | null;
  label: string | null;
  kind: string | null;
  myPayId: string | null;
  myLoading: boolean;
  onRefresh: () => void;
  onCopy: (s: string, label?: string) => void;
}) {
  const { address, label, kind, myPayId, myLoading, onRefresh, onCopy } = props;
  return (
    <SectionCard title="Active wallet" icon={WalletIcon}>
      {address ? (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div
                className="truncate font-medium text-foreground"
                data-testid="sidebar-wallet-label"
              >
                {label ?? "Wallet"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Source: {kind ?? "local"}
              </div>
            </div>
            <button
              onClick={onRefresh}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Refresh Pay-ID"
              data-testid="button-sidebar-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${myLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <button
            onClick={() => onCopy(address, "Address copied")}
            className="w-full text-left rounded-md bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] break-all hover:bg-muted/50"
            data-testid="sidebar-wallet-address"
          >
            {address}
          </button>
          <div className="rounded-md border border-border/60 bg-card/40 p-2.5 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Pay-ID
            </div>
            {myLoading ? (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Resolving…
              </div>
            ) : myPayId ? (
              <button
                onClick={() => onCopy(myPayId)}
                className="font-mono text-primary hover:underline"
                data-testid="sidebar-my-payid"
              >
                {myPayId}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Not registered</span>
                <Link href="/payid-register">
                  <button className="text-[10px] text-primary underline">
                    Register
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Connect a wallet to auto-resolve your Pay-ID and unlock the card studio.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/wallet">
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                data-testid="sidebar-button-wallet"
              >
                Open wallet
              </button>
            </Link>
            <Link href="/import-wallet">
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted/40"
                data-testid="sidebar-button-import"
              >
                Import
              </button>
            </Link>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function NetworkInfoCard(props: { count: number | null; onRefresh: () => void }) {
  const { count, onRefresh } = props;
  return (
    <SectionCard title="Network" icon={Globe}>
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Total registered</span>
          <span className="font-mono font-semibold text-foreground" data-testid="sidebar-count">
            {count ?? "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Format</span>
          <span className="font-mono text-foreground">handle@zbx</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Mutability</span>
          <span className="text-amber-300 font-medium">Permanent</span>
        </div>
        <button
          onClick={onRefresh}
          className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          data-testid="sidebar-refresh-net"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>
    </SectionCard>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <SectionCard
      title="How it works"
      icon={ShieldCheck}
      right={
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          data-testid="button-howitworks-toggle"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      }
    >
      {open && (
        <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-muted-foreground">
          <li>
            <strong className="text-foreground">Forward</strong> calls{" "}
            <code className="font-mono">zbx_lookupPayId</code> to map a handle to
            its on-chain address.
          </li>
          <li>
            <strong className="text-foreground">Reverse</strong> calls{" "}
            <code className="font-mono">zbx_getPayIdOf</code> to map an address
            back to the handle (if any).
          </li>
          <li>
            <strong className="text-foreground">Bulk</strong> dispatches all
            forward lookups in parallel via{" "}
            <code className="font-mono">Promise.all</code>.
          </li>
          <li>
            <strong className="text-foreground">QR &amp; Banner</strong> encode a
            portable URI <code className="font-mono">payid:handle@zbx?address=…</code>
            so any wallet that speaks the scheme can pay you instantly.
          </li>
          <li>
            All lookups are <strong className="text-foreground">read-only</strong>
            — your private key is never accessed by this page.
          </li>
        </ol>
      )}
    </SectionCard>
  );
}

function ActivityLog(props: {
  entries: { ts: number; msg: string; tone: "info" | "ok" | "warn" | "err" }[];
}) {
  const { entries } = props;
  const now = Date.now();
  return (
    <SectionCard
      title="Activity"
      icon={Activity}
      subtitle={`${entries.length} event${entries.length === 1 ? "" : "s"}`}
    >
      {entries.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          Lookups and exports will appear here.
        </div>
      ) : (
        <ul className="space-y-1 text-[11px] max-h-64 overflow-auto">
          {entries.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="flex items-start gap-2">
              <span
                className={`mt-1 inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                  e.tone === "ok"
                    ? "bg-emerald-400"
                    : e.tone === "warn"
                      ? "bg-amber-300"
                      : e.tone === "err"
                        ? "bg-red-400"
                        : "bg-muted-foreground"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="break-words text-muted-foreground">{e.msg}</div>
                <div className="text-[9px] text-muted-foreground/70">
                  {formatRelative(e.ts, now)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Small reusable components
// ───────────────────────────────────────────────────────────────────────────

function TabBtn(props: {
  tabId: string;
  panelId: string;
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  testid: string;
}) {
  const { tabId, panelId, active, onClick, icon: Icon, label, testid } = props;
  return (
    <button
      id={tabId}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-primary/50 ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ResultRow(props: {
  label: string;
  value: React.ReactNode;
  onCopy?: () => void;
}) {
  const { label, value, onCopy } = props;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">{value}</div>
        {onCopy && (
          <button
            onClick={onCopy}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
