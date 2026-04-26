import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Wallet,
  Plus,
  KeyRound,
  Send,
  Copy,
  Trash2,
  Download,
  Check,
  RefreshCw,
  EyeOff,
  Eye,
  Loader2,
  X,
  Link2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Link as WLink, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  rpc,
  weiHexToZbx,
  shortAddr,
  pollReceipt,
  hexToInt,
  getRecommendedFeeWei,
  type EthReceipt,
} from "@/lib/zbx-rpc";
import { useWallet } from "@/contexts/wallet-context";
import { Smartphone } from "lucide-react";
import { VaultControls } from "@/components/wallet/VaultControls";
import {
  StoredWallet,
  TxRecord,
  loadWallets,
  loadHistory,
  recordTx,
  updateTxByHash,
  clearHistory,
  generateWallet,
  importWalletFromHex,
  addWallet,
  removeWallet,
  getActiveAddress,
  setActiveAddress,
  sendTransfer,
  parseNonce,
  zbxToWei,
} from "@/lib/web-wallet";
import {
  hasEthProvider,
  requestAccounts,
  getCurrentChainIdHex,
  switchOrAddZebvixChain,
  sendMmTransaction,
  onProviderEvents,
  ZEBVIX_CHAIN_ID_HEX,
} from "@/lib/metamask";
import {
  lookupPayIdForward,
  validatePayIdInput,
  type PayIdRecord,
} from "@/lib/payid";

const CHAIN_ID = 7878;
const CHAIN_ID_HEX = "0x1ec6";

function copy(text: string, toast: ReturnType<typeof useToast>["toast"], label = "Copied") {
  navigator.clipboard.writeText(text);
  toast({ title: label, description: text.length > 60 ? text.slice(0, 60) + "…" : text });
}

const TAB_VALUES = ["send", "metamask", "manage", "history"] as const;
type TabValue = (typeof TAB_VALUES)[number];

