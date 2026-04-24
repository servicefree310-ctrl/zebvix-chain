import React, { useEffect, useState } from "react";
import {
  Wallet,
  Plus,
  KeyRound,
  Send,
  Copy,
  Trash2,
  Download,
  Check,
  AlertTriangle,
  RefreshCw,
  History,
  EyeOff,
  Eye,
} from "lucide-react";
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
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import {
  StoredWallet,
  TxRecord,
  loadWallets,
  loadHistory,
  recordTx,
  clearHistory,
  generateWallet,
  importWalletFromHex,
  addWallet,
  removeWallet,
  getActiveAddress,
  setActiveAddress,
  getWallet,
  sendTransfer,
  parseNonce,
} from "@/lib/web-wallet";

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

  // ── load on mount ─────────────────────────────────────────────────────
  const reloadWallets = () => {
    const ws = loadWallets();
    setWallets(ws);
    const a = getActiveAddress();
    setActive(a && ws.some(w => w.address === a) ? a : ws[0]?.address ?? null);
    setHistory(loadHistory());
  };
  useEffect(() => { reloadWallets(); }, []);

  // ── refresh balance / nonce when active changes ───────────────────────
  const refreshBalance = async (addr: string | null) => {
    if (!addr) { setBalance("—"); setNonce(null); return; }
    setRefreshing(true);
    try {
      const [bal, n] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]),
        rpc<unknown>("zbx_getNonce", [addr]),
      ]);
      setBalance(weiHexToZbx(bal));
      setNonce(parseNonce(n));
    } catch (e) {
      setBalance("error");
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => { refreshBalance(active); }, [active]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
          ZBX Web Wallet
        </h1>
        <p className="text-sm text-muted-foreground">
          Create or import a wallet, view your live balance, and send ZBX directly from the browser.
          Keys are stored in this browser only — back up the keystore JSON.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300/90 flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Hot-wallet only. Private keys are stored unencrypted in localStorage.
          Use this for testing / small amounts. For mainnet treasury, use the multisig flow.
        </span>
      </div>

      {/* Active wallet panel */}
      <ActiveWalletCard
        wallet={active ? getWallet(active) : null}
        balance={balance}
        nonce={nonce}
        refreshing={refreshing}
        onRefresh={() => refreshBalance(active)}
        onCopy={(t, l) => copy(t, toast, l)}
      />

      <Tabs defaultValue="manage" className="w-full">
        <TabsList>
          <TabsTrigger value="manage">
            <Wallet className="h-4 w-4 mr-1.5" /> Wallets
          </TabsTrigger>
          <TabsTrigger value="send">
            <Send className="h-4 w-4 mr-1.5" /> Send
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-4 w-4 mr-1.5" /> History
            {history.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
                {history.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-4 pt-4">
          <ManageTab
            wallets={wallets}
            active={active}
            onPick={(a) => { setActiveAddress(a); setActive(a); }}
            onChange={reloadWallets}
            onCopy={(t, l) => copy(t, toast, l)}
          />
        </TabsContent>

        <TabsContent value="send" className="pt-4">
          <SendTab
            active={active ? getWallet(active) : null}
            balance={balance}
            onSent={() => {
              setHistory(loadHistory());
              refreshBalance(active);
            }}
          />
        </TabsContent>

        <TabsContent value="history" className="pt-4">
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

// ───── Active wallet summary ─────────────────────────────────────────────────
function ActiveWalletCard(props: {
  wallet: StoredWallet | null;
  balance: string; nonce: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  onCopy: (t: string, l?: string) => void;
}) {
  const { wallet, balance, nonce, refreshing, onRefresh, onCopy } = props;
  if (!wallet) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No wallet selected. Create one in the <strong>Wallets</strong> tab.
      </Card>
    );
  }
  return (
    <Card className="p-5 bg-gradient-to-br from-primary/10 via-card to-card border-primary/20">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Active wallet — {wallet.label}
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
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          data-testid="button-refresh-balance"
        >
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
          <div className="text-[10px] text-muted-foreground mt-0.5">
            confirmed on-chain
          </div>
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
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
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
            <DialogHeader>
              <DialogTitle>Create new wallet</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label>Label (for your reference)</Label>
              <Input
                placeholder="e.g. Treasury"
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                data-testid="input-create-label"
              />
              <p className="text-xs text-muted-foreground">
                A fresh ed25519 keypair will be generated using your browser's crypto RNG.
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
              <Input
                placeholder="e.g. Validator"
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
              />
              <Label>Private key (64 hex, with or without 0x)</Label>
              <Input
                placeholder="0x..."
                value={importHex}
                onChange={(e) => setImportHex(e.target.value)}
                data-testid="input-import-key"
                className="font-mono"
              />
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
              <Card
                key={w.address}
                className={`p-4 ${isActive ? "border-primary/50 bg-primary/5" : ""}`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Wallet className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        {w.label}
                        {isActive && <Badge variant="default" className="text-[10px]">active</Badge>}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground truncate">
                        {w.address}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isActive && (
                      <Button size="sm" variant="outline" onClick={() => onPick(w.address)}>
                        Use
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" title="Copy address"
                      onClick={() => onCopy(w.address, "Address copied")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Export keystore JSON"
                      onClick={() => handleExport(w)}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Delete from this browser"
                      onClick={() => handleDelete(w)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setShowSecret(s => ({ ...s, [w.address]: !s[w.address] }))}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    {isShown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {isShown ? "Hide" : "Reveal"} private key
                  </button>
                  {isShown && (
                    <code className="font-mono text-[10px] text-amber-300 break-all flex-1">
                      {w.privateKey}
                    </code>
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

// ───── Send tab ──────────────────────────────────────────────────────────────
function SendTab(props: {
  active: StoredWallet | null;
  balance: string;
  onSent: () => void;
}) {
  const { active, balance, onSent } = props;
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("0.002");
  const [busy, setBusy] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(null);

  if (!active) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Pick or create a wallet first.
      </Card>
    );
  }

  const validAddr = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const validAmt = /^\d+(\.\d+)?$/.test(amount.trim()) && parseFloat(amount) > 0;
  const canSend = validAddr && validAmt && !busy;

  const submit = async () => {
    setBusy(true); setLastHash(null);
    const ts = Date.now();
    try {
      const r = await sendTransfer({
        privateKeyHex: active.privateKey,
        to: to.trim(),
        amountZbx: amount,
        feeZbx: fee || "0.002",
      });
      recordTx({
        hash: r.hash, from: active.address, to: to.trim(),
        amountZbx: amount, feeZbx: fee || "0.002",
        ts, status: "submitted",
      });
      setLastHash(r.hash);
      toast({
        title: "Transaction submitted",
        description: r.hash || "(no hash returned)",
      });
      setTo(""); setAmount("");
      onSent();
    } catch (e: any) {
      recordTx({
        hash: null, from: active.address, to: to.trim(),
        amountZbx: amount, feeZbx: fee || "0.002",
        ts, status: "failed", error: e.message,
      });
      toast({
        title: "Send failed",
        description: e.message,
        variant: "destructive",
      });
      onSent();
    } finally {
      setBusy(false);
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
        <Input id="to"
          placeholder="0x…"
          value={to} onChange={e => setTo(e.target.value)}
          className="font-mono"
          data-testid="input-send-to"
        />
        {to && !validAddr && (
          <p className="text-xs text-red-400 mt-1">Address must be 0x + 40 hex chars.</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="amt">Amount (ZBX)</Label>
          <Input id="amt" type="number" min="0" step="0.0001"
            placeholder="0.0"
            value={amount} onChange={e => setAmount(e.target.value)}
            data-testid="input-send-amount"
          />
        </div>
        <div>
          <Label htmlFor="fee">Fee (ZBX)</Label>
          <Input id="fee" type="number" min="0" step="0.0001"
            value={fee} onChange={e => setFee(e.target.value)}
            data-testid="input-send-fee"
          />
        </div>
      </div>
      <Button onClick={submit} disabled={!canSend} className="w-full" data-testid="button-send">
        {busy ? "Sending…" : <><Send className="h-4 w-4 mr-1.5" />Sign & broadcast</>}
      </Button>
      {lastHash && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <Check className="h-3.5 w-3.5" /> Submitted to mempool
          </div>
          <code className="font-mono text-[11px] break-all text-foreground">{lastHash}</code>
          <div className="text-muted-foreground text-[10px]">
            On-chain confirmation needs a block to include this tx — check the History tab.
          </div>
        </div>
      )}
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
  const colorFor = (s: TxRecord["status"]) =>
    s === "submitted" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
      : s === "failed" ? "text-red-400 border-red-500/30 bg-red-500/5"
        : "text-amber-400 border-amber-500/30 bg-amber-500/5";

  const submitted = history.filter(r => r.status === "submitted").length;
  const failed = history.filter(r => r.status !== "submitted").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground" data-testid="text-history-summary">
          Total: <span className="font-bold text-foreground">{history.length}</span> transaction{history.length === 1 ? "" : "s"}
          <span className="ml-2 text-emerald-400">{submitted} submitted</span>
          {failed > 0 && <span className="ml-2 text-red-400">{failed} failed</span>}
        </div>
        <Button variant="outline" size="sm" onClick={onClear}>
          <Trash2 className="h-3 w-3 mr-1.5" /> Clear history
        </Button>
      </div>
      {history.map((r, i) => (
        <Card key={i} className={`p-3 border ${colorFor(r.status)}`}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="text-xs uppercase tracking-wider font-semibold">
              {r.status} · {new Date(r.ts).toLocaleString()}
            </div>
            <div className="text-sm font-bold">-{r.amountZbx} ZBX</div>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>to <code className="font-mono">{shortAddr(r.to)}</code></div>
            {r.hash && (
              <button onClick={() => onCopy(r.hash!, "Hash copied")}
                className="font-mono text-[10px] hover:text-foreground flex items-center gap-1">
                {r.hash} <Copy className="h-3 w-3" />
              </button>
            )}
            {r.error && <div className="text-red-400 text-[11px]">err: {r.error}</div>}
          </div>
        </Card>
      ))}
    </div>
  );
}
