import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AtSign,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Wallet as WalletIcon,
  Sparkles,
  ArrowRight,
  ExternalLink,
  Copy,
  Info,
  Search,
  ListChecks,
  History as HistoryIcon,
  RefreshCw,
  Send,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
  Activity,
  HelpCircle,
  Zap,
  Hash,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard, Stat } from "@/components/ui/section-card";
import { useWallet } from "@/contexts/wallet-context";
import { isVaultNotReady, type StoredWallet } from "@/lib/web-wallet";
import { useToast } from "@/hooks/use-toast";
import {
  validatePayIdInput,
  validatePayIdName,
  lookupPayIdForward,
  payIdCount,
  registerPayId,
  lookupPayIdReverse,
  type PayIdRecord,
} from "@/lib/payid";
import {
  rpc,
  weiHexToZbx,
  shortAddr,
  pollReceipt,
  getRecommendedFeeWei,
} from "@/lib/zbx-rpc";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AvailState = "idle" | "checking" | "available" | "taken" | "invalid" | "error";
type TabId = "register" | "scout" | "reverse" | "history";

interface PayIdHistoryEntry {
  hash: string;
  payId: string;
  address: string;
  timestamp: number;
  status: "pending" | "confirmed" | "reverted" | "unknown";
}

interface ScoutRow {
  raw: string;
  canonical: string | null;
  state: AvailState;
  reason?: string;
  record?: PayIdRecord | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_KEY = "zbx:payid:history:v1";
const HISTORY_MAX = 50;
const REGISTER_FEE_ZBX = "0.002";
const REGISTER_FEE_WEI_MIN = 2_000_000_000_000_000n; // 0.002 ZBX in wei
const HANDLE_RE = /^[a-z0-9_]{3,25}$/;

// Some commonly-grabbed handles people might mistakenly try.  Purely a hint —
// the chain remains source of truth (live availability check still runs).
const RESERVED_HINT = new Set([
  "admin", "root", "support", "system", "zebvix", "zbx", "team",
  "official", "satoshi", "vitalik", "test",
]);

// ─────────────────────────────────────────────────────────────────────────────
// History (localStorage — hashes only, NEVER any secret material)
// ─────────────────────────────────────────────────────────────────────────────

function loadHistory(): PayIdHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is PayIdHistoryEntry =>
          x &&
          typeof x.hash === "string" &&
          typeof x.payId === "string" &&
          typeof x.address === "string" &&
          typeof x.timestamp === "number",
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(entries: PayIdHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // quota / private mode — silent fail OK; history is best-effort UX
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestion engine — generate plausible alternates for a taken handle
// ─────────────────────────────────────────────────────────────────────────────

function generateSuggestions(handle: string, max = 8): string[] {
  if (!HANDLE_RE.test(handle)) return [];
  const out = new Set<string>();
  // numeric suffixes
  for (const n of [1, 2, 7, 9, 21, 99, 2026]) {
    const s = `${handle}${n}`;
    if (HANDLE_RE.test(s)) out.add(s);
  }
  // underscore variants
  if (HANDLE_RE.test(`${handle}_`)) out.add(`${handle}_`);
  if (HANDLE_RE.test(`_${handle}`)) out.add(`_${handle}`);
  // letter suffix
  for (const ch of ["x", "z", "_zbx", "_eth"]) {
    const s = `${handle}${ch}`;
    if (HANDLE_RE.test(s)) out.add(s);
  }
  return Array.from(out).slice(0, max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Race-safe live ZBX balance hook (per-address, monotonic seq guard)
// ─────────────────────────────────────────────────────────────────────────────

function useLiveBalance(address: string | null) {
  const [bal, setBal] = useState<string>("—");
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const ctrlRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setBal("—");
      return;
    }
    const my = ++seqRef.current;
    if (ctrlRef.current) ctrlRef.current.abort();
    ctrlRef.current = new AbortController();
    setLoading(true);
    try {
      const hex = await rpc<string>("zbx_getBalance", [address]);
      if (my !== seqRef.current) return;
      setBal(weiHexToZbx(hex));
    } catch {
      if (my !== seqRef.current) return;
      setBal("—");
    } finally {
      if (my === seqRef.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      clearInterval(id);
      if (ctrlRef.current) ctrlRef.current.abort();
    };
  }, [refresh]);

  return { bal, loading, refresh };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommended-fee hook (auto-refresh every 60s)
// ─────────────────────────────────────────────────────────────────────────────

function useRecommendedFee() {
  const [feeZbx, setFeeZbx] = useState<string>("0.002");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const wei = await getRecommendedFeeWei();
      // floor against 0.002 minimum — registration cost is fixed network fee
      const effective = wei < REGISTER_FEE_WEI_MIN ? REGISTER_FEE_WEI_MIN : wei;
      setFeeZbx(weiHexToZbx("0x" + effective.toString(16)));
    } catch {
      setFeeZbx("0.002");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);
  return { feeZbx, loading, refresh };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PayIdRegister() {
  const { active, wallets, setActive, addGenerated, vaultReady, vaultState } = useWallet();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [tab, setTab] = useState<TabId>("register");

  // Counters
  const [total, setTotal] = useState<number | null>(null);
  const refreshCounters = useCallback(() => {
    payIdCount().then((n) => setTotal(n)).catch(() => setTotal(null));
  }, []);
  useEffect(() => {
    refreshCounters();
    const id = setInterval(refreshCounters, 30_000);
    return () => clearInterval(id);
  }, [refreshCounters]);

  // Active wallet balance + reverse lookup for the active address
  const { bal, refresh: refreshBal } = useLiveBalance(active?.address ?? null);
  const [existingPayId, setExistingPayId] = useState<string | null>(null);
  const [existingChecking, setExistingChecking] = useState(false);
  useEffect(() => {
    if (!active) {
      setExistingPayId(null);
      return;
    }
    let cancelled = false;
    setExistingChecking(true);
    lookupPayIdReverse(active.address)
      .then((rec) => !cancelled && setExistingPayId(rec?.pay_id ?? null))
      .catch(() => !cancelled && setExistingPayId(null))
      .finally(() => !cancelled && setExistingChecking(false));
    return () => {
      cancelled = true;
    };
  }, [active]);

  // History
  const [history, setHistory] = useState<PayIdHistoryEntry[]>(() => loadHistory());
  const pushHistory = useCallback((entry: PayIdHistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((p) => p.hash !== entry.hash)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }, []);
  const updateHistoryStatus = useCallback(
    (hash: string, status: PayIdHistoryEntry["status"]) => {
      setHistory((prev) => {
        const next = prev.map((p) => (p.hash === hash ? { ...p, status } : p));
        saveHistory(next);
        return next;
      });
    },
    [],
  );
  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  // Recommended fee
  const { feeZbx, refresh: refreshFee } = useRecommendedFee();

  // Wallet setup helper
  const generateOrRedirect = useCallback(() => {
    if (!vaultReady) {
      const dest =
        vaultState === "missing"
          ? "/wallet?tab=manage&gate=create"
          : "/wallet";
      toast({
        title:
          vaultState === "missing"
            ? "Set a wallet password first"
            : "Unlock your wallet vault",
        description:
          vaultState === "missing"
            ? "Encryption is on by default — opening the wallet page so you can set a password."
            : "Opening the wallet page so you can unlock your encrypted vault.",
      });
      navigate(dest);
      return;
    }
    try {
      addGenerated();
    } catch (e) {
      if (isVaultNotReady(e)) {
        generateOrRedirect();
        return;
      }
      toast({
        title: "Wallet creation failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }, [vaultReady, vaultState, addGenerated, navigate, toast]);

  // Activity log (in-page, ephemeral). Every message is scrubbed of any
  // private-key / mnemonic-shaped runs as a defense-in-depth measure.
  const [activity, setActivity] = useState<{ ts: number; msg: string; tone: "info" | "ok" | "warn" | "err" }[]>([]);
  const log = useCallback(
    (msg: string, tone: "info" | "ok" | "warn" | "err" = "info") => {
      const safe = scrubSecrets(msg);
      setActivity((prev) => [{ ts: Date.now(), msg: safe, tone }, ...prev].slice(0, 25));
    },
    [],
  );

  function copy(text: string, label = "Copied") {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: label }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">On-chain</Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">Live</Badge>
          <Badge variant="outline" className="text-amber-300 border-amber-500/40">Permanent</Badge>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <UserPlusIcon className="w-7 h-7 text-primary" />
            Register Pay-ID
          </h1>
          <div className="flex items-center gap-2">
            <Link href="/payid-resolver">
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40"
                data-testid="link-resolver"
              >
                <AtSign className="h-3.5 w-3.5 text-primary" />
                Resolver
                <ArrowRight className="h-3 w-3 opacity-60" />
              </button>
            </Link>
            <Link href="/import-wallet">
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40"
                data-testid="link-import"
              >
                <WalletIcon className="h-3.5 w-3.5 text-primary" />
                Wallets
                <ArrowRight className="h-3 w-3 opacity-60" />
              </button>
            </Link>
          </div>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Claim a permanent human-readable handle (
          <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">handle@zbx</code>
          ) for your address. One Pay-ID per address — once set it is forever bound to that wallet.
        </p>
      </div>

      {/* Counter strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total Registered" value={total ?? "—"} accent="primary" icon={AtSign} />
        <Stat label="Network Fee" value={feeZbx} hint="ZBX (one-time)" icon={Zap} />
        <Stat
          label="Mutability"
          value="Permanent"
          hint="One Pay-ID per address"
          accent="warn"
          icon={ShieldAlert}
        />
        <Stat
          label="History (this device)"
          value={history.length}
          hint={history.length ? "Includes pending + confirmed" : "No registrations yet"}
          icon={HistoryIcon}
        />
      </div>

      {/* Main + sidebar */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ─── MAIN ───────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Pay-ID workbench"
            className="flex flex-wrap gap-2"
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
              const order: TabId[] = ["register", "scout", "reverse", "history"];
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
                // Move focus to the newly-active tab so subsequent arrows continue working.
                requestAnimationFrame(() => {
                  const el = document.getElementById(`tab-${order[next]}`);
                  if (el instanceof HTMLElement) el.focus();
                });
              }
            }}
          >
            <TabBtn
              active={tab === "register"}
              onClick={() => setTab("register")}
              icon={UserPlusIcon}
              testId="tab-register"
              tabId="tab-register"
              panelId="panel-register"
            >
              Register
            </TabBtn>
            <TabBtn
              active={tab === "scout"}
              onClick={() => setTab("scout")}
              icon={ListChecks}
              testId="tab-scout"
              tabId="tab-scout"
              panelId="panel-scout"
            >
              Bulk Scout
            </TabBtn>
            <TabBtn
              active={tab === "reverse"}
              onClick={() => setTab("reverse")}
              icon={Search}
              testId="tab-reverse"
              tabId="tab-reverse"
              panelId="panel-reverse"
            >
              Reverse Lookup
            </TabBtn>
            <TabBtn
              active={tab === "history"}
              onClick={() => setTab("history")}
              icon={HistoryIcon}
              testId="tab-history"
              tabId="tab-history"
              panelId="panel-history"
            >
              History {history.length > 0 && <span className="ml-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-mono text-primary">{history.length}</span>}
            </TabBtn>
          </div>

          {/* ─ Register tab ─ */}
          {tab === "register" && (
            <div role="tabpanel" id="panel-register" aria-labelledby="tab-register" className="space-y-6">
              <RegisterPanel
                wallets={wallets}
                active={active}
                bal={bal}
                existingPayId={existingPayId}
                existingChecking={existingChecking}
                feeZbx={feeZbx}
                onCopy={copy}
                onLog={log}
                onRefreshBal={refreshBal}
                onRefreshFee={refreshFee}
                onPushHistory={pushHistory}
                onUpdateHistoryStatus={updateHistoryStatus}
                onSwitchWallet={setActive}
                onGenerate={generateOrRedirect}
              />
            </div>
          )}

          {/* ─ Scout tab ─ */}
          {tab === "scout" && (
            <div role="tabpanel" id="panel-scout" aria-labelledby="tab-scout">
              <ScoutPanel onLog={log} onCopy={copy} onClaim={(h) => { setTab("register"); setTimeout(() => log(`Loaded "${h}" into Register tab`, "info"), 50); }} preloadHandles={[]} setRegisterHandle={() => undefined} />
            </div>
          )}

          {/* ─ Reverse lookup tab ─ */}
          {tab === "reverse" && (
            <div role="tabpanel" id="panel-reverse" aria-labelledby="tab-reverse">
              <ReversePanel onCopy={copy} onLog={log} />
            </div>
          )}

          {/* ─ History tab ─ */}
          {tab === "history" && (
            <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
              <HistoryPanel
                history={history}
                onCopy={copy}
                onClear={clearHistory}
                onUpdateStatus={updateHistoryStatus}
              />
            </div>
          )}
        </div>

        {/* ─── SIDEBAR ───────────────────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <SectionCard title="Active wallet" icon={WalletIcon} tone={active ? "primary" : "warn"}>
            {!active ? (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  No wallet is active. Generate a fresh wallet (you can fund it later) or import an existing key.
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={generateOrRedirect}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    data-testid="button-generate"
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate test wallet
                  </button>
                  <Link href="/import-wallet">
                    <button className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-primary/40">
                      Import existing
                    </button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Label</div>
                  <div className="mt-0.5 text-sm font-semibold text-foreground" data-testid="sidebar-wallet-label">
                    {active.label}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Address</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <code className="flex-1 truncate font-mono text-foreground" data-testid="sidebar-wallet-address">
                      {active.address}
                    </code>
                    <button
                      onClick={() => copy(active.address, "Address copied")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Copy address"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border/60 bg-card/40 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</div>
                    <div className="mt-0.5 flex items-center gap-1 font-mono text-base font-semibold text-foreground" data-testid="sidebar-wallet-balance">
                      {bal}
                      <span className="text-xs text-muted-foreground">ZBX</span>
                    </div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-card/40 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</div>
                    <div className="mt-0.5 text-xs font-medium text-foreground capitalize">{active.kind}</div>
                  </div>
                </div>
                {existingPayId ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-emerald-200">
                    <div className="text-[10px] uppercase tracking-wider opacity-80">Current Pay-ID</div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 truncate font-mono text-sm font-semibold" data-testid="sidebar-existing-payid">
                        {existingPayId}
                      </code>
                      <button
                        onClick={() => copy(existingPayId, "Pay-ID copied")}
                        className="rounded p-1 hover:bg-emerald-500/20"
                        aria-label="Copy Pay-ID"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ) : existingChecking ? (
                  <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/40 p-2 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking existing Pay-ID…
                  </div>
                ) : (
                  <div className="rounded-md border border-border/60 bg-card/40 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Pay-ID</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">None — eligible to register</div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={refreshBal}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground hover:border-primary/40"
                    data-testid="button-refresh-balance"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Refresh
                  </button>
                  <Link href="/wallet">
                    <button className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground hover:border-primary/40">
                      Manage
                    </button>
                  </Link>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Vault status"
            icon={vaultReady ? ShieldCheck : ShieldAlert}
            tone={vaultReady ? "success" : "warn"}
          >
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">State</span>
                <span className={`font-semibold ${vaultReady ? "text-emerald-300" : "text-amber-300"}`} data-testid="sidebar-vault-state">
                  {vaultState}
                </span>
              </div>
              {!vaultReady && (
                <Link href={vaultState === "missing" ? "/wallet?tab=manage&gate=create" : "/wallet"}>
                  <button className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/10">
                    {vaultState === "missing" ? "Set vault password" : "Unlock vault"}
                  </button>
                </Link>
              )}
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Keys are AES-GCM encrypted under your password before being written to local storage.
              </p>
            </div>
          </SectionCard>

          <HowItWorks />

          {activity.length > 0 && (
            <SectionCard title="Activity" icon={Activity}>
              <div className="space-y-1.5 text-[11px]">
                {activity.map((a, i) => (
                  <div
                    key={`${a.ts}-${i}`}
                    className={`flex items-start gap-2 rounded border border-border/40 bg-card/40 px-2 py-1.5 ${
                      a.tone === "ok" ? "text-emerald-300" :
                      a.tone === "warn" ? "text-amber-300" :
                      a.tone === "err" ? "text-red-400" :
                      "text-muted-foreground"
                    }`}
                  >
                    <span className="mt-0.5 font-mono text-[10px] opacity-60 shrink-0">
                      {new Date(a.ts).toLocaleTimeString()}
                    </span>
                    <span className="break-all">{a.msg}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Register panel (the core flow)
// ─────────────────────────────────────────────────────────────────────────────

interface RegisterPanelProps {
  wallets: StoredWallet[];
  active: ReturnType<typeof useWallet>["active"];
  bal: string;
  existingPayId: string | null;
  existingChecking: boolean;
  feeZbx: string;
  onCopy: (text: string, label?: string) => void;
  onLog: (msg: string, tone?: "info" | "ok" | "warn" | "err") => void;
  onRefreshBal: () => void;
  onRefreshFee: () => void;
  onPushHistory: (e: PayIdHistoryEntry) => void;
  onUpdateHistoryStatus: (hash: string, status: PayIdHistoryEntry["status"]) => void;
  onSwitchWallet: (addr: string | null) => void;
  onGenerate: () => void;
}

function RegisterPanel({
  wallets,
  active,
  bal,
  existingPayId,
  existingChecking,
  feeZbx,
  onCopy,
  onLog,
  onRefreshBal,
  onPushHistory,
  onUpdateHistoryStatus,
  onSwitchWallet,
  onGenerate,
}: RegisterPanelProps) {
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [avail, setAvail] = useState<AvailState>("idle");
  const [reason, setReason] = useState<string>("");
  const [suggestions, setSuggestions] = useState<{ handle: string; state: AvailState }[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<"pending" | "confirmed" | "reverted" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  const idCheck = useMemo(() => validatePayIdInput(handle), [handle]);
  const nameCheck = useMemo(() => validatePayIdName(name || " "), [name]);
  const canonical = idCheck.canonical;

  const isReservedHint = useMemo(
    () => !!idCheck.canonical && RESERVED_HINT.has(idCheck.canonical.replace("@zbx", "")),
    [idCheck.canonical],
  );

  // Live availability with race-safe seq + debounced.
  useEffect(() => {
    if (!handle.trim()) {
      setAvail("idle");
      setReason("");
      setSuggestions([]);
      return;
    }
    if (!idCheck.ok || !idCheck.canonical) {
      setAvail("invalid");
      setReason(idCheck.reason ?? "invalid");
      setSuggestions([]);
      return;
    }
    setAvail("checking");
    setReason("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const my = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const rec = await lookupPayIdForward(idCheck.canonical!);
        if (my !== seqRef.current) return;
        if (!rec?.address) {
          setAvail("available");
          setSuggestions([]);
        } else {
          setAvail("taken");
          // Spin up suggestion check
          const base = idCheck.canonical!.replace("@zbx", "");
          const sugs = generateSuggestions(base);
          setSuggestions(sugs.map((h) => ({ handle: h, state: "checking" as AvailState })));
          // Check each in parallel; ignore stale results.
          const localSeq = my;
          await Promise.all(
            sugs.map(async (h) => {
              try {
                const r = await lookupPayIdForward(`${h}@zbx`);
                if (localSeq !== seqRef.current) return;
                setSuggestions((prev) =>
                  prev.map((p) =>
                    p.handle === h
                      ? { handle: h, state: r?.address ? "taken" : "available" }
                      : p,
                  ),
                );
              } catch {
                if (localSeq !== seqRef.current) return;
                setSuggestions((prev) =>
                  prev.map((p) => (p.handle === h ? { handle: h, state: "error" } : p)),
                );
              }
            }),
          );
        }
      } catch (e) {
        if (my !== seqRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (/not\s*(registered|found)|unknown|does\s*not\s*exist/i.test(msg)) {
          setAvail("available");
          setSuggestions([]);
        } else {
          setAvail("error");
          setReason(`network error: ${msg}`);
          setSuggestions([]);
        }
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [handle, idCheck]);

  const balNum = useMemo(() => {
    const n = Number(bal);
    return Number.isFinite(n) ? n : null;
  }, [bal]);
  const feeNum = useMemo(() => {
    const n = Number(feeZbx);
    return Number.isFinite(n) ? n : 0.002;
  }, [feeZbx]);
  const balanceOk = balNum !== null && balNum >= feeNum;

  const isRemote = active?.kind === "remote";
  const checklist = useMemo(() => ([
    { label: "Wallet connected", ok: !!active, hint: active ? active.label : "Pick or generate a wallet" },
    { label: "Local signing key", ok: !!active && !isRemote, hint: isRemote ? "Mobile-paired wallets cannot sign Pay-ID registrations from this page" : "Required for client-side signing" },
    { label: "No existing Pay-ID", ok: !!active && !existingPayId && !existingChecking, hint: existingChecking ? "Checking…" : existingPayId ? `Already has ${existingPayId}` : "Address is eligible" },
    { label: "Sufficient balance", ok: balanceOk, hint: balNum === null ? "Loading…" : `${bal} ZBX available · need ${feeZbx}` },
    { label: "Valid handle", ok: idCheck.ok, hint: idCheck.ok ? canonical ?? "" : (idCheck.reason ?? "invalid") },
    { label: "Available on-chain", ok: avail === "available", hint:
      avail === "available" ? "Free to claim"
      : avail === "checking" ? "Checking…"
      : avail === "taken" ? "Already taken"
      : avail === "invalid" ? (reason || "invalid")
      : avail === "error" ? (reason || "could not check")
      : "Type a handle" },
    { label: "Display name", ok: nameCheck.ok, hint: nameCheck.ok ? `${name.length}/50 chars` : (nameCheck.reason ?? "invalid") },
    { label: "Permanence acknowledged", ok: acknowledged, hint: "Tick the checkbox below" },
  ]), [active, isRemote, existingPayId, existingChecking, balanceOk, balNum, bal, feeZbx, idCheck, canonical, avail, reason, nameCheck, name.length, acknowledged]);

  const canSubmit =
    !submitting &&
    !!active &&
    !isRemote &&
    !existingPayId &&
    !existingChecking &&
    balanceOk &&
    avail === "available" &&
    nameCheck.ok &&
    acknowledged;

  async function onSubmit() {
    if (!active) return;
    if (!canonical) return;
    if (active.kind === "remote") {
      setErr("Mobile wallet connected — Pay-ID registration must be approved on your phone. Disconnect from the topbar to register from a stored key.");
      onLog("Submit blocked: remote wallet active", "warn");
      return;
    }
    setErr(null);
    setSubmitting(true);
    setTxHash(null);
    setTxStatus(null);
    onLog(`Submitting registration for ${canonical}`, "info");
    try {
      const r = await registerPayId({
        privateKeyHex: active.privateKey,
        payId: canonical,
        name: name.trim(),
        // Lock in the exact fee the user just saw — otherwise display vs. paid
        // could drift if the recommended fee shifts between render and submit.
        feeZbx,
      });
      setTxHash(r.hash);
      setTxStatus("pending");
      const entry: PayIdHistoryEntry = {
        hash: r.hash,
        payId: r.payId,
        address: active.address,
        timestamp: Date.now(),
        status: "pending",
      };
      onPushHistory(entry);
      onLog(`Broadcast ok · ${r.hash}`, "ok");
      const receipt = await pollReceipt(r.hash, { intervalMs: 3000, timeoutMs: 60_000 });
      if (!receipt) {
        setErr("Tx broadcast but no receipt within 60s — check the explorer. The transaction may still confirm later.");
        setTxStatus(null);
        onUpdateHistoryStatus(r.hash, "unknown");
        onLog("Receipt timeout (60s)", "warn");
      } else if (receipt.status === "0x1") {
        setTxStatus("confirmed");
        onUpdateHistoryStatus(r.hash, "confirmed");
        onLog(`Confirmed · ${canonical}`, "ok");
        onRefreshBal();
      } else {
        setTxStatus("reverted");
        onUpdateHistoryStatus(r.hash, "reverted");
        setErr("Tx mined but reverted on-chain — most likely the handle was claimed in the same block. Try a suggestion.");
        onLog("Tx reverted on-chain", "err");
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const safe = scrubSecrets(raw);
      setErr(safe);
      onLog(`Error: ${safe}`, "err");
    } finally {
      setSubmitting(false);
    }
  }

  // Enter to submit when valid
  function onHandleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && canSubmit) onSubmit();
  }

  if (existingPayId && active) {
    return (
      <SectionCard title="Already registered" icon={CheckCircle2} tone="success">
        <p className="mb-2 text-sm text-muted-foreground">
          This address already has a permanent Pay-ID:
        </p>
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <AtSign className="h-5 w-5 text-emerald-300" />
          <code className="flex-1 truncate font-mono text-base font-semibold text-emerald-300" data-testid="text-existing-payid">
            {existingPayId}
          </code>
          <button
            onClick={() => onCopy(existingPayId, "Pay-ID copied")}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <Link href={`/payid-resolver?q=${encodeURIComponent(existingPayId)}`}>
            <button className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:border-primary/40">
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </button>
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          To register a different Pay-ID, switch to another wallet using the picker below or top-right.
        </p>
        {wallets.length > 1 && (
          <div className="mt-3">
            <WalletPicker wallets={wallets} active={active} onPick={onSwitchWallet} />
          </div>
        )}
      </SectionCard>
    );
  }

  return (
    <>
      {/* Wallet picker / setup */}
      {!active ? (
        <SectionCard title="Connect a wallet" icon={WalletIcon} tone="warn">
          <p className="mb-3 text-sm text-muted-foreground">
            You need an active wallet with at least <span className="font-mono text-foreground">{feeZbx} ZBX</span> for the network fee.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onGenerate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              data-testid="button-generate-inline"
            >
              <Sparkles className="h-4 w-4" />
              Generate test wallet
            </button>
            <Link href="/import-wallet">
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-primary/40">
                Import existing
              </button>
            </Link>
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          title="Sign-in wallet"
          subtitle={`${active.label} · ${shortAddr(active.address)} · ${bal} ZBX`}
          icon={WalletIcon}
          tone="primary"
          right={
            wallets.length > 1 ? (
              <div className="hidden sm:block">
                <WalletPicker wallets={wallets} active={active} onPick={onSwitchWallet} compact />
              </div>
            ) : null
          }
        >
          <div className="space-y-3">
            {wallets.length > 1 && (
              <div className="sm:hidden">
                <WalletPicker wallets={wallets} active={active} onPick={onSwitchWallet} />
              </div>
            )}
            {isRemote && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <strong>Mobile wallet active.</strong> Pay-ID registration must be approved on your phone.
                  Disconnect from the topbar to register using a locally-stored key.
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Composer */}
      {active && !isRemote && (
        <SectionCard title="Compose your Pay-ID" icon={UserPlusIcon} tone="primary">
          <div className="space-y-4">
            {/* Handle */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-handle">
                Handle
              </label>
              <div className="relative">
                <input
                  id="input-handle"
                  value={handle}
                  onChange={(e) => {
                    const cleaned = e.target.value
                      .toLowerCase()
                      .replace(/@zbx.*$/g, "")
                      .replace(/@+$/g, "")
                      .replace(/[^a-z0-9_]/g, "");
                    setHandle(cleaned);
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text") ?? "";
                    if (/@zbx/i.test(text)) {
                      e.preventDefault();
                      const cleaned = text
                        .toLowerCase()
                        .replace(/@zbx.*$/g, "")
                        .replace(/[^a-z0-9_]/g, "");
                      setHandle(cleaned);
                    }
                  }}
                  onKeyDown={onHandleKey}
                  placeholder="alice"
                  maxLength={25}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  className="w-full rounded-md border border-border bg-background py-2.5 pl-3 pr-28 font-mono text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="input-handle"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  @zbx
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs" aria-live="polite">
                {avail === "checking" && (
                  <span className="flex items-center gap-1 text-muted-foreground" data-testid="status-checking">
                    <Loader2 className="h-3 w-3 animate-spin" /> checking…
                  </span>
                )}
                {avail === "available" && (
                  <span className="flex items-center gap-1 text-emerald-300" data-testid="status-available">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {canonical} is available
                  </span>
                )}
                {avail === "taken" && (
                  <span className="flex items-center gap-1 text-red-400" data-testid="status-taken">
                    <XCircle className="h-3.5 w-3.5" /> {canonical} is already taken
                  </span>
                )}
                {avail === "invalid" && (
                  <span className="flex items-center gap-1 text-amber-300" data-testid="status-invalid">
                    <AlertCircle className="h-3.5 w-3.5" /> {reason}
                  </span>
                )}
                {avail === "error" && (
                  <span className="flex items-center gap-1 text-red-400" data-testid="status-error">
                    <AlertCircle className="h-3.5 w-3.5" /> {reason || "could not check"}
                  </span>
                )}
                {avail === "idle" && (
                  <span className="text-muted-foreground">3–25 chars · lowercase letters, digits, underscore</span>
                )}
              </div>
              {isReservedHint && avail !== "taken" && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    Heads-up: this is a commonly-targeted handle. The chain is the source of truth — if it shows available, it really is.
                  </div>
                </div>
              )}
            </div>

            {/* Suggestions when taken */}
            {avail === "taken" && suggestions.length > 0 && (
              <div className="rounded-md border border-border/60 bg-card/40 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-300" />
                  Suggestions
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.handle}
                      onClick={() => setHandle(s.handle)}
                      disabled={s.state !== "available"}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        s.state === "available"
                          ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10"
                          : s.state === "taken"
                          ? "border-red-500/30 bg-red-500/5 text-red-400 line-through"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                      data-testid={`suggest-${s.handle}`}
                    >
                      {s.state === "checking" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {s.state === "available" && <CheckCircle2 className="h-3 w-3" />}
                      {s.state === "taken" && <XCircle className="h-3 w-3" />}
                      {s.state === "error" && <AlertCircle className="h-3 w-3" />}
                      {s.handle}@zbx
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-name">
                Display name
              </label>
              <input
                id="input-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onHandleKey}
                placeholder="Alice K."
                maxLength={50}
                autoComplete="off"
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                data-testid="input-name"
              />
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{name.length}/50 · shown to people resolving your Pay-ID</span>
                {!nameCheck.ok && (
                  <span className="text-amber-300">{nameCheck.reason}</span>
                )}
              </div>
            </div>

            {/* Permanence ack */}
            <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-500/50 bg-transparent text-amber-500 focus:ring-amber-500/30"
                data-testid="checkbox-ack-permanence"
              />
              <span>
                <strong className="font-semibold">I understand this is permanent.</strong>{" "}
                Once registered, this Pay-ID cannot be changed, transferred, or deleted. It is bound to{" "}
                <span className="font-mono">{active ? shortAddr(active.address) : "this address"}</span> forever.
              </span>
            </label>

            {/* Pre-flight checklist */}
            <div className="rounded-md border border-border/60 bg-card/40 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5 text-primary" />
                Pre-flight check
              </div>
              <ul className="space-y-1.5 text-xs">
                {checklist.map((c, i) => (
                  <li key={i} className="flex items-start gap-2" data-testid={`check-${i}`}>
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex-1">
                      <span className={c.ok ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                      {c.hint && <span className="ml-2 text-[11px] text-muted-foreground">· {c.hint}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-submit"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {txStatus === "pending" ? "Waiting for confirmation…" : "Broadcasting…"}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Send className="h-4 w-4" />
                  Register {canonical ?? "handle@zbx"} · {feeZbx} ZBX
                </span>
              )}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Tx receipt */}
      {txHash && (
        <SectionCard
          title={
            txStatus === "confirmed" ? "Confirmed on-chain" :
            txStatus === "reverted" ? "Reverted" :
            "Pending confirmation"
          }
          icon={
            txStatus === "confirmed" ? CheckCircle2 :
            txStatus === "reverted" ? XCircle :
            Loader2
          }
          tone={
            txStatus === "confirmed" ? "success" :
            txStatus === "reverted" ? "danger" :
            "primary"
          }
        >
          <div className="space-y-3 text-xs">
            <div>
              <div className="text-muted-foreground">Transaction hash</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-foreground" data-testid="text-tx-hash">{txHash}</code>
                <button
                  onClick={() => onCopy(txHash, "Hash copied")}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Copy hash"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <Link href={`/block-explorer?q=${txHash}`}>
                  <button className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1.5 font-medium text-foreground hover:border-primary/40">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </button>
                </Link>
              </div>
            </div>
            {txStatus === "confirmed" && canonical && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-emerald-200 space-y-2">
                <div>
                  People can now send you ZBX at{" "}
                  <code className="font-mono font-semibold">{canonical}</code>.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onCopy(canonical, "Pay-ID copied")}
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20"
                  >
                    <Copy className="h-3 w-3" />
                    Copy Pay-ID
                  </button>
                  <Link href={`/payid-resolver?q=${encodeURIComponent(canonical)}`}>
                    <button className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20">
                      <ArrowRight className="h-3 w-3" />
                      Test in resolver
                    </button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <code className="break-all text-xs">{err}</code>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet picker
// ─────────────────────────────────────────────────────────────────────────────

function WalletPicker({
  wallets,
  active,
  onPick,
  compact = false,
}: {
  wallets: StoredWallet[];
  active: ReturnType<typeof useWallet>["active"];
  onPick: (addr: string | null) => void;
  compact?: boolean;
}) {
  if (wallets.length === 0) return null;
  return (
    <select
      value={active?.address ?? ""}
      onChange={(e) => onPick(e.target.value || null)}
      className={`rounded-md border border-border bg-background ${compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"} font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30`}
      data-testid="select-wallet"
      aria-label="Select wallet"
    >
      {wallets.map((w) => (
        <option key={w.address} value={w.address}>
          {w.label} · {shortAddr(w.address)}
        </option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Scout panel
// ─────────────────────────────────────────────────────────────────────────────

function ScoutPanel({
  onLog,
  onCopy,
  onClaim,
}: {
  onLog: (msg: string, tone?: "info" | "ok" | "warn" | "err") => void;
  onCopy: (text: string, label?: string) => void;
  onClaim: (handle: string) => void;
  preloadHandles?: string[];
  setRegisterHandle?: (h: string) => void;
}) {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<ScoutRow[]>([]);
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);

  const candidates = useMemo(() => {
    const raw = input
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(raw)).slice(0, 50);
  }, [input]);

  async function runScout() {
    const my = ++seqRef.current;
    setBusy(true);
    const initial: ScoutRow[] = candidates.map((raw) => {
      const v = validatePayIdInput(raw);
      return {
        raw,
        canonical: v.ok ? v.canonical ?? null : null,
        state: v.ok ? "checking" : "invalid",
        reason: v.ok ? undefined : v.reason,
      };
    });
    setRows(initial);
    onLog(`Scouting ${candidates.length} handle(s)`, "info");

    await Promise.all(
      initial.map(async (row, i) => {
        if (row.state === "invalid" || !row.canonical) return;
        try {
          const rec = await lookupPayIdForward(row.canonical);
          if (my !== seqRef.current) return;
          setRows((prev) => {
            const next = [...prev];
            next[i] = {
              ...row,
              state: rec?.address ? "taken" : "available",
              record: rec,
            };
            return next;
          });
        } catch (e) {
          if (my !== seqRef.current) return;
          const msg = e instanceof Error ? e.message : String(e);
          setRows((prev) => {
            const next = [...prev];
            next[i] = {
              ...row,
              state: /not\s*(registered|found)|unknown|does\s*not\s*exist/i.test(msg) ? "available" : "error",
              reason: msg,
            };
            return next;
          });
        }
      }),
    );
    if (my === seqRef.current) {
      setBusy(false);
      onLog("Scout complete", "ok");
    }
  }

  function exportCsv() {
    const header = ["raw", "canonical", "state", "owner_address", "owner_name"];
    const lines = [header.join(",")].concat(
      rows.map((r) => [
        csvCell(r.raw),
        csvCell(r.canonical ?? ""),
        csvCell(r.state),
        csvCell(r.record?.address ?? ""),
        csvCell(r.record?.name ?? ""),
      ].join(",")),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payid-scout-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onLog(`Exported ${rows.length} row(s) to CSV`, "ok");
  }

  return (
    <SectionCard
      title="Bulk handle scout"
      subtitle="Check availability of many handles in one shot"
      icon={ListChecks}
      tone="primary"
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-scout">
            Candidates · paste or type, one per line / comma / space (max 50)
          </label>
          <textarea
            id="input-scout"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"alice\nbob\ncharlie_2026\nzbx_team"}
            rows={5}
            spellCheck={false}
            autoCapitalize="off"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="input-scout"
          />
          <div className="mt-1 text-xs text-muted-foreground">
            {candidates.length} unique candidate{candidates.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={runScout}
            disabled={busy || candidates.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-scout"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Run scout
          </button>
          {rows.length > 0 && (
            <>
              <button
                onClick={exportCsv}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-primary/40"
                data-testid="button-scout-export"
              >
                Export CSV
              </button>
              <button
                onClick={() => setRows([])}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-primary/40"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            </>
          )}
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-card/60">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Handle</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.raw}-${i}`} className="border-t border-border/40">
                    <td className="px-3 py-2 font-mono">
                      {r.canonical ?? r.raw}
                    </td>
                    <td className="px-3 py-2">
                      {r.state === "checking" && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> checking
                        </span>
                      )}
                      {r.state === "available" && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> available
                        </span>
                      )}
                      {r.state === "taken" && (
                        <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-400">
                          <XCircle className="h-3 w-3" /> taken
                        </span>
                      )}
                      {r.state === "invalid" && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-300" title={r.reason}>
                          <AlertCircle className="h-3 w-3" /> invalid
                        </span>
                      )}
                      {r.state === "error" && (
                        <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-400" title={r.reason}>
                          <AlertCircle className="h-3 w-3" /> error
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.record?.address ? (
                        <div className="flex items-center gap-1">
                          <code className="font-mono text-[11px] text-foreground">{shortAddr(r.record.address)}</code>
                          <button
                            onClick={() => onCopy(r.record!.address!, "Address copied")}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            aria-label="Copy owner address"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.state === "available" && r.canonical && (
                        <button
                          onClick={() => onClaim(r.canonical!.replace("@zbx", ""))}
                          className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/10"
                          data-testid={`button-claim-${r.canonical}`}
                        >
                          <ArrowRight className="h-3 w-3" />
                          Claim
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse lookup panel
// ─────────────────────────────────────────────────────────────────────────────

function ReversePanel({
  onCopy,
  onLog,
}: {
  onCopy: (text: string, label?: string) => void;
  onLog: (msg: string, tone?: "info" | "ok" | "warn" | "err") => void;
}) {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayIdRecord | null | "not-found">(null);
  const [err, setErr] = useState<string | null>(null);

  const isValidAddr = /^0x[0-9a-fA-F]{40}$/.test(addr.trim());

  async function lookup() {
    if (!isValidAddr) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await lookupPayIdReverse(addr.trim());
      setResult(r ?? "not-found");
      onLog(r?.pay_id ? `Found ${r.pay_id} for ${shortAddr(addr.trim())}` : `No Pay-ID for ${shortAddr(addr.trim())}`, r?.pay_id ? "ok" : "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      onLog(`Reverse lookup error: ${msg}`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Address → Pay-ID"
      subtitle="Look up the Pay-ID registered for any address"
      icon={Search}
      tone="primary"
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-reverse-addr">
            Address (0x… 40 hex chars)
          </label>
          <div className="flex gap-2">
            <input
              id="input-reverse-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && isValidAddr && !busy) lookup(); }}
              placeholder="0x0000000000000000000000000000000000000000"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid="input-reverse-addr"
            />
            <button
              onClick={lookup}
              disabled={!isValidAddr || busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-reverse-lookup"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Lookup
            </button>
          </div>
          {addr && !isValidAddr && (
            <div className="mt-1 text-xs text-amber-300">Address must be 0x + 40 hex chars</div>
          )}
        </div>

        {result === "not-found" && (
          <div className="rounded-md border border-border/60 bg-card/40 p-3 text-sm text-muted-foreground" data-testid="text-reverse-not-found">
            No Pay-ID is registered for this address.
          </div>
        )}
        {result && result !== "not-found" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AtSign className="h-5 w-5 text-emerald-300" />
              <code className="flex-1 truncate font-mono text-base font-semibold text-emerald-300" data-testid="text-reverse-payid">
                {result.pay_id}
              </code>
              {result.pay_id && (
                <>
                  <button
                    onClick={() => onCopy(result.pay_id!, "Pay-ID copied")}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Copy Pay-ID"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <Link href={`/payid-resolver?q=${encodeURIComponent(result.pay_id)}`}>
                    <button className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:border-primary/40">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </button>
                  </Link>
                </>
              )}
            </div>
            {result.name && (
              <div className="text-xs text-muted-foreground">
                Name: <span className="font-medium text-foreground">{result.name}</span>
              </div>
            )}
          </div>
        )}
        {err && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <code className="break-all text-xs">{err}</code>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// History panel
// ─────────────────────────────────────────────────────────────────────────────

function HistoryPanel({
  history,
  onCopy,
  onClear,
  onUpdateStatus,
}: {
  history: PayIdHistoryEntry[];
  onCopy: (text: string, label?: string) => void;
  onClear: () => void;
  onUpdateStatus: (hash: string, status: PayIdHistoryEntry["status"]) => void;
}) {
  const [refreshingHash, setRefreshingHash] = useState<string | null>(null);
  const [showAddr, setShowAddr] = useState(false);

  async function refreshOne(entry: PayIdHistoryEntry) {
    setRefreshingHash(entry.hash);
    try {
      const r = await pollReceipt(entry.hash, { intervalMs: 2000, timeoutMs: 8000 });
      if (!r) {
        onUpdateStatus(entry.hash, "unknown");
      } else if (r.status === "0x1") {
        onUpdateStatus(entry.hash, "confirmed");
      } else {
        onUpdateStatus(entry.hash, "reverted");
      }
    } catch {
      onUpdateStatus(entry.hash, "unknown");
    } finally {
      setRefreshingHash(null);
    }
  }

  if (history.length === 0) {
    return (
      <SectionCard title="Registration history" icon={HistoryIcon}>
        <div className="rounded-md border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground" data-testid="text-history-empty">
          <HistoryIcon className="mx-auto mb-2 h-8 w-8 opacity-40" />
          No registrations on this device yet. Your Pay-ID submissions will be remembered here (this browser only — the chain is the source of truth).
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={`Registration history (${history.length})`}
      icon={HistoryIcon}
      right={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddr((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-primary/40"
            data-testid="button-toggle-addr"
          >
            {showAddr ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showAddr ? "Hide" : "Show"} address
          </button>
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/5 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10"
            data-testid="button-clear-history"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {history.map((e) => (
          <div
            key={e.hash}
            className="rounded-md border border-border/60 bg-card/40 p-3"
            data-testid={`history-row-${e.hash}`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <AtSign className="h-4 w-4 text-primary" />
                  <code className="font-mono text-sm font-semibold text-foreground">{e.payId}</code>
                  <StatusPill status={e.status} />
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  <code className="truncate font-mono">{e.hash}</code>
                  <button
                    onClick={() => onCopy(e.hash, "Hash copied")}
                    className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                    aria-label="Copy hash"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                {showAddr && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="opacity-70">Address:</span>
                    <code className="truncate font-mono">{e.address}</code>
                    <button
                      onClick={() => onCopy(e.address, "Address copied")}
                      className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                      aria-label="Copy address"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {new Date(e.timestamp).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => refreshOne(e)}
                  disabled={refreshingHash === e.hash}
                  className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:border-primary/40 disabled:opacity-50"
                  data-testid={`button-history-refresh-${e.hash}`}
                  aria-label="Refresh status"
                >
                  {refreshingHash === e.hash ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh
                </button>
                <Link href={`/block-explorer?q=${e.hash}`}>
                  <button className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:border-primary/40">
                    <ExternalLink className="h-3 w-3" />
                    Tx
                  </button>
                </Link>
                <Link href={`/payid-resolver?q=${encodeURIComponent(e.payId)}`}>
                  <button className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:border-primary/40">
                    <ArrowRight className="h-3 w-3" />
                    Resolve
                  </button>
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function StatusPill({ status }: { status: PayIdHistoryEntry["status"] }) {
  const cfg = {
    pending:   { cls: "bg-amber-500/10 text-amber-300 border-amber-500/30", label: "pending", icon: Loader2 },
    confirmed: { cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", label: "confirmed", icon: CheckCircle2 },
    reverted:  { cls: "bg-red-500/10 text-red-400 border-red-500/30", label: "reverted", icon: XCircle },
    unknown:   { cls: "bg-muted/40 text-muted-foreground border-border", label: "unknown", icon: HelpCircle },
  }[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cfg.cls}`}>
      <Icon className={`h-3 w-3 ${status === "pending" ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "How it works" collapsible
// ─────────────────────────────────────────────────────────────────────────────

function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <SectionCard
      title={
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex w-full items-center gap-1.5 text-left"
          data-testid="button-how-it-works"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          How registration works
        </button>
      }
      icon={HelpCircle}
    >
      {open ? (
        <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
          <p>
            Your client builds a <code className="font-mono">TxKind::RegisterPayId</code> tx (kind tag = 6) with your handle and display name, locks in the recommended fee, signs it locally with your private key, and broadcasts via{" "}
            <code className="font-mono">zbx_sendRawTransaction</code>.
          </p>
          <p>
            The chain validates that (a) your handle is well-formed, (b) the handle is currently free, and (c) your address has no existing Pay-ID. On success, a permanent on-chain record binds <code className="font-mono">handle@zbx</code> to your address.
          </p>
          <p>
            We then poll <code className="font-mono">eth_getTransactionReceipt</code> for up to 60s. The transaction can still confirm later even if we time out — re-check from the History tab.
          </p>
          <p className="text-amber-300">
            Your private key never leaves your browser. We sign locally and broadcast only the signed hex blob.
          </p>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Builds, signs, and broadcasts a RegisterPayId tx locally — keys never leave your browser.
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab button
// ─────────────────────────────────────────────────────────────────────────────

function TabBtn({
  active, onClick, icon: Icon, children, testId, tabId, panelId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
  testId?: string;
  tabId?: string;
  panelId?: string;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      id={tabId}
      aria-controls={panelId}
      aria-selected={active}
      data-testid={testId}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/30"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function csvCell(s: string): string {
  if (s == null) return "";
  const needsQuote = /[",\n\r]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needsQuote ? `"${esc}"` : esc;
}

/**
 * Defense-in-depth: scrub any 64-hex-char run (the shape of a private key
 * or a 32-byte secret) AND any plausible mnemonic word run from a string
 * before it is shown to the user or written to the activity log.  In normal
 * operation no signing-path error includes the seed, but if any future
 * dependency ever does, this guarantees we never echo it back.
 */
function scrubSecrets(s: string): string {
  if (!s) return s;
  let out = s;
  // 64-hex (with optional 0x prefix) — private key shape
  out = out.replace(/0x[0-9a-fA-F]{64}/g, "0x[redacted]");
  out = out.replace(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, "[redacted]");
  // 12+ consecutive lowercase ascii words separated by single spaces (mnemonic shape)
  out = out.replace(/\b(?:[a-z]{3,8} ){11,23}[a-z]{3,8}\b/g, "[mnemonic-redacted]");
  return out;
}

// Local UserPlus icon — lightweight inline SVG (lucide doesn't ship one named exactly this).
function UserPlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  );
}
