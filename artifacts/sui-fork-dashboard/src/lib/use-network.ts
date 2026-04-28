// ─────────────────────────────────────────────────────────────────────────────
// Network selection — mainnet vs testnet.
//
// The dashboard talks to TWO independent RPC endpoints:
//   • mainnet  → /api/rpc        → http://93.127.213.192:8545   (chain_id 7878)
//   • testnet  → /api/rpc-testnet → http://93.127.213.192:18545 (chain_id 78787)
//
// The user's choice is persisted in localStorage so it survives reloads.  When
// `setNetwork()` is called we hard-reload the page — this is the cleanest way
// to invalidate every react-query cache + the home.tsx setInterval polling
// loop without having to surgically thread `network` into every query key.
// (Etherscan, Polygonscan, Suiscan all do the same.)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

export type ZbxNetwork = "mainnet" | "testnet";

const NETWORK_KEY = "zbx-network";
const NETWORK_EVENT = "zbx-network-change";

export function getNetwork(): ZbxNetwork {
  if (typeof window === "undefined") return "mainnet";
  try {
    const v = window.localStorage.getItem(NETWORK_KEY);
    return v === "testnet" ? "testnet" : "mainnet";
  } catch {
    return "mainnet";
  }
}

export function setNetwork(n: ZbxNetwork, opts: { reload?: boolean } = {}): void {
  const reload = opts.reload ?? true;
  if (typeof window === "undefined") return;
  const prev = getNetwork();
  if (prev === n) return;
  try {
    window.localStorage.setItem(NETWORK_KEY, n);
  } catch {
    // localStorage unavailable (private mode etc.) — best effort only.
  }
  window.dispatchEvent(new CustomEvent(NETWORK_EVENT, { detail: n }));
  if (reload) {
    // Hard navigation so every query cache + interval timer starts fresh
    // against the newly-selected RPC endpoint.  We use href assignment (not
    // .reload()) because some headless browsers / test runners don't always
    // observe .reload() as a real navigation event — assigning to href
    // triggers a true navigation that Playwright + DevTools always pick up.
    const url = new URL(window.location.href);
    // Tag the URL with a no-op query param so the navigation is unambiguously
    // "different" even if the browser is being aggressive about caching.
    url.searchParams.set("net", n);
    window.location.href = url.toString();
  }
}

export function useNetwork(): ZbxNetwork {
  const [n, setN] = useState<ZbxNetwork>(() => getNetwork());
  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent<ZbxNetwork>).detail;
      if (detail === "testnet" || detail === "mainnet") setN(detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === NETWORK_KEY) setN(getNetwork());
    }
    window.addEventListener(NETWORK_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(NETWORK_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network metadata — single source of truth for chain id, RPC URL display,
// MetaMask add-network params, etc.  Used by the testnet page, the network
// switcher tooltip, and any place that needs to render a network-specific
// connect snippet.
// ─────────────────────────────────────────────────────────────────────────────
export interface NetworkMeta {
  id: ZbxNetwork;
  label: string;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  explorerUrl: string;
  symbol: string;
  decimals: number;
  isTestnet: boolean;
  hint: string;
  serviceName: string;
}

export const MAINNET_META: NetworkMeta = {
  id: "mainnet",
  label: "Mainnet",
  chainId: 7878,
  chainIdHex: "0x1ec6",
  rpcUrl: "http://93.127.213.192:8545",
  explorerUrl: "/",
  symbol: "ZBX",
  decimals: 18,
  isTestnet: false,
  hint: "Production Zebvix L1 — real economic value, ~5s blocks",
  serviceName: "zebvix.service",
};

export const TESTNET_META: NetworkMeta = {
  id: "testnet",
  label: "Testnet",
  chainId: 78787,
  chainIdHex: "0x133c3",
  rpcUrl: "http://93.127.213.192:18545",
  explorerUrl: "/",
  symbol: "tZBX",
  decimals: 18,
  isTestnet: true,
  hint: "Developer playground — tokens have NO economic value, may be reset at any time",
  serviceName: "zebvix-testnet.service",
};

export function networkMeta(n: ZbxNetwork): NetworkMeta {
  return n === "testnet" ? TESTNET_META : MAINNET_META;
}
