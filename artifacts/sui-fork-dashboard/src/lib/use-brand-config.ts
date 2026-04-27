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

export type FeatureFlags = {
  featuresDexEnabled: boolean;
  featuresBridgeEnabled: boolean;
  featuresStakingEnabled: boolean;
  featuresFaucetEnabled: boolean;
  featuresGovernanceEnabled: boolean;
  featuresWalletEnabled: boolean;
  featuresMultisigEnabled: boolean;
  featuresPayidEnabled: boolean;
  featuresTokenCreateEnabled: boolean;
  featuresChainBuilderEnabled: boolean;
};

export type DexConfig = {
  dexFeeBps: number;
  dexDefaultSlippageBps: number;
  dexMinLiquidityWarn: number;
  dexBaseToken: string;
  dexAllowedTokens: string;
  dexBlockedTokens: string;
  dexQuoteRefreshSec: number;
};

export type FaucetConfig = {
  faucetAmount: number;
  faucetCooldownSec: number;
  faucetMessage: string;
};

export type SystemConfig = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  announcementEnabled: boolean;
  announcementText: string;
  announcementLevel: "info" | "success" | "warn" | "critical";
  announcementUrl: string;
  launchEnabled: boolean;
  launchHeadline: string;
  launchSubline: string;
  launchDateIso: string;
};

export type AdminPublicConfig = BrandConfig &
  FeatureFlags &
  DexConfig &
  FaucetConfig &
  SystemConfig;

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

const DEFAULT_FEATURES: FeatureFlags = {
  featuresDexEnabled: true,
  featuresBridgeEnabled: true,
  featuresStakingEnabled: true,
  featuresFaucetEnabled: true,
  featuresGovernanceEnabled: true,
  featuresWalletEnabled: true,
  featuresMultisigEnabled: true,
  featuresPayidEnabled: true,
  featuresTokenCreateEnabled: true,
  featuresChainBuilderEnabled: true,
};

const DEFAULT_DEX: DexConfig = {
  dexFeeBps: 30,
  dexDefaultSlippageBps: 50,
  dexMinLiquidityWarn: 1000,
  dexBaseToken: "ZBX",
  dexAllowedTokens: "",
  dexBlockedTokens: "",
  dexQuoteRefreshSec: 6,
};

const DEFAULT_FAUCET: FaucetConfig = {
  faucetAmount: 1,
  faucetCooldownSec: 86_400,
  faucetMessage: "",
};

const DEFAULT_SYSTEM: SystemConfig = {
  maintenanceMode: false,
  maintenanceMessage: "We'll be back shortly.",
  announcementEnabled: false,
  announcementText: "",
  announcementLevel: "info",
  announcementUrl: "",
  launchEnabled: true,
  launchHeadline: "Zebvix Mainnet & Exchange — Coming Soon",
  launchSubline:
    "Full-service L1 blockchain and a Binance-grade crypto exchange. Web first — mobile wallet & exchange apps right after.",
  launchDateIso: "2026-07-28T12:00:00.000Z",
};

export const DEFAULT_PUBLIC_CONFIG: AdminPublicConfig = {
  ...DEFAULT_BRAND,
  ...DEFAULT_FEATURES,
  ...DEFAULT_DEX,
  ...DEFAULT_FAUCET,
  ...DEFAULT_SYSTEM,
};

const ALLOWED_LEVELS: SystemConfig["announcementLevel"][] = [
  "info",
  "success",
  "warn",
  "critical",
];

function coerce(values: Record<string, unknown>): AdminPublicConfig {
  const out: AdminPublicConfig = { ...DEFAULT_PUBLIC_CONFIG };
  for (const k of Object.keys(out) as (keyof AdminPublicConfig)[]) {
    const v = values[k];
    if (v === undefined || v === null) continue;
    const cur = out[k];
    if (typeof cur === "boolean") {
      if (typeof v === "boolean") (out[k] as boolean) = v;
      else if (typeof v === "string")
        (out[k] as boolean) = v === "true" || v === "1";
      continue;
    }
    if (typeof cur === "number") {
      if (v === "") continue;
      const n = Number(v);
      if (Number.isFinite(n)) (out[k] as number) = n;
      continue;
    }
    if (k === "announcementLevel") {
      if (typeof v === "string" && (ALLOWED_LEVELS as string[]).includes(v)) {
        out.announcementLevel = v as SystemConfig["announcementLevel"];
      }
      continue;
    }
    if (typeof v === "string") (out[k] as string) = v;
  }
  return out;
}

export function usePublicConfig(): AdminPublicConfig {
  const { data } = useQuery({
    queryKey: ["public-settings"],
    queryFn: () => adminApi.publicSettings(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  if (!data?.values) return DEFAULT_PUBLIC_CONFIG;
  return coerce(data.values as Record<string, unknown>);
}

export function useBrandConfig(): BrandConfig {
  return usePublicConfig();
}

export function useFeatureFlags(): FeatureFlags {
  return usePublicConfig();
}

export function useDexConfig(): DexConfig {
  return usePublicConfig();
}

export function useFaucetConfig(): FaucetConfig {
  return usePublicConfig();
}

export function useSystemConfig(): SystemConfig {
  return usePublicConfig();
}

export function usePublicAdminConfig(): AdminPublicConfig {
  return usePublicConfig();
}
