import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link as WLink } from "wouter";
import {
  ArrowLeftRight,
  ArrowRightCircle,
  ShieldCheck,
  Lock,
  Activity,
  Loader2,
  ExternalLink,
  RefreshCw,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Wallet as WalletIcon,
  UserPlus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  getBridgeStats,
  listBridgeAssets,
  listBridgeNetworks,
  recentBridgeOutEvents,
  sendBridgeOut,
  type BridgeAsset,
  type BridgeNetwork,
} from "@/lib/bridge";
import {
  getActiveAddress,
  getWallet,
  loadWallets,
  type StoredWallet,
} from "@/lib/web-wallet";
import { rpc, weiHexToZbx } from "@/lib/zbx-rpc";
import BscSidePanel from "@/components/bridge/BscSidePanel";

/** Format a base-units bigint into a human decimal string for `decimals` places. */
function fmtUnits(
  raw: string | bigint,
  decimals: number,
  maxDecimals = 6,
): string {
  try {
    const w = typeof raw === "bigint" ? raw : BigInt(raw);
    const scale = 10n ** BigInt(decimals);
    const whole = w / scale;
    const frac = w % scale;
    const cap = Math.min(maxDecimals, decimals);
    const fracStr = (frac + scale).toString().slice(1).slice(0, cap);
    const trimmed = fracStr.replace(/0+$/, "");
    return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString();
  } catch {
    return "0";
  }
}

