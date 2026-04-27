import React from "react";
import { useQuery } from "@tanstack/react-query";
import { WalletPicker } from "@/components/ui/wallet-picker";
import { Smartphone } from "lucide-react";
import { useBrandConfig, useFeatureFlags } from "@/lib/use-brand-config";

type ChainStatus = {
  height?: number | string;
  peers?: number;
  chainId?: number | string;
  network?: string;
  ok?: boolean;
};

async function fetchStatus(): Promise<ChainStatus | null> {
  try {
    const r = await fetch("/api/chain/status", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ChainStatus;
  } catch {
    return null;
  }
}

export function Topbar() {
  const brand = useBrandConfig();
  const flags = useFeatureFlags();
  const { data } = useQuery({
    queryKey: ["topbar-chain-status"],
    queryFn: fetchStatus,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const live = !!data && data.ok !== false;
  const height =
    typeof data?.height === "number" || typeof data?.height === "string"
      ? String(data.height)
      : null;
  const peers = typeof data?.peers === "number" ? data.peers : null;

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
        <div className="hidden sm:flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          <span data-testid="topbar-chain-name">{brand.chainName}</span>
          <span className="font-mono text-primary/70">·</span>
          <span className="font-mono text-primary/70" data-testid="topbar-chain-id">
            chain {brand.chainId}
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
