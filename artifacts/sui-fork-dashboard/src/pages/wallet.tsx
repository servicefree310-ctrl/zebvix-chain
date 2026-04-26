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
  QrCode,
  Activity,
  DollarSign,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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
import { Smartphone, ShieldCheck } from "lucide-react";
import { VaultControls } from "@/components/wallet/VaultControls";
import {
  setupVault,
  vaultExists,
  vaultUnlocked,
} from "@/lib/wallet-vault";
import { PLAINTEXT_WALLETS_KEY } from "@/lib/web-wallet";
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

const TAB_VALUES = ["send", "receive", "manage", "history"] as const;
type TabValue = (typeof TAB_VALUES)[number];

interface PriceInfo {
  zbx_usd: string;
  source: string;
}

export default function WalletPage() {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [balance, setBalance] = useState<string>("—");
  const [nonce, setNonce] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [tipHeight, setTipHeight] = useState<number | null>(null);

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

  // Light, visibility-aware poll for price + tip so the wallet card shows
  // a live USD valuation and network heartbeat without hammering RPC.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      const [pr, tip] = await Promise.all([
        rpc<PriceInfo>("zbx_getPriceUSD").catch(() => null),
        rpc<{ height: number }>("zbx_blockNumber").catch(() => null),
      ]);
      if (cancelled) return;
      if (pr) setPrice(pr);
      if (tip && typeof tip.height === "number") setTipHeight(tip.height);
    };
    const start = () => {
      if (cancelled || timer !== undefined) return;
      timer = window.setInterval(tick, 15_000);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { tick(); start(); }
    };
    tick();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
          Production hot wallet for Zebvix mainnet — native send with confirmation preview,
          QR receive, encrypted local vault, and live receipt tracking. Chain id{" "}
          <code className="text-xs">0x1ec6</code> · 18 dec ZBX.
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
        price={price}
        tipHeight={tipHeight}
        onRefresh={() => refreshBalance(activeWallet?.address ?? null)}
        onCopy={(t, l) => copy(t, toast, l)}
        onReceive={() => onTabChange("receive")}
      />

      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="send" data-testid="tab-send">Send</TabsTrigger>
          <TabsTrigger value="receive" data-testid="tab-receive">Receive</TabsTrigger>
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

        <TabsContent value="receive">
          <ReceiveTab
            active={activeWallet}
            price={price}
            onCopy={(t, l) => copy(t, toast, l)}
          />
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
  price: PriceInfo | null;
  tipHeight: number | null;
  onRefresh: () => void;
  onCopy: (t: string, l?: string) => void;
  onReceive: () => void;
}) {
  const { wallet, balance, nonce, refreshing, isRemote, price, tipHeight, onRefresh, onCopy, onReceive } = props;
  if (!wallet) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground" data-testid="card-no-wallet">
        No wallet selected — go to <strong>Manage</strong> and create or import one.
      </Card>
    );
  }
  // Compute USD valuation from on-chain oracle. Both inputs may be partial
  // ("—" for balance pre-fetch, null for price pre-poll) — guard both before
  // doing arithmetic so we never render "NaN". `weiHexToZbx` formats with
  // grouping commas (e.g. "10,027.5"), so strip them before parsing or
  // every USD readout becomes "NaN" → "—" for non-trivial balances.
  const balNum = Number(balance.replace(/,/g, ""));
  const priceNum = price ? Number(price.zbx_usd) : NaN;
  const usd =
    Number.isFinite(balNum) && Number.isFinite(priceNum)
      ? balNum * priceNum
      : null;
  const usdLabel =
    usd === null
      ? "—"
      : usd >= 1
        ? `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  return (
    <Card
      className={`p-5 space-y-4 ${isRemote ? "border-cyan-500/40" : "border-primary/20"}`}
      data-testid="card-active-wallet"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
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
            className="font-mono text-xs sm:text-sm text-foreground hover:text-primary transition flex items-center gap-1.5 break-all text-left"
            onClick={() => onCopy(wallet.address, "Address copied")}
            title="Click to copy"
            data-testid="button-copy-active-address"
          >
            <span className="break-all">{wallet.address}</span>
            <Copy className="h-3 w-3 flex-shrink-0" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReceive}
            data-testid="button-quick-receive"
          >
            <QrCode className="h-4 w-4 mr-1.5" /> Receive
          </Button>
          <WLink href={`/block-explorer?q=${wallet.address}`}>
            <a>
              <Button variant="outline" size="sm" data-testid="link-explorer-active">
                <ExternalLink className="h-4 w-4 mr-1.5" /> Explorer
              </Button>
            </a>
          </WLink>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            data-testid="button-refresh-balance"
            title="Refresh balance & nonce"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-muted-foreground">Balance</div>
          <div className="text-2xl font-bold text-primary leading-tight" data-testid="text-balance">
            {balance} <span className="text-sm font-normal text-muted-foreground">ZBX</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1" data-testid="text-balance-usd">
            <DollarSign className="h-3 w-3" />
            <span>{usdLabel}</span>
            {price && (
              <span className="opacity-60">· @ ${Number(price.zbx_usd).toFixed(4)}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total transactions</div>
          <div className="text-2xl font-bold" data-testid="text-total-tx">{nonce ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">confirmed on-chain</div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground">Network</div>
          <div className="text-2xl font-bold flex items-center gap-2" data-testid="text-network-tip">
            <span className={`inline-block h-2 w-2 rounded-full ${tipHeight !== null ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"}`} />
            <span>{tipHeight !== null ? `#${tipHeight.toLocaleString()}` : "—"}</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Zebvix mainnet · 0x1ec6
          </div>
        </div>
      </div>
    </Card>
  );
}

