// ─────────────────────────────────────────────────────────────────────────────
// Loud red banner shown at the very top of the app when the user has selected
// the testnet.  Hides itself entirely on mainnet so the production experience
// is visually identical to before the testnet support landed.
// ─────────────────────────────────────────────────────────────────────────────
import { FlaskConical, X } from "lucide-react";
import { useState } from "react";
import { useNetwork, setNetwork, TESTNET_META } from "@/lib/use-network";

export function TestnetBanner() {
  const net = useNetwork();
  const [collapsed, setCollapsed] = useState(false);
  if (net !== "testnet") return null;
  if (collapsed) {
    // Compact strip — keeps the testnet warning visible but uses one row.
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="w-full bg-red-600/95 text-red-50 text-[11px] font-semibold uppercase tracking-widest py-1 hover:bg-red-600"
        data-testid="testnet-banner-collapsed"
      >
        🧪 Testnet — chain {TESTNET_META.chainId} · click to expand
      </button>
    );
  }
  return (
    <div
      className="w-full bg-gradient-to-r from-red-700 via-red-600 to-red-700 text-red-50 border-b border-red-400/40"
      role="alert"
      data-testid="testnet-banner"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8 py-2.5 flex items-center gap-3">
        <FlaskConical className="h-4 w-4 shrink-0 text-red-100 animate-pulse" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-100/90">
            Testnet build · chain id {TESTNET_META.chainId} ({TESTNET_META.chainIdHex})
          </div>
          <div className="text-xs sm:text-sm leading-snug">
            You are connected to <span className="font-mono font-semibold">{TESTNET_META.rpcUrl}</span>.
            Tokens have <span className="font-bold">zero economic value</span> and the chain may be reset
            at any time. Use this for development &amp; integration testing only.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setNetwork("mainnet")}
          className="hidden sm:inline-flex items-center rounded-md bg-red-900/40 hover:bg-red-900/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest border border-red-300/30"
          data-testid="testnet-banner-switch-mainnet"
        >
          Switch to mainnet
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse testnet banner"
          className="rounded p-1 hover:bg-red-900/40 transition"
          data-testid="testnet-banner-collapse"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
