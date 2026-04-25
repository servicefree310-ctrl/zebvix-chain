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
import { Link as WLink } from "wouter";
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
  type EthReceipt,
} from "@/lib/zbx-rpc";
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

const CHAIN_ID = 7878;
const CHAIN_ID_HEX = "0x1ec6";

function copy(text: string, toast: ReturnType<typeof useToast>["toast"], label = "Copied") {
  navigator.clipboard.writeText(text);
  toast({ title: label, description: text.length > 60 ? text.slice(0, 60) + "…" : text });
}

export default function WalletPage() {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [balance, setBalance] = useState<string>("—");
  const [nonce, setNonce] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const activeWallet = useMemo(
    () => wallets.find((w) => w.address === active) ?? null,
    [wallets, active],
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">ZBX Wallet</h1>
        <p className="text-lg text-muted-foreground">
          Hot-wallet for Zebvix mainnet — native send with confirmation preview, MetaMask
          flow for Solidity tx, plus live receipt tracking. Chain id <code className="text-xs">0x1ec6</code> · 18 dec ZBX.
        </p>
      </div>

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

      <ActiveCard
        wallet={activeWallet}
        balance={balance}
        nonce={nonce}
        refreshing={refreshing}
        onRefresh={() => refreshBalance(active)}
        onCopy={(t, l) => copy(t, toast, l)}
      />

      <Tabs defaultValue="send" className="space-y-4">
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
            onSent={() => { refreshBalance(active); setHistory(loadHistory()); }}
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
  onRefresh: () => void;
  onCopy: (t: string, l?: string) => void;
}) {
  const { wallet, balance, nonce, refreshing, onRefresh, onCopy } = props;
  if (!wallet) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No wallet selected — go to <strong>Manage</strong> and create or import one.
      </Card>
    );
  }
  return (
    <Card className="p-5 space-y-3 border-primary/20">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Active wallet · {wallet.label}
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

function SendTab(props: {
  active: StoredWallet | null;
  balance: string;
  nonce: number | null;
  onSent: () => void;
}) {
  const { active, balance, nonce, onSent } = props;
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("0.002");
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

  if (!active) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Pick or create a wallet first.
      </Card>
    );
  }

  const validAddr = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const validAmt = /^\d+(\.\d+)?$/.test(amount.trim()) && parseFloat(amount) > 0;
  const canReview = validAddr && validAmt;

  const totalWei = (() => {
    if (!validAmt) return 0n;
    try { return zbxToWei(amount) + zbxToWei(fee || "0"); } catch { return 0n; }
  })();
  const totalZbx = (() => {
    if (totalWei === 0n) return "—";
    return weiHexToZbx("0x" + totalWei.toString(16));
  })();

  const submit = async () => {
    safeSet({ phase: "signing" });
    const ts = Date.now();
    let hash = "";
    try {
      safeSet({ phase: "submitting" });
      const r = await sendTransfer({
        privateKeyHex: active.privateKey,
        to: to.trim(),
        amountZbx: amount,
        feeZbx: fee || "0.002",
      });
      hash = r.hash;
      recordTx({
        hash, from: active.address, to: to.trim(),
        amountZbx: amount, feeZbx: fee || "0.002",
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
        hash: hash || null, from: active.address, to: to.trim(),
        amountZbx: amount, feeZbx: fee || "0.002",
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
        <Label htmlFor="to">Recipient address</Label>
        <Input id="to" placeholder="0x…" value={to}
          onChange={(e) => setTo(e.target.value)}
          className="font-mono" data-testid="input-send-to" />
        {to && !validAddr && (
          <p className="text-xs text-red-400 mt-1">Address must be 0x + 40 hex chars.</p>
        )}
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
            value={fee} onChange={(e) => setFee(e.target.value)}
            data-testid="input-send-fee" />
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button disabled={!canReview} className="w-full" data-testid="button-review">
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
            <ReviewRow label="To" value={to.trim()} mono />
            <ReviewRow label="Amount" value={`${amount} ZBX`} />
            <ReviewRow label="Fee" value={`${fee || "0.002"} ZBX`} />
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
