// ─────────────────────────────────────────────────────────────────────────────
// Network selector — pill-shaped Mainnet | Testnet toggle that lives in the
// topbar.  Switching networks hard-reloads the page so every cache + polling
// loop in the app starts fresh against the newly-selected RPC endpoint.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { Globe2, FlaskConical } from "lucide-react";
import {
  useNetwork,
  setNetwork,
  type ZbxNetwork,
  MAINNET_META,
  TESTNET_META,
} from "@/lib/use-network";

export function NetworkSwitcher() {
  const net = useNetwork();
  function pick(n: ZbxNetwork) {
    if (n === net) return;
    setNetwork(n);
  }
  return (
    <div
      className="inline-flex items-center rounded-full border border-border/60 bg-card/60 p-0.5 text-[11px] font-semibold uppercase tracking-widest"
      role="group"
      aria-label="Select Zebvix network"
      data-testid="network-switcher"
    >
      <button
        type="button"
        onClick={() => pick("mainnet")}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
          net === "mainnet"
            ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
            : "text-muted-foreground hover:text-foreground"
        }`}
        title={MAINNET_META.hint}
        aria-pressed={net === "mainnet"}
        data-testid="network-switcher-mainnet"
      >
        <Globe2 className="h-3 w-3" />
        Mainnet
      </button>
      <button
        type="button"
        onClick={() => pick("testnet")}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
          net === "testnet"
            ? "bg-red-500/20 text-red-200 ring-1 ring-red-500/40"
            : "text-muted-foreground hover:text-foreground"
        }`}
        title={TESTNET_META.hint}
        aria-pressed={net === "testnet"}
        data-testid="network-switcher-testnet"
      >
        <FlaskConical className="h-3 w-3" />
        Testnet
      </button>
    </div>
  );
}
