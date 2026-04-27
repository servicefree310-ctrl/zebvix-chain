import { useQuery } from "@tanstack/react-query";
import { adminApi } from "./admin-client";

// Public, never-secret subset of admin settings. Used everywhere the dashboard
// renders chain id / brand / domain / social links so the admin panel actually
// drives what the user sees. Falls back to the original hardcoded values if
// the API is unreachable so the dashboard keeps rendering offline.
export type BrandConfig = {
  chainId: number;
  chainName: string;
  chainSymbol: string;
  chainHardfork: string;
  blockTime: number;
  explorerName: string;
  explorerUrl: string;
  brandName: string;
  brandTagline: string;
  brandDomain: string;
  supportEmail: string;
  primaryColor: string;
  accentColor: string;
  twitterUrl: string;
  githubUrl: string;
  discordUrl: string;
  docsUrl: string;
};

export const DEFAULT_BRAND: BrandConfig = {
  chainId: 7878,
  chainName: "Zebvix L1",
  chainSymbol: "ZBX",
  chainHardfork: "Cancun",
  blockTime: 2,
  explorerName: "Zebvix Explorer",
  explorerUrl: "",
  brandName: "Zebvix",
  brandTagline:
    "Zebvix L1 — high-throughput, EVM-compatible Layer-1 with built-in DEX, bridge, and pay-id native primitives.",
  brandDomain: "",
  supportEmail: "",
  primaryColor: "#10b981",
  accentColor: "#22d3ee",
  twitterUrl: "",
  githubUrl: "",
  discordUrl: "",
  docsUrl: "",
};

function coerce(values: Record<string, unknown>): BrandConfig {
  const out: BrandConfig = { ...DEFAULT_BRAND };
  for (const k of Object.keys(out) as (keyof BrandConfig)[]) {
    const v = values[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof out[k] === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) (out[k] as number) = n;
    } else if (typeof v === "string") {
      (out[k] as string) = v;
    }
  }
  return out;
}

export function useBrandConfig(): BrandConfig {
  const { data } = useQuery({
    queryKey: ["public-settings"],
    queryFn: () => adminApi.publicSettings(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  if (!data?.values) return DEFAULT_BRAND;
  return coerce(data.values as Record<string, unknown>);
}
