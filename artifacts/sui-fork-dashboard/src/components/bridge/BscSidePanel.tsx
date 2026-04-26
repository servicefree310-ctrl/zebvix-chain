import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link as WLink } from "wouter";
import {
  Wallet as WalletIcon,
  ExternalLink,
  Copy,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Flame,
  Activity,
  ShieldCheck,
  Network,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  approveWzbx,
  approveWzbxInBrowser,
  bscErc20Allowance,
  bscErc20Balance,
  bscNativeBalance,
  burnToZebvix,
  burnToZebvixInBrowser,
  connectMetaMask,
  ensureBscNetwork,
  fmtUnits18,
  getMetaMaskAccount,
  parseUnits18,
  watchWzbx,
  type BscBridgeConfig,
  type RelayerStatus,
} from "@/lib/bsc-bridge";
import { useWallet } from "@/contexts/wallet-context";

const API_BASE = "/api";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return (await r.json()) as T;
}

function CopyBtn({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast({ title: "Copied" });
      }}
      className="text-muted-foreground hover:text-foreground"
      title="Copy"
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a || a.length <= head + tail + 2) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

type SignerMode = "browser" | "metamask";

export default function BscSidePanel() {
  const { toast } = useToast();

  // ── Config + relayer ─────────────────────────────────────────────────
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

  // ── Signer mode toggle ──────────────────────────────────────────────
  const [mode, setMode] = useState<SignerMode>("browser");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── In-browser wallet — driven by the global WalletContext so same-tab
  //     wallet swaps (top-bar picker, /wallet page) refresh us immediately.
  const { wallets, active: activeWallet } = useWallet();
  const browserAddr = activeWallet?.address.toLowerCase() ?? null;
  const browserKey = activeWallet?.privateKey ?? null;

  // ── MetaMask wallet state (fallback) ────────────────────────────────
  const [mmAccount, setMmAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMetaMaskAccount().then((a) => {
      if (!cancelled) setMmAccount(a);
    });
    const eth = window.ethereum;
    if (eth?.on) {
      const handler = (...args: unknown[]) => {
        const accs = args[0] as string[] | undefined;
        setMmAccount(accs?.[0]?.toLowerCase() ?? null);
      };
      eth.on("accountsChanged", handler);
      return () => {
        cancelled = true;
        eth.removeListener?.("accountsChanged", handler);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Active account = whichever signer mode is active
  const account = mode === "browser" ? browserAddr : mmAccount;

  const onConnectMM = useCallback(async () => {
    setConnecting(true);
    try {
      const a = await connectMetaMask();
      setMmAccount(a);
      if (cfgQ.data) {
        await ensureBscNetwork(cfgQ.data).catch((e) => {
          toast({
            title: "Network not switched",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        });
      }
    } catch (e) {
      toast({
        title: "Connect failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setConnecting(false);
    }
  }, [cfgQ.data, toast]);

  const onAddToken = useCallback(async () => {
    if (!cfgQ.data) return;
    try {
      await watchWzbx(cfgQ.data);
      toast({ title: "wZBX added to MetaMask" });
    } catch (e) {
      toast({
        title: "Add token failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }, [cfgQ.data, toast]);

  // ── Balances on BSC for the active wallet ───────────────────────────
  const wzbxBalQ = useQuery({
    queryKey: ["bsc", "wzbx-bal", cfgQ.data?.wzbx_address ?? "", account ?? ""],
    queryFn: async () => {
      if (!cfgQ.data?.wzbx_address || !account) return null;
      return bscErc20Balance(cfgQ.data.bsc_rpc_url, cfgQ.data.wzbx_address, account);
    },
    enabled: !!(cfgQ.data?.wzbx_address && account),
    refetchInterval: 12_000,
  });

  const bnbBalQ = useQuery({
    queryKey: ["bsc", "bnb-bal", account ?? ""],
    queryFn: async () => {
      if (!cfgQ.data?.bsc_rpc_url || !account) return null;
      return bscNativeBalance(cfgQ.data.bsc_rpc_url, account);
    },
    enabled: !!(cfgQ.data?.bsc_rpc_url && account),
    refetchInterval: 12_000,
  });

  const allowanceQ = useQuery({
    queryKey: [
      "bsc",
      "allowance",
      cfgQ.data?.wzbx_address ?? "",
      cfgQ.data?.bridge_address ?? "",
      account ?? "",
    ],
    queryFn: async () => {
      if (!cfgQ.data?.wzbx_address || !cfgQ.data?.bridge_address || !account) return null;
      return bscErc20Allowance(
        cfgQ.data.bsc_rpc_url,
        cfgQ.data.wzbx_address,
        account,
        cfgQ.data.bridge_address,
      );
    },
    enabled: !!(cfgQ.data?.wzbx_address && cfgQ.data?.bridge_address && account),
    refetchInterval: 12_000,
  });

  // ── Burn form state ─────────────────────────────────────────────────
  const [destAddr, setDestAddr] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<{ hash: string; kind: "approve" | "burn" } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amountWei = useMemo(() => {
    if (!amountStr.trim()) return 0n;
    try {
      return parseUnits18(amountStr);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  // The bridge contract calls `wZBX.burnFrom(msg.sender, amount)` — this
  // requires the user to first `approve(bridge, amount)` so the bridge can
  // pull their wZBX. Two-step UX: approve, then burn. We auto-show the
  // approve button when current allowance < requested amount.
  // While allowance is still loading, treat as "needs approve" to avoid a
  // premature burn click that would revert. Once data arrives we re-evaluate.
  const allowanceKnown = allowanceQ.data !== null && allowanceQ.data !== undefined;
  const needsApprove =
    amountWei > 0n && (!allowanceKnown || (allowanceQ.data as bigint) < amountWei);

  const lowBnb = bnbBalQ.data !== undefined && bnbBalQ.data !== null && bnbBalQ.data < 100_000_000_000_000n; // < 0.0001 BNB

  async function onApprove() {
    if (!cfgQ.data || !account) return;
    setErr(null);
    setBusy(true);
    try {
      let hash: string;
      if (mode === "browser") {
        if (!browserKey) throw new Error("no in-browser wallet active");
        hash = await approveWzbxInBrowser(cfgQ.data, browserKey, amountWei);
      } else {
        await ensureBscNetwork(cfgQ.data);
        hash = await approveWzbx(cfgQ.data, account, amountWei);
      }
      setLastTx({ hash, kind: "approve" });
      toast({ title: "Approve submitted", description: shortAddr(hash, 10, 8) });
      setTimeout(() => allowanceQ.refetch(), 6_000);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      toast({ title: "Approve failed", description: m, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function onBurn() {
    if (!cfgQ.data || !account) return;
    setErr(null);
    setBusy(true);
    try {
      let hash: string;
      if (mode === "browser") {
        if (!browserKey) throw new Error("no in-browser wallet active");
        hash = await burnToZebvixInBrowser(cfgQ.data, browserKey, destAddr.trim(), amountWei);
      } else {
        await ensureBscNetwork(cfgQ.data);
        hash = await burnToZebvix(cfgQ.data, account, destAddr.trim(), amountWei);
      }
      setLastTx({ hash, kind: "burn" });
      toast({ title: "Burn submitted", description: shortAddr(hash, 10, 8) });
      setAmountStr("");
      setTimeout(() => {
        wzbxBalQ.refetch();
        allowanceQ.refetch();
        bnbBalQ.refetch();
      }, 6_000);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      toast({ title: "Burn failed", description: m, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────
  const cfg = cfgQ.data;
  const cfgReady = !!(cfg?.wzbx_address && cfg?.bridge_address);
  const explorerTx = (h: string) => `${cfg?.bsc_explorer ?? "https://bscscan.com"}/tx/${h}`;
  const explorerAddr = (a: string) => `${cfg?.bsc_explorer ?? "https://bscscan.com"}/address/${a}`;
  const burnDisabled =
    busy ||
    amountWei === 0n ||
    !account ||
    !cfgReady ||
    !/^0x[0-9a-fA-F]{40}$/.test(destAddr.trim()) ||
    (wzbxBalQ.data !== null && wzbxBalQ.data !== undefined && amountWei > wzbxBalQ.data) ||
    lowBnb;

  return (
    <Card className="p-6 space-y-4">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">BSC side · wZBX & reverse bridge</h2>
          <Badge variant="outline" className="ml-1 text-xs">
            {cfg?.bsc_chain_name ?? "BSC"}
          </Badge>
        </div>
        <RelayerBadge q={relayerQ.data} loading={relayerQ.isLoading} />
      </div>

      {/* ── Network indicator (one wallet, two chains) ───────────────── */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 flex items-center gap-3 text-xs">
        <Network className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1">
          <div className="font-semibold text-foreground">
            One wallet, two chains
          </div>
          <div className="text-muted-foreground mt-0.5">
            Your active in-browser wallet works on{" "}
            <Badge variant="outline" className="text-emerald-400 border-emerald-400/40 text-[10px] py-0">
              Zebvix L1 · 7878
            </Badge>{" "}
            <span className="mx-1">+</span>
            <Badge variant="outline" className="text-amber-400 border-amber-400/40 text-[10px] py-0">
              BSC · {cfg?.bsc_chain_id ?? 56}
            </Badge>{" "}
            (same secp256k1 key, ETH-standard derivation). No network switch needed.
          </div>
        </div>
      </div>

      {!cfgReady && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <div>
            <strong>Bridge contracts not yet deployed.</strong>
            <div className="text-xs text-muted-foreground mt-1">
              Operator: deploy <code>WrappedZBX</code> + <code>ZebvixBridge</code>{" "}
              with the Hardhat scripts in <code>lib/bsc-contracts</code>, then
              set <code>BSC_WZBX_ADDRESS</code> + <code>BSC_BRIDGE_ADDRESS</code>{" "}
              in api-server env.
            </div>
          </div>
        </div>
      )}

      {/* ── Contract addresses ──────────────────────────────────────── */}
      {cfg && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ContractCard
            label="wZBX (BEP-20)"
            address={cfg.wzbx_address}
            explorerUrl={cfg.wzbx_address ? explorerAddr(cfg.wzbx_address) : ""}
          />
          <ContractCard
            label="ZebvixBridge"
            address={cfg.bridge_address}
            explorerUrl={cfg.bridge_address ? explorerAddr(cfg.bridge_address) : ""}
          />
        </div>
      )}

      {/* ── Signer mode picker ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Signer:</span>
        <button
          onClick={() => setMode("browser")}
          className={`px-2 py-1 rounded border text-xs ${
            mode === "browser"
              ? "border-primary bg-primary/10 text-primary font-semibold"
              : "border-border/60 text-muted-foreground hover:text-foreground"
          }`}
        >
          In-browser wallet
        </button>
        <button
          onClick={() => setMode("metamask")}
          className={`px-2 py-1 rounded border text-xs ${
            mode === "metamask"
              ? "border-primary bg-primary/10 text-primary font-semibold"
              : "border-border/60 text-muted-foreground hover:text-foreground"
          }`}
        >
          MetaMask
        </button>
      </div>

      {/* ── Wallet card ─────────────────────────────────────────────── */}
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <WalletIcon className="h-4 w-4 text-primary" />
            {mode === "browser" ? "Active wallet (in-browser)" : "BSC wallet (MetaMask)"}
          </div>
          {mode === "metamask" && !mmAccount && (
            <Button size="sm" onClick={onConnectMM} disabled={connecting}>
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Connect
            </Button>
          )}
          {mode === "metamask" && mmAccount && (
            <Button size="sm" variant="outline" onClick={onAddToken} disabled={!cfgReady}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add wZBX
            </Button>
          )}
        </div>

        {mode === "browser" && !browserAddr && (
          <div className="text-xs text-muted-foreground space-y-2">
            <div>
              No active in-browser wallet. {wallets.length === 0
                ? "Create or import one to use the bridge."
                : "Select an active wallet first."}
            </div>
            <WLink
              href="/wallet"
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            >
              Open wallet manager <ExternalLink className="h-3 w-3" />
            </WLink>
          </div>
        )}

        {account && (
          <>
            <div className="font-mono text-xs break-all flex items-center gap-2">
              <a
                href={cfg ? explorerAddr(account) : "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary inline-flex items-center gap-1"
              >
                {account}
                <ExternalLink className="h-3 w-3" />
              </a>
              <CopyBtn value={account} />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <BalanceTile
                label="wZBX (BSC)"
                value={wzbxBalQ.data}
                loading={wzbxBalQ.isLoading}
                accent="text-primary"
                suffix="wZBX"
              />
              <BalanceTile
                label="BNB (gas)"
                value={bnbBalQ.data}
                loading={bnbBalQ.isLoading}
                accent={lowBnb ? "text-amber-400" : "text-foreground"}
                suffix="BNB"
              />
              <BalanceTile
                label="Allowance"
                value={allowanceQ.data}
                loading={allowanceQ.isLoading}
                accent="text-foreground"
                suffix=""
              />
            </div>
            {lowBnb && (
              <div className="text-[11px] text-amber-400 flex items-start gap-1.5 pt-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Low BNB — burn tx needs ~0.00001 BNB gas. Top up this address
                  on BSC to enable the burn button.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Burn form ──────────────────────────────────────────────── */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Flame className="h-4 w-4 text-primary" />
          Burn wZBX → unlock ZBX on Zebvix
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Zebvix recipient (0x… 40 hex)
            </div>
            <Input
              type="text"
              placeholder="0x…"
              value={destAddr}
              onChange={(e) => setDestAddr(e.target.value)}
              className="font-mono"
              disabled={!account || !cfgReady || busy}
            />
            {account && (
              <button
                type="button"
                onClick={() => setDestAddr(account)}
                className="text-[10px] text-primary hover:underline mt-1"
              >
                use my address
              </button>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Amount (wZBX)
            </div>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="font-mono"
              disabled={!account || !cfgReady || busy}
            />
            {wzbxBalQ.data !== undefined && wzbxBalQ.data !== null && wzbxBalQ.data > 0n && (
              <button
                type="button"
                onClick={() => setAmountStr(fmtUnits18(wzbxBalQ.data!))}
                className="text-[10px] text-primary hover:underline mt-1"
              >
                max
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {needsApprove ? (
            <Button onClick={onApprove} disabled={busy || amountWei === 0n} className="flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              1) Approve {amountStr || "0"} wZBX
            </Button>
          ) : (
            <Button onClick={onBurn} disabled={burnDisabled} className="flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Flame className="h-4 w-4 mr-2" />}
              Burn & redeem on Zebvix
            </Button>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground">
          {mode === "browser"
            ? "Tx is RLP-signed in-page using your active wallet's private key and broadcast to BSC. The relayer detects the burn after 15 BSC confirmations (~45 sec) and credits ZBX on Zebvix L1."
            : "MetaMask will pop up to confirm the burn. The relayer detects it (after 15 BSC confirmations) and submits the unlock attestation on Zebvix."}
        </div>

        {err && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="break-all">{err}</div>
          </div>
        )}

        {lastTx && cfg && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-2 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              <strong>{lastTx.kind === "approve" ? "Approve submitted" : "Burn submitted"}</strong>
            </div>
            <a
              href={explorerTx(lastTx.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono hover:text-primary inline-flex items-center gap-1"
            >
              {lastTx.hash}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      {/* ── Advanced collapsible (signer details) ──────────────────── */}
      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        How signing works
      </button>
      {showAdvanced && (
        <div className="text-[11px] text-muted-foreground rounded-md border border-border/40 bg-muted/10 p-3 space-y-2">
          <p>
            <strong className="text-foreground">In-browser mode</strong> uses
            the same secp256k1 private key your wallet holds for Zebvix L1.
            Because both Zebvix and BSC derive 20-byte addresses the same way
            (<code>keccak256(uncompressed_pubkey[1..])[12..]</code>), one key
            controls one identical address on both chains. The BSC tx is
            RLP-encoded and signed locally; only the signed envelope is sent
            to the public BSC RPC. Your private key never leaves the browser.
          </p>
          <p>
            <strong className="text-foreground">MetaMask mode</strong> hands
            signing off to your browser-extension wallet — useful if you want
            hardware-wallet protection or to bridge with a different account
            than your active in-browser one.
          </p>
        </div>
      )}
    </Card>
  );
}

function BalanceTile({
  label,
  value,
  loading,
  accent,
  suffix,
}: {
  label: string;
  value: bigint | null | undefined;
  loading: boolean;
  accent: string;
  suffix: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-bold tabular-nums ${accent}`}>
        {value !== undefined && value !== null
          ? fmtUnits18(value)
          : loading
            ? "…"
            : "—"}
        {suffix && <span className="ml-1 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function ContractCard({
  label,
  address,
  explorerUrl,
}: {
  label: string;
  address: string;
  explorerUrl: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {address ? (
        <div className="font-mono text-xs break-all flex items-center gap-2">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary inline-flex items-center gap-1"
          >
            {address}
            <ExternalLink className="h-3 w-3" />
          </a>
          <CopyBtn value={address} />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">not deployed yet</div>
      )}
    </div>
  );
}

function RelayerBadge({ q, loading }: { q: RelayerStatus | undefined; loading: boolean }) {
  if (loading) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Loader2 className="h-3 w-3 animate-spin" /> relayer
      </Badge>
    );
  }
  if (!q) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Activity className="h-3 w-3" /> relayer ?
      </Badge>
    );
  }
  if (!q.configured) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-yellow-500/40 text-yellow-500">
        <Activity className="h-3 w-3" /> relayer not configured
      </Badge>
    );
  }
  if (!q.ok) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-destructive/40 text-destructive">
        <AlertTriangle className="h-3 w-3" /> relayer down
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] border-primary/40 text-primary">
      <CheckCircle2 className="h-3 w-3" /> relayer up · {q.signers?.count ?? 0} signers
    </Badge>
  );
}
