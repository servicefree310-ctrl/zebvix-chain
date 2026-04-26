import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  approveWzbx,
  bscErc20Allowance,
  bscErc20Balance,
  burnToZebvix,
  connectMetaMask,
  ensureBscNetwork,
  fmtUnits18,
  getMetaMaskAccount,
  parseUnits18,
  watchWzbx,
  type BscBridgeConfig,
  type RelayerStatus,
} from "@/lib/bsc-bridge";

const API_BASE = (() => {
  // Always use the api-server artifact path (mounted at /api).
  // The api-server runs alongside this artifact in the same workspace.
  return "/api";
})();

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

export default function BscSidePanel() {
  const { toast } = useToast();

  // ── Config from api-server ───────────────────────────────────────────
  const cfgQ = useQuery({
    queryKey: ["bridge", "bsc-config"],
    queryFn: () => fetchJson<BscBridgeConfig>(`${API_BASE}/bridge/bsc-config`),
    staleTime: 60_000,
  });

  // ── Relayer status ────────────────────────────────────────────────────
  const relayerQ = useQuery({
    queryKey: ["bridge", "relayer-status"],
    queryFn: () => fetchJson<RelayerStatus>(`${API_BASE}/bridge/relayer-status`),
    refetchInterval: 10_000,
  });

  // ── MetaMask account ──────────────────────────────────────────────────
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMetaMaskAccount().then((a) => {
      if (!cancelled) setAccount(a);
    });
    const eth = window.ethereum;
    if (eth?.on) {
      const handler = (...args: unknown[]) => {
        const accs = args[0] as string[] | undefined;
        setAccount(accs?.[0]?.toLowerCase() ?? null);
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

  const onConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const a = await connectMetaMask();
      setAccount(a);
      if (cfgQ.data) {
        await ensureBscNetwork(cfgQ.data).catch((e) => {
          // user-rejected switch is fine, just warn
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
      toast({ title: "wZBX added to wallet" });
    } catch (e) {
      toast({
        title: "Add token failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }, [cfgQ.data, toast]);

  // ── wZBX balance + allowance ──────────────────────────────────────────
  const balanceQ = useQuery({
    queryKey: ["wzbx", "balance", cfgQ.data?.wzbx_address ?? "", account ?? ""],
    queryFn: async () => {
      if (!cfgQ.data?.wzbx_address || !account) return null;
      return bscErc20Balance(cfgQ.data.bsc_rpc_url, cfgQ.data.wzbx_address, account);
    },
    enabled: !!(cfgQ.data?.wzbx_address && account),
    refetchInterval: 12_000,
  });

  const allowanceQ = useQuery({
    queryKey: [
      "wzbx",
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

  // ── Reverse bridge form (BSC → Zebvix) ───────────────────────────────
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

  const needsApprove =
    amountWei > 0n &&
    allowanceQ.data !== null &&
    allowanceQ.data !== undefined &&
    allowanceQ.data < amountWei;

  async function onApprove() {
    if (!cfgQ.data || !account) return;
    setErr(null);
    setBusy(true);
    try {
      await ensureBscNetwork(cfgQ.data);
      const hash = await approveWzbx(cfgQ.data, account, amountWei);
      setLastTx({ hash, kind: "approve" });
      toast({ title: "Approve submitted", description: shortAddr(hash, 10, 8) });
      // Refresh allowance after a delay (mempool → block).
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
      await ensureBscNetwork(cfgQ.data);
      const hash = await burnToZebvix(cfgQ.data, account, destAddr.trim(), amountWei);
      setLastTx({ hash, kind: "burn" });
      toast({ title: "Burn submitted", description: shortAddr(hash, 10, 8) });
      setAmountStr("");
      setTimeout(() => {
        balanceQ.refetch();
        allowanceQ.refetch();
      }, 6_000);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      toast({ title: "Burn failed", description: m, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const cfg = cfgQ.data;
  const cfgReady = !!(cfg?.wzbx_address && cfg?.bridge_address);
  const explorerTx = (h: string) => `${cfg?.bsc_explorer ?? "https://bscscan.com"}/tx/${h}`;
  const explorerAddr = (a: string) => `${cfg?.bsc_explorer ?? "https://bscscan.com"}/address/${a}`;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">BSC side · wZBX & reverse bridge</h2>
          <Badge variant="outline" className="ml-1 text-xs">
            {cfg?.bsc_chain_name ?? "BSC"}
          </Badge>
        </div>
        <RelayerBadge q={relayerQ.data} loading={relayerQ.isLoading} />
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
              in api-server env. See <code>lib/bsc-contracts/DEPLOY.md</code>.
            </div>
          </div>
        </div>
      )}

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

      {/* Wallet row */}
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <WalletIcon className="h-4 w-4 text-primary" />
            BSC wallet (MetaMask)
          </div>
          {!account ? (
            <Button size="sm" onClick={onConnect} disabled={connecting}>
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Connect
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onAddToken} disabled={!cfgReady}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add wZBX
            </Button>
          )}
        </div>
        {account ? (
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
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  wZBX balance
                </div>
                <div className="font-bold tabular-nums text-primary">
                  {balanceQ.data !== undefined && balanceQ.data !== null
                    ? fmtUnits18(balanceQ.data)
                    : balanceQ.isLoading
                      ? "…"
                      : "—"}
                  <span className="ml-1 text-xs text-muted-foreground">wZBX</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Allowance to bridge
                </div>
                <div className="font-bold tabular-nums">
                  {allowanceQ.data !== undefined && allowanceQ.data !== null
                    ? fmtUnits18(allowanceQ.data)
                    : allowanceQ.isLoading
                      ? "…"
                      : "—"}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            Connect your MetaMask to see your wZBX balance and burn back to Zebvix.
          </div>
        )}
      </div>

      {/* Reverse bridge form */}
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
          </div>
        </div>

        <div className="flex gap-2">
          {needsApprove ? (
            <Button onClick={onApprove} disabled={busy || amountWei === 0n} className="flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              1) Approve {amountStr || "0"} wZBX
            </Button>
          ) : (
            <Button
              onClick={onBurn}
              disabled={
                busy ||
                amountWei === 0n ||
                !account ||
                !cfgReady ||
                !/^0x[0-9a-fA-F]{40}$/.test(destAddr.trim())
              }
              className="flex-1"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Flame className="h-4 w-4 mr-2" />}
              Burn & redeem on Zebvix
            </Button>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground">
          {needsApprove
            ? "Two-step UX: first approve the bridge contract to burn this amount of your wZBX, then click again to burn."
            : "Burns your wZBX on BSC and emits a BurnToZebvix event. The relayer detects it (after 15 BSC confirmations) and submits the unlock attestation on Zebvix."}
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
    </Card>
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