// ───── Receive tab — QR code + address + optional amount request ─────────────
function ReceiveTab(props: {
  active: StoredWallet | null;
  price: PriceInfo | null;
  onCopy: (t: string, l?: string) => void;
}) {
  const { active, price, onCopy } = props;
  const [amount, setAmount] = useState("");

  if (!active) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground" data-testid="card-receive-empty">
        No wallet selected — open <strong>Manage</strong> and create or import a wallet first.
      </Card>
    );
  }

  // EIP-681 payment URI — wallets that scan this QR will pre-fill the
  // recipient + chain id + amount. Derive `validAmt` from the same parser
  // (`zbxToWei`) the encoder uses so the UI label and the QR payload can
  // never disagree (e.g. "1.", "1e3", ">18 decimals" all reject identically).
  const trimmedAmt = amount.trim();
  let weiStr = "";
  let parsedAmtNum: number | null = null;
  if (trimmedAmt !== "") {
    try {
      const wei = zbxToWei(trimmedAmt);
      if (wei > 0n) {
        weiStr = wei.toString();
        const n = Number(trimmedAmt);
        if (Number.isFinite(n)) parsedAmtNum = n;
      }
    } catch {
      weiStr = "";
    }
  }
  const validAmt = weiStr !== "";
  const uri = validAmt
    ? `ethereum:${active.address}@${CHAIN_ID}?value=${weiStr}`
    : active.address;
  const usdEquiv =
    validAmt && parsedAmtNum !== null && price && Number.isFinite(Number(price.zbx_usd))
      ? parsedAmtNum * Number(price.zbx_usd)
      : null;

  return (
    <Card className="p-6 space-y-5" data-testid="card-receive">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <QrCode className="h-4 w-4 text-primary" />
        <span>
          Scan to pay <strong className="text-foreground">{active.label}</strong> on Zebvix mainnet.
          Compatible with any EVM wallet that supports EIP-681 payment URIs.
        </span>
      </div>

      <div className="grid md:grid-cols-[auto_1fr] gap-6 items-start">
        <div className="bg-white p-4 rounded-lg shadow-sm mx-auto md:mx-0" data-testid="qr-receive">
          <QRCodeSVG
            value={uri}
            size={208}
            level="M"
            includeMargin={false}
          />
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Address</Label>
            <button
              className="mt-1 w-full text-left font-mono text-xs sm:text-sm bg-muted/40 hover:bg-muted/60 transition rounded-md px-3 py-2 flex items-center justify-between gap-2 break-all"
              onClick={() => onCopy(active.address, "Address copied")}
              data-testid="button-copy-receive-address"
            >
              <span className="break-all">{active.address}</span>
              <Copy className="h-3.5 w-3.5 flex-shrink-0" />
            </button>
          </div>

          <div>
            <Label htmlFor="receive-amount" className="text-xs text-muted-foreground">
              Request amount (optional)
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id="receive-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="input-receive-amount"
              />
              <span className="text-sm font-medium text-muted-foreground">ZBX</span>
            </div>
            {amount.trim() !== "" && !validAmt && (
              <div className="mt-1 text-xs text-amber-300 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Enter a positive number — QR is showing the address only.
              </div>
            )}
            {validAmt && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                QR encodes {amount.trim()} ZBX
                {usdEquiv !== null && (
                  <> · ≈ ${usdEquiv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCopy(uri, validAmt ? "Payment link copied" : "Address copied")}
              data-testid="button-copy-payment-link"
            >
              <Link2 className="h-4 w-4 mr-1.5" />
              {validAmt ? "Copy payment link" : "Copy address"}
            </Button>
            <WLink href={`/block-explorer?q=${active.address}`}>
              <a>
                <Button variant="outline" size="sm" data-testid="link-explorer-receive">
                  <ExternalLink className="h-4 w-4 mr-1.5" /> View on explorer
                </Button>
              </a>
            </WLink>
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-200/80 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Only send native ZBX on Zebvix mainnet (chain id <code>0x1ec6</code>) to this
              address. Tokens from other chains may be unrecoverable.
            </span>
          </div>
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
  // Pull the global refresh from wallet-context so we can re-sample
  // `vaultState` / `vaultReady` after `setupVault()`. Without this,
  // bypass-site components (wallet-picker, import-wallet, payid-register)
  // would keep seeing `vaultState === "missing"` until a tab refresh,
  // and would redirect users back to the gate even though the vault is
  // already provisioned and unlocked. Storage events do not fire for
  // same-tab writes, so explicit refresh is mandatory.
  const { refresh: refreshWalletContext } = useWallet();
  const [importHex, setImportHex] = useState("");
  const [importLabel, setImportLabel] = useState("Imported");
  const [createLabel, setCreateLabel] = useState("Wallet");
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Encrypted-by-default gate: when no vault exists, the user must set a
  // password before any private key can be minted into local storage. The
  // gate dialog remembers which action ("create" | "import") triggered it
  // so we can resume that flow once the vault is provisioned.
  const [gateOpen, setGateOpen] = useState(false);
  const [gatePending, setGatePending] = useState<"create" | "import" | null>(
    null,
  );
  const [gatePw, setGatePw] = useState("");
  const [gatePw2, setGatePw2] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateErr, setGateErr] = useState<string | null>(null);

  const closeGate = () => {
    setGateOpen(false);
    setGatePending(null);
    setGatePw("");
    setGatePw2("");
    setGateErr(null);
    setGateBusy(false);
  };

  /**
   * Returns `true` when the caller may proceed with the wallet-mint
   * operation. When `false`, the gate dialog has been opened and the
   * dialog's submit handler will resume the requested action via
   * `gatePending`.
   */
  const ensureVaultReady = (action: "create" | "import"): boolean => {
    if (vaultExists() && vaultUnlocked()) return true;
    if (vaultExists() && !vaultUnlocked()) {
      // The locked-vault banner already provides Unlock; nudge the user.
      toast({
        title: "Wallet is locked",
        description:
          "Unlock your encrypted wallet vault first using the banner above.",
        variant: "destructive",
      });
      return false;
    }
    setGatePending(action);
    setGateOpen(true);
    return false;
  };

  const onGateSubmit = async () => {
    setGateErr(null);
    if (gatePw.length < 8) {
      setGateErr("Password must be at least 8 characters");
      return;
    }
    if (gatePw !== gatePw2) {
      setGateErr("Passwords do not match");
      return;
    }
    setGateBusy(true);
    try {
      await setupVault(gatePw, PLAINTEXT_WALLETS_KEY);
      const next = gatePending;
      // Refresh BOTH the local wallet list AND the global wallet-context
      // so the picker / import / payid bypass guards re-sample
      // `vaultReady` immediately. Storage events do NOT fire for
      // same-tab writes — without this explicit context refresh the
      // guards would keep redirecting users to the gate even though
      // setup just succeeded.
      onChange();
      refreshWalletContext();
      closeGate();
      // Resume the originally-requested action now that the vault is live.
      if (next === "create") setCreateOpen(true);
      else if (next === "import") setImportOpen(true);
    } catch (e) {
      setGateErr(e instanceof Error ? e.message : String(e));
      setGateBusy(false);
    }
  };

  const requestCreate = () => {
    if (!ensureVaultReady("create")) return;
    setCreateOpen(true);
  };
  const requestImport = () => {
    if (!ensureVaultReady("import")) return;
    setImportOpen(true);
  };

  // Auto-open the gate dialog when arriving from a bypass-site redirect
  // such as `/wallet?tab=manage&gate=create` (sent by WalletPicker /
  // ImportWallet / PayId pages when they detect a missing vault). We
  // strip the `gate` param after consuming it so a refresh doesn't keep
  // re-triggering the dialog.
  const search = useSearch();
  const [, setLocation] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(search);
    const gate = params.get("gate");
    if (!gate) return;
    if (gate === "create" || gate === "import") {
      // Only open if a vault doesn't already exist — otherwise the user
      // is redirected for "locked" state, not for "needs setup".
      if (!vaultExists()) {
        setGatePending(gate);
        setGateOpen(true);
      }
      // Strip the param so it doesn't fire again on re-render / refresh.
      params.delete("gate");
      const qs = params.toString();
      setLocation(`/wallet${qs ? `?${qs}` : ""}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleCreate = () => {
    try {
      const w = generateWallet(createLabel || "Wallet");
      addWallet(w);
      onChange();
      setCreateOpen(false);
      toast({ title: "Wallet created", description: w.address });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        title: "Create failed",
        description: msg,
        variant: "destructive",
      });
    }
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
        {/* Create button — routes through `requestCreate` so the encrypted
            vault is set up first when one doesn't exist yet. */}
        <Button onClick={requestCreate} data-testid="button-create-wallet">
          <Plus className="h-4 w-4 mr-1.5" /> Create new wallet
        </Button>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create new wallet</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <Label>Label (for your reference)</Label>
              <Input placeholder="e.g. Treasury" value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                data-testid="input-create-label" />
              <p className="text-xs text-muted-foreground">
                A fresh secp256k1 keypair will be generated using your browser&apos;s crypto RNG
                and saved into your encrypted vault. Export the keystore JSON afterwards
                if you want a backup.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} data-testid="button-confirm-create">Generate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import button — same gating: requires a vault before any private
            key is touched. */}
        <Button
          variant="outline"
          onClick={requestImport}
          data-testid="button-import-wallet"
        >
          <KeyRound className="h-4 w-4 mr-1.5" /> Import private key
        </Button>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
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

      {/* Encrypted-by-default gate dialog — opens automatically when the
          user clicks Create / Import while no vault exists. Provisions a
          fresh AES-GCM vault under a user-chosen password and then resumes
          the originally-requested action. */}
      <Dialog open={gateOpen} onOpenChange={(o) => (!o ? closeGate() : null)}>
        <DialogContent
          className="bg-zinc-950 border border-emerald-500/30"
          data-testid="dialog-vault-gate"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              Set a wallet password
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your private key will be encrypted at rest in this browser using
              AES-GCM (256-bit) derived from this password via PBKDF2-SHA256.
              We can&apos;t recover the password for you — losing it means
              losing access to your keys.
            </p>
            <Input
              type="password"
              placeholder="Password (min 8 chars)"
              value={gatePw}
              onChange={(e) => setGatePw(e.target.value)}
              data-testid="input-gate-password"
            />
            <Input
              type="password"
              placeholder="Confirm password"
              value={gatePw2}
              onChange={(e) => setGatePw2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && gatePw && gatePw2 && !gateBusy) {
                  void onGateSubmit();
                }
              }}
              data-testid="input-gate-password-confirm"
            />
            {gateErr && (
              <div className="text-xs text-red-400" data-testid="text-gate-error">
                {gateErr}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeGate} disabled={gateBusy}>
              Cancel
            </Button>
            <Button
              onClick={onGateSubmit}
              disabled={gateBusy || !gatePw || !gatePw2}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
              data-testid="button-gate-confirm"
            >
              {gateBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Encrypt and continue"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