export default function WalletPage() {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [balance, setBalance] = useState<string>("—");
  const [nonce, setNonce] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Tab state — driven by `?tab=…` so deep links from the wallet picker
  // (e.g. /wallet?tab=send) land on the right tab instead of always defaulting.
  const search = useSearch();
  const [, setLocation] = useLocation();
  const initialTab: TabValue = (() => {
    const q = new URLSearchParams(search).get("tab");
    return TAB_VALUES.includes(q as TabValue) ? (q as TabValue) : "send";
  })();
  const [tab, setTab] = useState<TabValue>(initialTab);
  // Sync URL query → tab whenever it changes (e.g. browser back/forward, or
  // a fresh ?tab=send link arriving while the page is already mounted).
  useEffect(() => {
    const q = new URLSearchParams(search).get("tab");
    if (q && TAB_VALUES.includes(q as TabValue) && q !== tab) {
      setTab(q as TabValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const onTabChange = (v: string) => {
    if (!TAB_VALUES.includes(v as TabValue)) return;
    setTab(v as TabValue);
    // Reflect the choice in the URL so refresh / share keeps the user on the
    // tab they picked. Use replace so we don't pollute the back stack.
    const next = new URLSearchParams(search);
    next.set("tab", v);
    setLocation(`/wallet?${next.toString()}`, { replace: true });
  };

  const reloadWallets = () => {
    const ws = loadWallets();
    setWallets(ws);
    const a = getActiveAddress();
    setActive(a && ws.some((w) => w.address === a) ? a : ws[0]?.address ?? null);
    setHistory(loadHistory());
  };
  useEffect(() => { reloadWallets(); }, []);

  const refreshBalance = async (addr: string | null) => {
    if (!addr) { setBalance("—"); setNonce(null); return; }
    setRefreshing(true);
    try {
      const [bal, n] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<unknown>("zbx_getNonce", [addr]).catch(() => 0),
      ]);
      setBalance(weiHexToZbx(bal));
      try { setNonce(parseNonce(n)); } catch { setNonce(0); }
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => { refreshBalance(active); }, [active]);

  const onPick = (a: string) => { setActiveAddress(a); setActive(a); };

  // ── Mobile-paired wallet override ───────────────────────────────────────
  // When a mobile wallet is paired via QR scan, it takes priority over any
  // local wallet for display + as the "from" address. Local signing is
  // disabled while paired — the user must disconnect the mobile wallet to
  // sign locally (full WC sign-relay routing is a follow-up).
  const { remote, isRemote, refresh } = useWallet();
  const localActiveWallet = useMemo(
    () => wallets.find((w) => w.address === active) ?? null,
    [wallets, active],
  );
  const activeWallet: StoredWallet | null = useMemo(() => {
    if (isRemote && remote) {
      // Synthesize a StoredWallet shape for the remote wallet so consumers
      // that destructure `address` / `label` keep working. `privateKey` is
      // intentionally empty — every signing call site MUST guard with
      // `isRemote` before touching it.
      return {
        address: remote.address,
        label: remote.label,
        privateKey: "",
        publicKey: "",
        createdAt: remote.connectedAt,
      };
    }
    return localActiveWallet;
  }, [isRemote, remote, localActiveWallet]);

  // Refresh balance whenever the effective active address changes — this
  // covers both local wallet picks and remote wallet pair/unpair events.
  useEffect(() => {
    if (isRemote && remote) {
      refreshBalance(remote.address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRemote, remote?.address]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">ZBX Wallet</h1>
        <p className="text-lg text-muted-foreground">
          Hot-wallet for Zebvix mainnet — native send with confirmation preview, MetaMask
          flow for Solidity tx, plus live receipt tracking. Chain id <code className="text-xs">0x1ec6</code> · 18 dec ZBX.
        </p>
      </div>

      <VaultControls onChange={refresh} />

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm flex items-center gap-3 flex-wrap">
        <span className="text-primary font-semibold">New:</span>
        <span className="text-muted-foreground">
          Import an existing address via private key or 12/24-word BIP39 mnemonic, or claim a
          permanent <code className="font-mono text-foreground">handle@zbx</code> Pay-ID.
        </span>
        <WLink href="/import-wallet" className="ml-auto inline-flex items-center gap-1 rounded-md border border-primary/40 bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/60">
          Import Address
        </WLink>
        <WLink href="/payid-register" className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
          Register Pay-ID
        </WLink>
      </div>

      {isRemote && remote && (
        <div className="rounded-lg border border-cyan-500/40 bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent p-4 flex items-start gap-3">
          <div className="rounded-md bg-cyan-500/20 p-2 mt-0.5">
            <Smartphone className="h-4 w-4 text-cyan-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-cyan-200">
              Mobile wallet connected · {remote.label || "Mobile"}
            </div>
            <div className="text-xs text-cyan-100/70 mt-0.5">
              <code className="font-mono">{remote.address}</code> is the active wallet for
              all transfers, swaps and on-chain actions in this session. Local-wallet signing
              is paused — disconnect from the topbar to sign with a stored key instead.
            </div>
          </div>
        </div>
      )}

      <ActiveCard
        wallet={activeWallet}
        balance={balance}
        nonce={nonce}
        refreshing={refreshing}
        isRemote={isRemote}
        onRefresh={() => refreshBalance(activeWallet?.address ?? null)}
        onCopy={(t, l) => copy(t, toast, l)}
      />

      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="send" data-testid="tab-send">Send (native)</TabsTrigger>
          <TabsTrigger value="metamask" data-testid="tab-metamask">MetaMask</TabsTrigger>
          <TabsTrigger value="manage" data-testid="tab-manage">Manage</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <SendTab
            active={activeWallet}
            balance={balance}
            nonce={nonce}
            isRemote={isRemote}
            onSent={() => { refreshBalance(activeWallet?.address ?? null); setHistory(loadHistory()); }}
          />
        </TabsContent>

        <TabsContent value="metamask">
          <MetaMaskTab onSent={() => setHistory(loadHistory())} />
        </TabsContent>

        <TabsContent value="manage">
          <ManageTab
            wallets={wallets}
            active={active}
            onPick={onPick}
            onChange={reloadWallets}
            onCopy={(t, l) => copy(t, toast, l)}
          />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab
            history={history}
            onClear={() => { clearHistory(); setHistory([]); }}
            onCopy={(t, l) => copy(t, toast, l)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ───── Active wallet card ────────────────────────────────────────────────────
function ActiveCard(props: {
  wallet: StoredWallet | null;
  balance: string;
  nonce: number | null;
  refreshing: boolean;
  isRemote?: boolean;
  onRefresh: () => void;
  onCopy: (t: string, l?: string) => void;
}) {
  const { wallet, balance, nonce, refreshing, isRemote, onRefresh, onCopy } = props;
  if (!wallet) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No wallet selected — go to <strong>Manage</strong> and create or import one.
      </Card>
    );
  }
  return (
    <Card className={`p-5 space-y-3 ${isRemote ? "border-cyan-500/40" : "border-primary/20"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            {isRemote ? (
              <>
                <Smartphone className="h-3 w-3 text-cyan-300" />
                <span className="text-cyan-200">Active wallet · Mobile · {wallet.label}</span>
              </>
            ) : (
              <>Active wallet · {wallet.label}</>
            )}
          </div>
          <button
            className="font-mono text-sm text-foreground hover:text-primary transition flex items-center gap-1.5"
            onClick={() => onCopy(wallet.address, "Address copied")}
            title="Click to copy"
          >
            {wallet.address}
            <Copy className="h-3 w-3" />
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} data-testid="button-refresh-balance">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-muted-foreground">Balance</div>
          <div className="text-2xl font-bold text-primary">
            {balance} <span className="text-sm font-normal text-muted-foreground">ZBX</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total transactions</div>
          <div className="text-2xl font-bold" data-testid="text-total-tx">{nonce ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">confirmed on-chain</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Next nonce</div>
          <div className="text-2xl font-bold">{nonce ?? "—"}</div>
        </div>
      </div>
    </Card>
  );
}

// ───── Manage / Create / Import ──────────────────────────────────────────────
function ManageTab(props: {
  wallets: StoredWallet[];
  active: string | null;
  onPick: (a: string) => void;
  onChange: () => void;
  onCopy: (t: string, l?: string) => void;
}) {
  const { wallets, active, onPick, onChange, onCopy } = props;
  const { toast } = useToast();
  const [importHex, setImportHex] = useState("");
  const [importLabel, setImportLabel] = useState("Imported");
  const [createLabel, setCreateLabel] = useState("Wallet");
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const handleCreate = () => {
    const w = generateWallet(createLabel || "Wallet");
    addWallet(w);
    onChange();
    setCreateOpen(false);
    toast({ title: "Wallet created", description: w.address });
  };

  const handleImport = () => {
    try {
      const w = importWalletFromHex(importHex, importLabel || "Imported");
      addWallet(w);
      onChange();
      setImportOpen(false);
      setImportHex("");
      toast({ title: "Wallet imported", description: w.address });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    }
  };

  const handleExport = (w: StoredWallet) => {
    const data = JSON.stringify(w, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zebvix-${w.address.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = (w: StoredWallet) => {
    if (!confirm(`Delete wallet ${shortAddr(w.address)}? Make sure you have a backup of the private key.`)) return;
    removeWallet(w.address);
    onChange();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-wallet">
              <Plus className="h-4 w-4 mr-1.5" /> Create new wallet
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create new wallet</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <Label>Label (for your reference)</Label>
              <Input placeholder="e.g. Treasury" value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                data-testid="input-create-label" />
              <p className="text-xs text-muted-foreground">
                A fresh secp256k1 keypair will be generated using your browser's crypto RNG.
                Be sure to export the keystore JSON afterwards.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} data-testid="button-confirm-create">Generate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" data-testid="button-import-wallet">
              <KeyRound className="h-4 w-4 mr-1.5" /> Import private key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Import private key</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <Label>Label</Label>
              <Input placeholder="e.g. Validator" value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)} />
              <Label>Private key (64 hex, with or without 0x)</Label>
              <Input placeholder="0x..." value={importHex}
                onChange={(e) => setImportHex(e.target.value)}
                data-testid="input-import-key" className="font-mono" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button onClick={handleImport} data-testid="button-confirm-import">Import</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {wallets.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No wallets yet — create or import one to get started.
        </Card>
      ) : (
        <div className="space-y-2">
          {wallets.map((w) => {
            const isActive = active === w.address;
            const isShown = !!showSecret[w.address];
            return (
              <Card key={w.address} className={`p-4 ${isActive ? "border-primary/50 bg-primary/5" : ""}`}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Wallet className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        {w.label}
                        {isActive && <Badge variant="default" className="text-[10px]">active</Badge>}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground truncate">{w.address}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isActive && (
                      <Button size="sm" variant="outline" onClick={() => onPick(w.address)}>Use</Button>
                    )}
                    <Button size="sm" variant="ghost" title="Copy address" onClick={() => onCopy(w.address, "Address copied")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Export keystore JSON" onClick={() => handleExport(w)}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Delete from this browser" onClick={() => handleDelete(w)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setShowSecret((s) => ({ ...s, [w.address]: !s[w.address] }))}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    {isShown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {isShown ? "Hide" : "Reveal"} private key
                  </button>
                  {isShown && (
                    <code className="font-mono text-[10px] text-amber-300 break-all flex-1">{w.privateKey}</code>
                  )}
                  {isShown && (
                    <Button size="sm" variant="ghost" onClick={() => onCopy(w.privateKey, "Key copied")}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───── Send tab — confirmation modal + live receipt tracking ─────────────────
type LiveStatus =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "submitting" }
  | { phase: "in-mempool"; hash: string; secs: number }
  | { phase: "included"; hash: string; block: number; status: "success" | "reverted" }
  | { phase: "error"; message: string };

type ResolveStatus =
  | { phase: "idle" }
  | { phase: "address" }                                 // raw 0x… address
  | { phase: "resolving"; canonical: string }
  | { phase: "resolved"; canonical: string; record: PayIdRecord }
  | { phase: "missing"; canonical: string }              // valid handle, not registered
  | { phase: "invalid"; reason: string }
  | { phase: "error"; message: string };

function SendTab(props: {
  active: StoredWallet | null;
  balance: string;
  nonce: number | null;
  isRemote: boolean;
  onSent: () => void;
}) {
  const { active, balance, nonce, isRemote, onSent } = props;
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  // Fee starts empty; we pre-fill with the chain-recommended (AMM-pegged)
  // value via the effect below so the user always sees — and pays — a fee
  // that clears the dynamic floor inside `apply_tx`. Hardcoded 0.002 was
  // silently rejected at block-build time when the pool spot price drifted.
  //
  // `feeEdited` flips to true when the user types in the fee input, so we
  // know whether to sign with the user's exact override or to defer to the
  // library's dynamic resolver (which signs with the exact bigint and
  // avoids the 6-decimal display truncation in weiHexToZbx).
  const [fee, setFee] = useState("");
  const [feeEdited, setFeeEdited] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wei = await getRecommendedFeeWei();
        const zbx = weiHexToZbx("0x" + wei.toString(16));
        if (!cancelled) setFee((cur) => (cur === "" ? zbx : cur));
      } catch { /* leave empty — submit() will resolve again */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<LiveStatus>({ phase: "idle" });
  const [resolve, setResolve] = useState<ResolveStatus>({ phase: "idle" });
  const mountedRef = useRef(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, []);
  const safeSet = (s: LiveStatus) => { if (mountedRef.current) setStatus(s); };

  // ── Pay-ID / address recipient resolver ─────────────────────────────────
  // Accepts raw 0x address OR a Pay-ID handle ("alice" | "alice@zbx").
  // Debounces lookups so each keystroke isn't a network call.
  useEffect(() => {
    const raw = to.trim();
    if (!raw) { setResolve({ phase: "idle" }); return; }
    if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
      setResolve({ phase: "address" });
      return;
    }
    // Anything that's not an address is treated as a Pay-ID candidate.
    const v = validatePayIdInput(raw);
    if (!v.ok || !v.canonical) {
      setResolve({ phase: "invalid", reason: v.reason ?? "invalid recipient" });
      return;
    }
    const canonical = v.canonical;
    setResolve({ phase: "resolving", canonical });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rec = await lookupPayIdForward(canonical);
        if (cancelled) return;
        if (rec && rec.address) {
          setResolve({ phase: "resolved", canonical, record: rec });
        } else {
          setResolve({ phase: "missing", canonical });
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setResolve({ phase: "error", message: msg });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [to]);

  if (!active) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Pick or create a wallet first.
      </Card>
    );
  }

  // The actual recipient address used at sign time. Either the raw 0x input
  // or the address resolved from the Pay-ID lookup.
  const resolvedTo: string | null =
    resolve.phase === "address" ? to.trim() :
    resolve.phase === "resolved" ? (resolve.record.address ?? null) :
    null;

  const validAmt = /^\d+(\.\d+)?$/.test(amount.trim()) && parseFloat(amount) > 0;
  const canReview = !!resolvedTo && validAmt;

  const totalWei = (() => {
    if (!validAmt) return 0n;
    try { return zbxToWei(amount) + zbxToWei(fee || "0"); } catch { return 0n; }
  })();
  const totalZbx = (() => {
    if (totalWei === 0n) return "—";
    return weiHexToZbx("0x" + totalWei.toString(16));
  })();

  const submit = async () => {
    if (!resolvedTo) return;          // guarded by canReview but keep TS happy
    if (isRemote || !active?.privateKey) {
      toast({
        title: "Mobile wallet connected",
        description: "Local signing is paused. Disconnect the mobile wallet from the topbar to send from a stored key.",
        variant: "destructive",
      });
      return;
    }
    safeSet({ phase: "signing" });
    const ts = Date.now();
    let hash = "";
    // Resolve the actual fee once so both the signed tx and the recorded
    // history row report the same value. If the user typed in the fee
    // input, sign with that exact string. Otherwise defer to the library's
    // dynamic resolver (signs with full bigint precision from the chain)
    // and pull the display string for the history row separately.
    const userFee = feeEdited ? fee.trim() : "";
    let actualFeeZbx = userFee;
    if (!actualFeeZbx) {
      const wei = await getRecommendedFeeWei();
      actualFeeZbx = weiHexToZbx("0x" + wei.toString(16));
    }
    try {
      safeSet({ phase: "submitting" });
      const r = await sendTransfer({
        privateKeyHex: active.privateKey,
        to: resolvedTo,
        amountZbx: amount,
        // Pass undefined when the user did not override so the lib signs
        // with the exact recommended bigint (avoids 6-decimal precision
        // loss from the display formatter).
        feeZbx: userFee || undefined,
      });
      hash = r.hash;
      recordTx({
        hash, from: active.address, to: resolvedTo,
        amountZbx: amount, feeZbx: actualFeeZbx,
        ts, status: "submitted", kind: "native",
      });
      safeSet({ phase: "in-mempool", hash, secs: 0 });
      if (mountedRef.current) onSent();
      toast({ title: "Submitted to mempool", description: hash });
      // Tick up the seconds counter while polling. Stored in a ref so the
      // component's unmount cleanup can clear it even if pollReceipt hangs.
      const startedAt = Date.now();
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = setInterval(() => {
        if (!mountedRef.current) return;
        setStatus((s) =>
          s.phase === "in-mempool" ? { ...s, secs: Math.floor((Date.now() - startedAt) / 1000) } : s,
        );
      }, 1000);
      const receipt = await pollReceipt(hash, { intervalMs: 4000, timeoutMs: 90_000 });
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      if (!mountedRef.current) return; // bail on unmount race
      if (!receipt) return;            // timeout — leave UI on in-mempool
      const block = hexToInt(receipt.blockNumber);
      const ok = receipt.status === "0x1";
      safeSet({ phase: "included", hash, block, status: ok ? "success" : "reverted" });
      updateTxByHash(hash, {
        block,
        confirmedTs: Date.now(),
        status: ok ? "confirmed" : "reverted",
      });
      if (mountedRef.current) onSent();
    } catch (e) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      const msg = e instanceof Error ? e.message : String(e);
      safeSet({ phase: "error", message: msg });
      recordTx({
        hash: hash || null, from: active.address, to: resolvedTo ?? to.trim(),
        amountZbx: amount, feeZbx: actualFeeZbx,
        ts, status: "failed", error: msg, kind: "native",
      });
      if (mountedRef.current) onSent();
      toast({ title: "Send failed", description: msg, variant: "destructive" });
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <div className="text-xs text-muted-foreground mb-1">From</div>
        <code className="font-mono text-xs text-foreground">{active.address}</code>
        <div className="text-xs text-muted-foreground mt-1">
          Available: <span className="text-primary font-semibold">{balance} ZBX</span>
        </div>
      </div>
      <div>
        <Label htmlFor="to">Recipient — address or Pay-ID</Label>
        <Input id="to" placeholder="0x… or alice@zbx" value={to}
          onChange={(e) => setTo(e.target.value)}
          className="font-mono" data-testid="input-send-to" />
        <ResolveHint state={resolve} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="amt">Amount (ZBX)</Label>
          <Input id="amt" type="number" min="0" step="0.0001"
            placeholder="0.0" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="input-send-amount" />
        </div>
        <div>
          <Label htmlFor="fee">Fee (ZBX)</Label>
          <Input id="fee" type="number" min="0" step="0.0001"
            placeholder="auto (chain-recommended)"
            value={fee}
            onChange={(e) => { setFee(e.target.value); setFeeEdited(true); }}
            data-testid="input-send-fee" />
        </div>
      </div>

      {isRemote && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs text-cyan-100/80 flex items-start gap-2">
          <Smartphone className="h-3.5 w-3.5 mt-0.5 shrink-0 text-cyan-300" />
          <span>
            A mobile wallet is currently paired. Local signing from this page is paused —
            disconnect from the topbar to send using a stored key.
          </span>
        </div>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button
            disabled={!canReview || isRemote}
            className="w-full"
            data-testid="button-review"
            title={isRemote ? "Disconnect the paired mobile wallet to sign locally" : undefined}
          >
            <Send className="h-4 w-4 mr-1.5" /> Review &amp; sign
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Confirm transaction
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <ReviewRow label="From" value={active.address} mono />
            {resolve.phase === "resolved" && (
              <>
                <ReviewRow
                  label="Pay-ID"
                  value={
                    resolve.record.name
                      ? `${resolve.canonical} (${resolve.record.name})`
                      : resolve.canonical
                  }
                />
                <ReviewRow label="To (resolved)" value={resolvedTo ?? ""} mono />
              </>
            )}
            {resolve.phase !== "resolved" && (
              <ReviewRow label="To" value={resolvedTo ?? ""} mono />
            )}
            <ReviewRow label="Amount" value={`${amount} ZBX`} />
            <ReviewRow label="Fee" value={`${fee || "auto"} ZBX`} />
            <ReviewRow label="Total" value={`${totalZbx} ZBX`} highlight />
            <ReviewRow label="Next nonce" value={nonce !== null ? String(nonce) : "—"} />
            <ReviewRow label="Chain id" value={`${CHAIN_ID_HEX} (${CHAIN_ID})`} mono />
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
              You are about to broadcast a real transaction on Zebvix mainnet. This cannot
              be reversed.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={status.phase === "signing" || status.phase === "submitting"}>
              Cancel
            </Button>
            <Button
              onClick={async () => { setConfirmOpen(false); await submit(); }}
              disabled={status.phase === "signing" || status.phase === "submitting"}
              data-testid="button-confirm-sign"
            >
              <Check className="h-4 w-4 mr-1.5" /> Confirm &amp; sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LiveStatusCard status={status} onReset={() => {
        setStatus({ phase: "idle" });
        setTo(""); setAmount("");
      }} />
    </Card>
  );
}

function ResolveHint({ state }: { state: ResolveStatus }) {
  if (state.phase === "idle") return null;
  if (state.phase === "address") {
    return (
      <p className="text-xs text-emerald-300/80 mt-1 flex items-center gap-1">
        <Check className="h-3 w-3" /> Direct address — will send straight to this account.
      </p>
    );
  }
  if (state.phase === "resolving") {
    return (
      <p className="text-xs text-sky-300/80 mt-1 flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Looking up{" "}
        <code className="font-mono">{state.canonical}</code> on chain…
      </p>
    );
  }
  if (state.phase === "resolved") {
    const addr = state.record.address ?? "";
    return (
      <div className="mt-1 rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-200">
        <div className="flex items-center gap-1 font-semibold">
          <Check className="h-3 w-3" /> Resolved {state.canonical}
          {state.record.name ? ` · ${state.record.name}` : ""}
        </div>
        <code className="block mt-1 font-mono text-[11px] break-all text-foreground">
          {addr}
        </code>
      </div>
    );
  }
  if (state.phase === "missing") {
    return (
      <p className="text-xs text-amber-300/90 mt-1 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />{" "}
        <code className="font-mono">{state.canonical}</code> is not registered yet.
      </p>
    );
  }
  if (state.phase === "invalid") {
    return (
      <p className="text-xs text-red-400 mt-1">
        Recipient must be a 0x address (40 hex chars) or a Pay-ID handle (3–25
        chars, lowercase a–z / 0–9 / underscore, optional <code>@zbx</code> suffix). {state.reason}
      </p>
    );
  }
  return (
    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
      <X className="h-3 w-3" /> Lookup failed: {state.message}
    </p>
  );
}

function ReviewRow({ label, value, mono, highlight }: {
  label: string; value: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-0">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-right break-all max-w-[68%] ${mono ? "font-mono text-xs" : ""} ${highlight ? "font-bold text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function LiveStatusCard({ status, onReset }: { status: LiveStatus; onReset: () => void }) {
  if (status.phase === "idle") return null;

  const Wrapper: React.FC<React.PropsWithChildren<{ tone: string }>> = ({ tone, children }) => (
    <div className={`rounded-md border p-3 text-xs space-y-1 ${tone}`}>{children}</div>
  );

  if (status.phase === "signing") {
    return (
      <Wrapper tone="border-sky-500/30 bg-sky-500/5 text-sky-200">
        <div className="flex items-center gap-2 font-semibold"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Signing…</div>
      </Wrapper>
    );
  }
  if (status.phase === "submitting") {
    return (
      <Wrapper tone="border-sky-500/30 bg-sky-500/5 text-sky-200">
        <div className="flex items-center gap-2 font-semibold"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Broadcasting to mempool…</div>
      </Wrapper>
    );
  }
  if (status.phase === "in-mempool") {
    return (
      <Wrapper tone="border-amber-500/30 bg-amber-500/5 text-amber-200">
        <div className="flex items-center gap-2 font-semibold">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          In mempool · waiting for inclusion ({status.secs}s)
        </div>
        <code className="block font-mono text-[11px] break-all text-foreground">{status.hash}</code>
        <WLink href={`/block-explorer?q=${status.hash}`}>
          <a className="inline-flex items-center gap-1 text-amber-300 hover:underline">
            View in explorer <ExternalLink className="h-3 w-3" />
          </a>
        </WLink>
      </Wrapper>
    );
  }
  if (status.phase === "included") {
    const ok = status.status === "success";
    return (
      <Wrapper tone={ok
        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
        : "border-red-500/30 bg-red-500/5 text-red-200"}>
        <div className="flex items-center gap-2 font-semibold">
          {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          {ok ? "Confirmed" : "Reverted"} at block #{status.block.toLocaleString()}
        </div>
        <code className="block font-mono text-[11px] break-all text-foreground">{status.hash}</code>
        <div className="flex items-center gap-3 pt-1">
          <WLink href={`/block-explorer?q=${status.hash}`}>
            <a className="inline-flex items-center gap-1 text-foreground hover:underline">
              Open in explorer <ExternalLink className="h-3 w-3" />
            </a>
          </WLink>
          <button onClick={onReset} className="text-muted-foreground hover:text-foreground">Send another</button>
        </div>
      </Wrapper>
    );
  }
  return (
    <Wrapper tone="border-red-500/30 bg-red-500/5 text-red-300">
      <div className="flex items-center gap-2 font-semibold"><X className="h-3.5 w-3.5" /> Failed</div>
      <div className="text-[11px] break-all">{status.message}</div>
      <button onClick={onReset} className="text-muted-foreground hover:text-foreground">Reset</button>
    </Wrapper>
  );
}

// ───── MetaMask tab ──────────────────────────────────────────────────────────
function MetaMaskTab({ onSent }: { onSent: () => void }) {
  const { toast } = useToast();
  const [account, setAccount] = useState<string | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [data, setData] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<LiveStatus>({ phase: "idle" });
  const mountedRef = useRef(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, []);
  const safeSet = (s: LiveStatus) => { if (mountedRef.current) setStatus(s); };

  useEffect(() => {
    if (!hasEthProvider()) return;
    getCurrentChainIdHex().then(setChain).catch(() => undefined);
    const off = onProviderEvents({
      onAccounts: (acc) => setAccount(acc[0] ?? null),
      onChain: (c) => setChain(c),
    });
    return off;
  }, []);

  const onChainOk = chain === ZEBVIX_CHAIN_ID_HEX;

  const connect = async () => {
    setBusy(true);
    try {
      const accs = await requestAccounts();
      setAccount(accs[0] ?? null);
      const c = await getCurrentChainIdHex();
      setChain(c);
      toast({ title: "Connected", description: accs[0] ?? "" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Connect failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const switchChain = async () => {
    setBusy(true);
    try {
      await switchOrAddZebvixChain();
      const c = await getCurrentChainIdHex();
      setChain(c);
      toast({ title: "Switched to Zebvix" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Switch failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!hasEthProvider()) {
    return (
      <Card className="p-6 text-sm text-muted-foreground space-y-2">
        <div className="font-semibold text-foreground flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" /> No EVM wallet detected
        </div>
        <div>
          Install MetaMask (or another EIP-1193 wallet) to send Solidity-style transactions
          on Zebvix. Once installed, refresh this page and click <strong>Connect</strong>.
        </div>
      </Card>
    );
  }

  if (!account) {
    return (
      <Card className="p-6 text-sm space-y-3">
        <div className="font-semibold text-foreground">Connect MetaMask</div>
        <div className="text-muted-foreground text-xs">
          You will be prompted to share your selected account. Zebvix uses the same
          secp256k1 / keccak256 address derivation as Ethereum, so any MetaMask account works.
        </div>
        <Button onClick={connect} disabled={busy} data-testid="button-mm-connect">
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Link2 className="h-4 w-4 mr-1.5" />}
          Connect MetaMask
        </Button>
      </Card>
    );
  }

  const validAddr = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const validAmt = /^\d+(\.\d+)?$/.test(amount.trim()) && parseFloat(amount) >= 0;
  const validData = !data || /^0x[0-9a-fA-F]*$/.test(data.trim());
  const canReview = validAddr && validAmt && validData && onChainOk;

  const submit = async () => {
    if (!account) return;
    safeSet({ phase: "submitting" });
    let hash = "";
    const ts = Date.now();
    try {
      hash = await sendMmTransaction({
        from: account,
        to: to.trim(),
        valueZbx: amount || "0",
        data: data.trim() || undefined,
      });
      recordTx({
        hash, from: account, to: to.trim(),
        amountZbx: amount || "0", feeZbx: "—",
        ts, status: "submitted", kind: "metamask",
        data: data.trim() || undefined,
      });
      safeSet({ phase: "in-mempool", hash, secs: 0 });
      if (mountedRef.current) onSent();
      toast({ title: "MetaMask submitted", description: hash });
      const startedAt = Date.now();
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = setInterval(() => {
        if (!mountedRef.current) return;
        setStatus((s) => s.phase === "in-mempool"
          ? { ...s, secs: Math.floor((Date.now() - startedAt) / 1000) } : s);
      }, 1000);
      const receipt = await pollReceipt(hash, { intervalMs: 4000, timeoutMs: 120_000 });
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      if (!mountedRef.current) return;
      if (!receipt) return;
      const block = hexToInt(receipt.blockNumber);
      const ok = receipt.status === "0x1";
      safeSet({ phase: "included", hash, block, status: ok ? "success" : "reverted" });
      updateTxByHash(hash, {
        block, confirmedTs: Date.now(),
        status: ok ? "confirmed" : "reverted",
      });
      if (mountedRef.current) onSent();
    } catch (e) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      const msg = e instanceof Error ? e.message : String(e);
      safeSet({ phase: "error", message: msg });
      if (hash) {
        updateTxByHash(hash, { status: "failed", error: msg });
      } else {
        recordTx({
          hash: null, from: account, to: to.trim(),
          amountZbx: amount || "0", feeZbx: "—",
          ts, status: "failed", error: msg, kind: "metamask",
          data: data.trim() || undefined,
        });
      }
      if (mountedRef.current) onSent();
      toast({ title: "MetaMask error", description: msg, variant: "destructive" });
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Connected</div>
          <code className="font-mono text-xs">{account}</code>
        </div>
        <Badge variant={onChainOk ? "default" : "outline"} className={onChainOk ? "bg-primary/20 text-primary border-primary/30" : "text-amber-300 border-amber-500/40"}>
          {onChainOk ? "On Zebvix" : `Wrong chain (${chain ?? "?"})`}
        </Badge>
      </div>

      {!onChainOk && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-2">
          <div className="text-amber-200">
            MetaMask is on chain <code>{chain}</code>. Switch to Zebvix Mainnet to send.
          </div>
          <Button size="sm" onClick={switchChain} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Switch to Zebvix
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <Label htmlFor="mm-to">To</Label>
          <Input id="mm-to" placeholder="0x… (recipient or contract)"
            value={to} onChange={(e) => setTo(e.target.value)}
            className="font-mono" data-testid="input-mm-to" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="mm-val">Value (ZBX)</Label>
            <Input id="mm-val" type="number" min="0" step="0.0001"
              placeholder="0.0" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-mm-amount" />
          </div>
          <div>
            <Label htmlFor="mm-data">Calldata (hex, optional)</Label>
            <Input id="mm-data" placeholder="0x…"
              value={data} onChange={(e) => setData(e.target.value)}
              className="font-mono text-xs" data-testid="input-mm-data" />
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button disabled={!canReview} className="w-full" data-testid="button-mm-review">
            <Send className="h-4 w-4 mr-1.5" /> Review (then MetaMask popup)
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Confirm transaction
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <ReviewRow label="Provider" value="MetaMask (EIP-1193)" />
            <ReviewRow label="From" value={account ?? ""} mono />
            <ReviewRow label="To" value={to.trim()} mono />
            <ReviewRow label="Value" value={`${amount || "0"} ZBX`} highlight />
            {data.trim() && <ReviewRow label="Data" value={data.trim()} mono />}
            <ReviewRow label="Chain id" value={`${CHAIN_ID_HEX} (${CHAIN_ID})`} mono />
            <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-xs text-sky-200">
              On Confirm, MetaMask will open its own native popup with the final gas
              estimate. The dashboard will then track the receipt.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => { setConfirmOpen(false); await submit(); }}
              data-testid="button-mm-confirm"
            >
              <Check className="h-4 w-4 mr-1.5" /> Confirm &amp; open MetaMask
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LiveStatusCard status={status} onReset={() => {
        setStatus({ phase: "idle" });
        setTo(""); setAmount(""); setData("");
      }} />
    </Card>
  );
}

// ───── History tab ───────────────────────────────────────────────────────────
function HistoryTab(props: {
  history: TxRecord[];
  onClear: () => void;
  onCopy: (t: string, l?: string) => void;
}) {
  const { history, onClear, onCopy } = props;
  if (history.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No transactions yet from this browser.
      </Card>
    );
  }
  const colorFor = (s: TxRecord["status"]) => {
    if (s === "confirmed") return "text-emerald-400 border-emerald-500/30 bg-emerald-500/5";
    if (s === "submitted" || s === "included") return "text-amber-400 border-amber-500/30 bg-amber-500/5";
    if (s === "failed" || s === "reverted") return "text-red-400 border-red-500/30 bg-red-500/5";
    return "text-muted-foreground border-border";
  };

  const counts = {
    confirmed: history.filter((r) => r.status === "confirmed").length,
    pending: history.filter((r) => r.status === "submitted" || r.status === "included").length,
    failed: history.filter((r) => r.status === "failed" || r.status === "reverted").length,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground" data-testid="text-history-summary">
          Total: <span className="font-bold text-foreground">{history.length}</span>
          <span className="ml-3 text-emerald-400">{counts.confirmed} confirmed</span>
          {counts.pending > 0 && <span className="ml-2 text-amber-400">{counts.pending} pending</span>}
          {counts.failed > 0 && <span className="ml-2 text-red-400">{counts.failed} failed</span>}
        </div>
        <Button variant="outline" size="sm" onClick={onClear}>
          <Trash2 className="h-3 w-3 mr-1.5" /> Clear history
        </Button>
      </div>
      {history.map((r, i) => (
        <Card key={i} className={`p-3 border ${colorFor(r.status)}`}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="text-xs uppercase tracking-wider font-semibold flex items-center gap-2">
              {r.status}
              {r.kind && <Badge variant="outline" className="text-[9px] px-1 py-0">{r.kind}</Badge>}
              <span className="text-muted-foreground">· {new Date(r.ts).toLocaleString()}</span>
            </div>
            <div className="text-sm font-bold">-{r.amountZbx} ZBX</div>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>to <code className="font-mono">{shortAddr(r.to)}</code></div>
            {typeof r.block === "number" && <div>block #{r.block.toLocaleString()}</div>}
            {r.hash && (
              <div className="flex items-center gap-2">
                <button onClick={() => onCopy(r.hash!, "Hash copied")}
                  className="font-mono text-[10px] hover:text-foreground flex items-center gap-1">
                  {r.hash} <Copy className="h-3 w-3" />
                </button>
                <WLink href={`/block-explorer?q=${r.hash}`}>
                  <a className="text-[10px] text-primary hover:underline inline-flex items-center gap-1">
                    open <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </WLink>
              </div>
            )}
            {r.error && <div className="text-red-400 text-[11px]">err: {r.error}</div>}
          </div>
        </Card>
      ))}
    </div>
  );
}
