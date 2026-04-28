import React from "react";
import { useQuery } from "@tanstack/react-query";
import { WalletPicker } from "@/components/ui/wallet-picker";
import { Smartphone } from "lucide-react";
import { useBrandConfig, useFeatureFlags } from "@/lib/use-brand-config";
import { rpc } from "@/lib/zbx-rpc";
import { useNetwork, networkMeta } from "@/lib/use-network";
import { NetworkSwitcher } from "./network-switcher";

// Live chain telemetry for the topbar.  We call the underlying RPC directly
// (eth_blockNumber + eth_chainId + net_peerCount) so the data is automatically
// network-aware — switching networks routes through /api/rpc-testnet without
// any extra wiring up here.  net_peerCount is best-effort: solo nodes return
// "0x0" which we render as 0.
type ChainStatus = {
  height: number | null;
  chainId: number | null;
  peers: number | null;
  ok: boolean;
};

function hexToInt(s: unknown): number | null {
  if (typeof s !== "string") return null;
  try {
    const n = parseInt(s, 16);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fetchStatus(): Promise<ChainStatus> {
  try {
    const [height, chainId, peers] = await Promise.all([
      rpc<string>("eth_blockNumber").catch(() => null),
      rpc<string>("eth_chainId").catch(() => null),
      rpc<string>("net_peerCount").catch(() => null),
    ]);
    return {
      height: hexToInt(height),
      chainId: hexToInt(chainId),
      peers: hexToInt(peers),
      ok: height !== null && chainId !== null,
    };
  } catch {
    return { height: null, chainId: null, peers: null, ok: false };
  }
}

export function Topbar() {
  const brand = useBrandConfig();
  const flags = useFeatureFlags();
  const net = useNetwork();
  const meta = networkMeta(net);
  const { data } = useQuery({
    queryKey: ["topbar-chain-status", net],
    queryFn: fetchStatus,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const live = !!data && data.ok;
  const height = data?.height != null ? String(data.height) : null;
  const peers = data?.peers ?? null;
  // Prefer the live on-chain id (proves we're actually talking to the right
  // node) but fall back to the static brand id if the RPC hasn't replied yet.
  const chainIdLabel = data?.chainId ?? meta.chainId ?? brand.chainId;

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/60 bg-background/85 px-4 py-2.5 backdrop-blur md:px-8">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
            live
              ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
              : "border-amber-500/40 text-amber-300 bg-amber-500/10"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              live ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
            }`}
          />
          {live ? "Live" : "Connecting"}
        </span>
        <NetworkSwitcher />
        <div className="hidden sm:flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          <span data-testid="topbar-chain-name">
            {brand.chainName}
            {meta.isTestnet ? " · Test" : ""}
          </span>
          <span className="font-mono text-primary/70">·</span>
          <span className="font-mono text-primary/70" data-testid="topbar-chain-id">
            chain {chainIdLabel}
          </span>
          {height ? (
            <>
              <span className="font-mono text-primary/70">·</span>
              <span className="font-mono text-emerald-300/80">
                #{height}
              </span>
            </>
          ) : null}
          {peers != null ? (
            <>
              <span className="font-mono text-primary/70">·</span>
              <span className="font-mono text-primary/60">
                peers {peers}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {flags.featuresWalletEnabled !== false && (
          <a
            href="/api/mobile/"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-card transition-colors"
            data-testid="topbar-mobile-link"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>Mobile Wallet</span>
          </a>
        )}
        {flags.featuresWalletEnabled !== false && <WalletPicker />}
      </div>
    </div>
  );
}