/** Convenience: format ZBX-native (18 dec) base units. */
function fmtZbx(raw: string | bigint, maxDecimals = 6): string {
  return fmtUnits(raw, 18, maxDecimals);
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

// ────────────────────────────────────────────────────────────────────────────
// Lock vault stats panel — top of page, auto-refreshing.
// ────────────────────────────────────────────────────────────────────────────

function LockVaultPanel() {
  const stats = useQuery({
    queryKey: ["bridgeStats"],
    queryFn: getBridgeStats,
    refetchInterval: 8_000,
  });
  const isLoading = stats.isLoading;
  const data = stats.data;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Bridge lock vault</h2>
          <Badge variant="outline" className="ml-2 text-xs">live</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => stats.refetch()}
          disabled={stats.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${stats.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Escrow address (on-chain)
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-xs break-all">
            {data?.lock_address ? (
              <>
                <WLink href={`/block-explorer?q=${data.lock_address}`} className="hover:text-primary">
                  {data.lock_address}
                </WLink>
                <CopyBtn value={data.lock_address} />
              </>
            ) : (
              <span className="text-muted-foreground">{isLoading ? "loading…" : "—"}</span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            ASCII "zbrdg" + zero-pad. Anyone can verify the balance via{" "}
            <code className="bg-muted px-1 rounded">eth_getBalance</code>.
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Total ZBX locked
          </div>
          <div className="mt-1 text-2xl font-bold text-primary">
            {data ? fmtZbx(data.locked_zbx_wei, 6) : isLoading ? "…" : "—"}
            <span className="ml-1 text-sm font-medium text-muted-foreground">ZBX</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Sum of every successful BridgeOut. Released only via an
            admin-signed BridgeIn (today: trusted attestation; the source-tx
            hash is replay-protected on-chain but not cryptographically
            verified against the foreign chain).
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
        <Stat label="Networks" value={data?.networks_count ?? 0} sub={`${data?.active_networks ?? 0} active`} />
        <Stat label="Assets" value={data?.assets_count ?? 0} sub={`${data?.active_assets ?? 0} active`} />
        <Stat label="BridgeOut events" value={data?.out_events_total ?? 0} sub="ring cap 4096" />
        <Stat label="Claims used" value={data?.claims_used ?? 0} sub="replay-proof" />
      </div>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BridgeOut form — user signs locally with their own private key and
// broadcasts a TxKind::Bridge(BridgeOut{..}) tx. No admin involvement.
// ────────────────────────────────────────────────────────────────────────────

function BridgeOutForm() {
  const { toast } = useToast();

  const assetsQ = useQuery({
    queryKey: ["bridgeAssets"],
    queryFn: listBridgeAssets,
    refetchInterval: 30_000,
  });
  const networksQ = useQuery({
    queryKey: ["bridgeNetworks"],
    queryFn: listBridgeNetworks,
    refetchInterval: 30_000,
  });

  const networksById = useMemo(() => {
    const m = new Map<number, BridgeNetwork>();
    for (const n of networksQ.data ?? []) m.set(n.id, n);
    return m;
  }, [networksQ.data]);

  const assets = (assetsQ.data ?? []).filter((a) => a.active);

  const [assetId, setAssetId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    hash: string; from: string; amount: string; symbol: string;
    dest: string; assetId: string;
  } | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Active wallet (from localStorage). Re-reads on mount, on `storage` events
  // (so e.g. importing a wallet in another tab reflects here) and on focus.
  const [activeWallet, setActiveWallet] = useState<StoredWallet | null>(null);
  const [walletCount, setWalletCount] = useState(0);

  const reloadWallet = useCallback(() => {
    const addr = getActiveAddress();
    setActiveWallet(addr ? getWallet(addr) : null);
    setWalletCount(loadWallets().length);
  }, []);

  useEffect(() => {
    reloadWallet();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.includes("zbx") || e.key.includes("wallet")) {
        reloadWallet();
      }
    };
    const onFocus = () => reloadWallet();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [reloadWallet]);

  // Live ZBX balance for the active wallet — refreshed every 8s.
  // (BridgeOut fee is paid in ZBX regardless of the locked asset, so we
  // always show the ZBX balance; per-asset zUSD balance shown when relevant.)
  const balanceQ = useQuery({
    queryKey: ["zbxBalance", activeWallet?.address ?? ""],
    queryFn: async () => {
      if (!activeWallet) return null;
      const hex = await rpc<string>("zbx_getBalance", [activeWallet.address]);
      return weiHexToZbx(hex);
    },
    enabled: !!activeWallet,
    refetchInterval: 8_000,
  });

  // Default to first active asset once they load.
  useEffect(() => {
    if (!assetId && assets.length > 0) {
      setAssetId(assets[0].asset_id);
    }
  }, [assets, assetId]);

  const selectedAsset: BridgeAsset | undefined = useMemo(
    () => assets.find((a) => a.asset_id === assetId),
    [assets, assetId],
  );
  const selectedNetwork = selectedAsset
    ? networksById.get(selectedAsset.network_id)
    : undefined;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg(null);
    setResult(null);
    if (!selectedAsset) {
      setErrMsg("Pick an asset first.");
      return;
    }
    if (!activeWallet) {
      setErrMsg(
        "No active wallet. Create or import one on /wallet, or set an active wallet from the address book.",
      );
      return;
    }
    // Cheap consistency check: ensure the active wallet in storage hasn't
    // changed under us between render and click (e.g. user switched active
    // wallet in another tab). If so, force a reload so the user re-confirms.
    const liveActive = getActiveAddress();
    if (!liveActive || liveActive.toLowerCase() !== activeWallet.address.toLowerCase()) {
      reloadWallet();
      setErrMsg(
        "Active wallet changed in another tab. Sender refreshed — please review the address above and submit again.",
      );
      return;
    }
    setBusy(true);
    try {
      const r = await sendBridgeOut({
        privateKeyHex: activeWallet.privateKey,
        assetId: selectedAsset.asset_id,
        amount: amount.trim(),
        // Each bridge asset has its own native_decimals on chain (ZBX=18, zUSD=6).
        // We MUST pass the asset's own decimals so the lock amount is scaled
        // correctly into the asset's smallest unit.
        assetDecimals: selectedAsset.native_decimals,
        destAddress: destAddress.trim(),
      });
      setResult({
        hash: r.hash,
        from: r.from,
        amount: fmtUnits(r.amountWei, r.assetDecimals, 6),
        symbol: selectedAsset.native,
        dest: r.destAddress,
        assetId: r.assetId.toString(),
      });
      toast({ title: "Bridge-out submitted", description: shortAddr(r.hash, 10, 8) });
      setAmount("");
      setDestAddress("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrMsg(msg);
      toast({ title: "Bridge-out failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const networksLoading = networksQ.isLoading;
  const assetsLoading = assetsQ.isLoading;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ArrowRightCircle className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Bridge out · lock & send</h2>
        <Badge variant="outline" className="ml-2 text-xs">
          you sign locally
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        Your wallet's private key never leaves the browser — the tx is signed
        in-page (secp256k1) using the active wallet stored in this browser
        and the raw bincode envelope is broadcast via{" "}
        <code className="text-xs bg-muted px-1 rounded">zbx_sendRawTransaction</code>.
        The chain debits your balance in the asset's native units (ZBX has 18
        decimals; zUSD has 6) and credits the public escrow vault atomically.
      </p>

      <ActiveWalletPanel
        wallet={activeWallet}
        walletCount={walletCount}
        balanceZbx={balanceQ.data ?? null}
        balanceLoading={balanceQ.isLoading || balanceQ.isFetching}
        onRefresh={() => { reloadWallet(); balanceQ.refetch(); }}
      />

      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Asset (foreign network)">
          <select
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            disabled={assetsLoading || networksLoading || assets.length === 0}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          >
            {assetsLoading || networksLoading ? (
              <option value="">loading…</option>
            ) : assets.length === 0 ? (
              <option value="">no active assets registered</option>
            ) : (
              assets.map((a) => {
                const net = networksById.get(a.network_id);
                return (
                  <option key={a.asset_id} value={a.asset_id}>
                    {a.native} → {net?.name ?? `network ${a.network_id}`}
                    {" "}(asset id {a.asset_id})
                  </option>
                );
              })
            )}
          </select>
          {selectedAsset && selectedNetwork && (
            <div className="text-[11px] text-muted-foreground mt-1">
              Network <strong>{selectedNetwork.name}</strong> ({selectedNetwork.kind},
              chain id {selectedNetwork.id}) ·{" "}
              {selectedAsset.contract && selectedAsset.contract !== "0x0000000000000000000000000000000000000000"
                ? <>foreign contract <code className="bg-muted px-1 rounded">{shortAddr(selectedAsset.contract, 8, 6)}</code></>
                : <span>native asset (no foreign contract)</span>}{" "}
              · decimals {selectedAsset.decimals}
            </div>
          )}
        </Field>

        <Field
          label={
            selectedAsset
              ? `Amount (${selectedAsset.native}, ${selectedAsset.native_decimals} decimals)`
              : "Amount"
          }
        >
          <Input
            type="text"
            inputMode="decimal"
            placeholder={selectedAsset?.native === "Zusd" ? "e.g. 100.5" : "e.g. 5.0"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-mono"
            required
          />
          {selectedAsset && (
            <div className="text-[11px] text-muted-foreground mt-1">
              Locked from your <code className="bg-muted px-1 rounded">{selectedAsset.native}</code>{" "}
              balance into the public escrow vault. Tx fee is paid separately
              in ZBX (18 dec) using the chain-recommended floor.
            </div>
          )}
        </Field>

        <Field label="Destination address (on foreign chain)">
          <Input
            type="text"
            placeholder={selectedNetwork?.kind?.toLowerCase() === "evm"
              ? "0x… (40 hex chars on EVM chain)"
              : "destination on selected network"}
            value={destAddress}
            onChange={(e) => setDestAddress(e.target.value)}
            className="font-mono"
            required
          />
          <div className="text-[11px] text-muted-foreground mt-1">
            Validated server-side per network kind. EVM = 40 hex chars (with or
            without <code className="bg-muted px-1 rounded">0x</code> prefix); ≤ 128 chars total.
          </div>
        </Field>

        <Button
          type="submit"
          disabled={busy || !assetId || !activeWallet}
          className="w-full"
        >
          {busy ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Signing &amp; broadcasting…</>
          ) : !activeWallet ? (
            <><Lock className="h-4 w-4 mr-2" />Set an active wallet to lock</>
          ) : (
            <><Lock className="h-4 w-4 mr-2" />Sign with active wallet &amp; lock</>
          )}
        </Button>
      </form>

      {errMsg && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div className="break-all"><strong>Error:</strong> {errMsg}</div>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <strong>Bridge-out submitted</strong>
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            <div className="text-muted-foreground">Tx hash</div>
            <div className="break-all flex items-center gap-2">
              <WLink
                href={`/block-explorer?q=${result.hash}`}
                className="hover:text-primary inline-flex items-center gap-1"
              >
                {result.hash}
                <ExternalLink className="h-3 w-3" />
              </WLink>
              <CopyBtn value={result.hash} />
            </div>
            <div className="text-muted-foreground">From</div>
            <div className="break-all">{result.from}</div>
            <div className="text-muted-foreground">Amount locked</div>
            <div className="font-bold text-primary">
              {result.amount} {result.symbol}
            </div>
            <div className="text-muted-foreground">Asset id</div>
            <div>{result.assetId}</div>
            <div className="text-muted-foreground">Destination</div>
            <div className="break-all">{result.dest}</div>
          </div>
          <div className="text-[11px] text-muted-foreground pt-1">
            Off-chain oracle will pick up the BridgeOutEvent and mint the
            wrapped asset on the foreign chain to your destination address.
          </div>
        </div>
      )}
    </Card>
  );
}

function ActiveWalletPanel({
  wallet,
  walletCount,
  balanceZbx,
  balanceLoading,
  onRefresh,
}: {
  wallet: StoredWallet | null;
  walletCount: number;
  balanceZbx: string | null;
  balanceLoading: boolean;
  onRefresh: () => void;
}) {
  if (!wallet) {
    return (
      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm space-y-2">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          No active wallet in this browser
        </div>
        <div className="text-muted-foreground text-xs">
          {walletCount > 0
            ? "You have stored wallets but none is set as active. Open the wallet page and tap Set Active on the one you want to use as the bridge sender."
            : "Bridge-out signs locally with your wallet's private key. Create or import a wallet first — it's stored only in this browser's localStorage."}
        </div>
        <div className="flex gap-2">
          <WLink
            href="/wallet"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <WalletIcon className="h-3.5 w-3.5" />
            {walletCount > 0 ? "Open wallet" : "Create wallet"}
          </WLink>
          <WLink
            href="/import-wallet"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/60"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Import key
          </WLink>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <WalletIcon className="h-4 w-4 text-primary" />
          Sender — active wallet
          <Badge variant="outline" className="ml-1 text-[10px]">
            {wallet.label || "wallet"}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={balanceLoading}
          title="Refresh balance"
          className="h-7 px-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${balanceLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
        <div className="font-mono text-xs break-all flex items-center gap-2">
          <WLink href={`/block-explorer?q=${wallet.address}`} className="hover:text-primary">
            {wallet.address}
          </WLink>
          <CopyBtn value={wallet.address} />
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            ZBX balance
          </div>
          <div className="font-bold tabular-nums text-primary">
            {balanceZbx ?? (balanceLoading ? "…" : "—")}
            <span className="ml-1 text-xs text-muted-foreground">ZBX</span>
          </div>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground flex items-center justify-between gap-2 pt-1">
        <span>
          The private key for this address never leaves your browser. Signing
          happens in-page; only the signed envelope is broadcast.
        </span>
        <WLink
          href="/wallet"
          className="shrink-0 inline-flex items-center gap-1 hover:text-primary"
        >
          Change wallet <ArrowRightCircle className="h-3 w-3" />
        </WLink>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Recent BridgeOut events feed — public, auto-refresh.
// ────────────────────────────────────────────────────────────────────────────

function RecentEventsFeed() {
  const evs = useQuery({
    queryKey: ["bridgeOutEvents", 25],
    queryFn: () => recentBridgeOutEvents(25),
    refetchInterval: 6_000,
  });
  const events = evs.data?.events ?? [];

  return (
    <Card className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Recent bridge-out events</h2>
          <Badge variant="outline" className="ml-1 text-xs">
            {evs.data?.total ?? 0} total
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => evs.refetch()}
          disabled={evs.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${evs.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {evs.isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
        </div>
      ) : events.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No bridge-out events yet. Submit one above and it'll show here in
          the next refresh tick (~6s).
        </div>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-auto">
          {events.slice().reverse().map((e) => (
            <div
              key={`${e.seq}-${e.tx_hash}`}
              className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  seq #{e.seq}
                </Badge>
                <span className="text-muted-foreground">block #{e.height}</span>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 font-mono">
                <div className="text-muted-foreground">From</div>
                <div className="break-all">
                  <WLink href={`/block-explorer?q=${e.from}`} className="hover:text-primary">
                    {e.from}
                  </WLink>
                </div>
                <div className="text-muted-foreground">To (foreign)</div>
                <div className="break-all text-foreground">{e.dest_address}</div>
                <div className="text-muted-foreground">Amount</div>
                <div className="font-bold text-primary">
                  {fmtZbx(e.amount, 6)} {e.native_symbol}
                </div>
                <div className="text-muted-foreground">Tx</div>
                <div className="break-all">
                  <WLink href={`/block-explorer?q=${e.tx_hash}`} className="hover:text-primary">
                    {shortAddr(e.tx_hash, 14, 10)}
                  </WLink>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Decentralization properties — explainer card at bottom.
// ────────────────────────────────────────────────────────────────────────────

function DecentralizationCard() {
  const items = [
    {
      label: "User self-custodies the lock",
      text: "BridgeOut tx is signed locally with the user's own secp256k1 key. No relayer / admin can spend on the user's behalf. The chain only accepts a tx whose signature recovers to the sender address.",
    },
    {
      label: "Escrow is a public, deterministic address",
      text: "The lock vault is the same on-chain address for every user (0x7a62726467… = ASCII \"zbrdg\"). Anyone can read its balance with eth_getBalance and verify it equals the chain-reported locked_zbx counter at all times.",
    },
    {
      label: "All locks are publicly auditable",
      text: "Every successful BridgeOut emits a BridgeOutEvent into a 4096-cap on-chain ring buffer that anyone can read via zbx_recentBridgeOutEvents. There is no private mempool for bridge txs.",
    },
    {
      label: "Replay protection is on-chain",
      text: "Each BridgeIn carries a (network, source_tx_hash) tuple; the chain marks it consumed atomically and rejects any second submission with the same hash. The admin cannot accidentally double-release the same claim — even if they retry.",
    },
    {
      label: "Per-asset / per-network kill switches",
      text: "Admin can pause a specific asset or whole network if a foreign-side issue is detected. New BridgeOuts are rejected with a fee-only refund; existing locks are unaffected.",
    },
    {
      label: "Trust caveat (today) — BridgeIn is admin attestation",
      text: "BridgeIn is signed by a single admin key. The chain enforces (a) the admin's signature, (b) replay protection on the source_tx_hash, and (c) that the destination asset is registered. It does NOT cryptographically verify the foreign-chain deposit (no light client / merkle proof yet). A compromised admin key could submit fake source hashes and drain the lock vault. Multisig oracle (M-of-N validator quorum) is on the roadmap and the primitives already exist in TxKind::Multisig.",
      warn: true,
    },
  ];

  return (
    <Card className="p-6 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Decentralization properties</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((it) => (
          <div
            key={it.label}
            className={`rounded-md border p-3 text-sm space-y-1 ${
              it.warn
                ? "border-yellow-500/40 bg-yellow-500/5"
                : "border-border/50 bg-muted/20"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {it.warn ? (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
              {it.label}
            </div>
            <div className="text-muted-foreground">{it.text}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page root
// ────────────────────────────────────────────────────────────────────────────

export default function BridgeLive() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <ArrowLeftRight className="h-4 w-4" />
          Cross-Chain Bridge · Live
        </div>
        <h1 className="text-3xl font-bold mt-1">Bridge — lock &amp; send</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          User-side bridge actions for Zebvix mainnet. Lock ZBX into the
          public on-chain escrow vault; an off-chain oracle mints the wrapped
          asset on the destination network. Outbound is fully decentralized —
          inbound (BridgeIn) is admin-gated until the multisig-oracle upgrade
          ships. See{" "}
          <WLink href="/bridge" className="text-primary hover:underline">/bridge</WLink>{" "}
          for full architecture docs.
        </p>
      </div>

      <LockVaultPanel />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BridgeOutForm />
        <RecentEventsFeed />
      </div>

      <BscSidePanel />

      <DecentralizationCard />
    </div>
  );
}
