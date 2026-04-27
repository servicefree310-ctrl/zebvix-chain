import { db, adminSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

// ── Setting catalog ─────────────────────────────────────────────────────────
// Centralised so the admin UI, the public-settings endpoint, and the RPC
// override all agree on what exists and what is safe to expose.
export type SettingKind =
  | "string"
  | "number"
  | "url"
  | "color"
  | "boolean"
  | "bps"      // basis points 0..10000
  | "enum"     // choose from `options`
  | "csv";     // comma-separated list, each entry trimmed

export type SettingGroup =
  | "chain"
  | "branding"
  | "links"
  | "features"
  | "dex"
  | "faucet"
  | "system";

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  hint?: string;
  kind: SettingKind;
  defaultValue: string | number | boolean;
  isPublic: boolean;
  isSensitive?: boolean;
  options?: readonly string[]; // only for kind=enum
  min?: number;                 // only for kind=number/bps
  max?: number;                 // only for kind=number/bps
}

export const SETTING_DEFS: SettingDef[] = [
  // Chain
  { key: "chainId", group: "chain", label: "Chain ID", kind: "number", defaultValue: 7878, isPublic: true, hint: "Numeric EVM chain id (e.g. 7878 for Zebvix L1)." },
  { key: "chainName", group: "chain", label: "Chain Name", kind: "string", defaultValue: "Zebvix L1", isPublic: true },
  { key: "chainSymbol", group: "chain", label: "Native Token Symbol", kind: "string", defaultValue: "ZBX", isPublic: true },
  { key: "chainHardfork", group: "chain", label: "Hardfork Label", kind: "string", defaultValue: "Cancun", isPublic: true },
  { key: "blockTime", group: "chain", label: "Target Block Time (sec)", kind: "number", defaultValue: 2, isPublic: true },
  { key: "rpcUrl", group: "chain", label: "Upstream RPC URL", kind: "url", defaultValue: "", isPublic: false, hint: "If set, the /api/rpc proxy forwards here instead of ZEBVIX_VPS_RPC. Leave blank to use the env default.", isSensitive: true },
  { key: "wsUrl", group: "chain", label: "Upstream WS URL", kind: "url", defaultValue: "", isPublic: false, hint: "Optional, displayed in the dashboard if present." },
  { key: "explorerName", group: "chain", label: "Block Explorer Name", kind: "string", defaultValue: "Zebvix Explorer", isPublic: true },
  { key: "explorerUrl", group: "chain", label: "Block Explorer URL", kind: "url", defaultValue: "", isPublic: true, hint: "External explorer URL shown on dashboards. Leave blank to keep using the in-app explorer." },
  // Branding
  { key: "brandName", group: "branding", label: "Brand Name", kind: "string", defaultValue: "Zebvix", isPublic: true },
  { key: "brandTagline", group: "branding", label: "Tagline", kind: "string", defaultValue: "Production-ready Sui-based L1", isPublic: true },
  { key: "brandDomain", group: "branding", label: "Public Domain", kind: "string", defaultValue: "", isPublic: true, hint: "Primary domain users see, e.g. zebvix.com" },
  { key: "supportEmail", group: "branding", label: "Support Email", kind: "string", defaultValue: "", isPublic: true },
  { key: "primaryColor", group: "branding", label: "Primary Color", kind: "color", defaultValue: "#10b981", isPublic: true },
  { key: "accentColor", group: "branding", label: "Accent Color", kind: "color", defaultValue: "#0ea5e9", isPublic: true },
  // Links
  { key: "twitterUrl", group: "links", label: "Twitter / X URL", kind: "url", defaultValue: "", isPublic: true },
  { key: "githubUrl", group: "links", label: "GitHub URL", kind: "url", defaultValue: "", isPublic: true },
  { key: "discordUrl", group: "links", label: "Discord URL", kind: "url", defaultValue: "", isPublic: true },
  { key: "docsUrl", group: "links", label: "Docs URL", kind: "url", defaultValue: "", isPublic: true },

  // Feature flags — toggle entire dashboard sections on/off. Disabled features
  // get hidden from the sidebar via /api/admin/settings/public. Pages are still
  // reachable via direct URL (so admins can preview them); use this together
  // with deletion in the nav editor for a hard hide.
  { key: "featuresDexEnabled", group: "features", label: "DEX / Swap pages", kind: "boolean", defaultValue: true, isPublic: true, hint: "Show DEX, Token Trade, Token Liquidity, Pool Explorer in the sidebar." },
  { key: "featuresBridgeEnabled", group: "features", label: "Bridge pages", kind: "boolean", defaultValue: true, isPublic: true },
  { key: "featuresStakingEnabled", group: "features", label: "Staking pages", kind: "boolean", defaultValue: true, isPublic: true },
  { key: "featuresFaucetEnabled", group: "features", label: "Faucet", kind: "boolean", defaultValue: true, isPublic: true },
  { key: "featuresGovernanceEnabled", group: "features", label: "Governance", kind: "boolean", defaultValue: true, isPublic: true },
  { key: "featuresWalletEnabled", group: "features", label: "Wallet pages", kind: "boolean", defaultValue: true, isPublic: true, hint: "Web Wallet, Import, Connect Wallet." },
  { key: "featuresMultisigEnabled", group: "features", label: "Multisig Explorer", kind: "boolean", defaultValue: true, isPublic: true },
  { key: "featuresPayidEnabled", group: "features", label: "PayID pages", kind: "boolean", defaultValue: true, isPublic: true },
  { key: "featuresTokenCreateEnabled", group: "features", label: "Create Your Token", kind: "boolean", defaultValue: true, isPublic: true },
  { key: "featuresChainBuilderEnabled", group: "features", label: "Chain Builder", kind: "boolean", defaultValue: true, isPublic: true },

  // DEX / Trading defaults — consumed by the Token Trade and DEX pages.
  { key: "dexFeeBps", group: "dex", label: "Default trade fee (bps)", kind: "bps", defaultValue: 30, isPublic: true, hint: "30 = 0.30%. Range 0..10000." },
  { key: "dexDefaultSlippageBps", group: "dex", label: "Default slippage (bps)", kind: "bps", defaultValue: 50, isPublic: true, hint: "50 = 0.50%." },
  { key: "dexMinLiquidityWarn", group: "dex", label: "Min liquidity warning", kind: "number", defaultValue: 1000, isPublic: true, min: 0, max: 1_000_000_000, hint: "Show low-liquidity warning below this token amount." },
  { key: "dexBaseToken", group: "dex", label: "Base token symbol", kind: "string", defaultValue: "ZBX", isPublic: true, hint: "Default base side for new pools / quote display." },
  { key: "dexAllowedTokens", group: "dex", label: "Allow-list (CSV symbols)", kind: "csv", defaultValue: "", isPublic: true, hint: "If set, only these symbols are tradeable. Leave blank to allow all." },
  { key: "dexBlockedTokens", group: "dex", label: "Block-list (CSV symbols)", kind: "csv", defaultValue: "", isPublic: true, hint: "Always blocked, evaluated after the allow-list." },
  { key: "dexQuoteRefreshSec", group: "dex", label: "Quote refresh interval (s)", kind: "number", defaultValue: 6, isPublic: true, min: 1, max: 300 },

  // Faucet config
  { key: "faucetAmount", group: "faucet", label: "Faucet drip amount", kind: "number", defaultValue: 1, isPublic: true, min: 0, max: 1_000_000 },
  { key: "faucetCooldownSec", group: "faucet", label: "Cooldown per address (s)", kind: "number", defaultValue: 86_400, isPublic: true, min: 0, max: 31_536_000 },
  { key: "faucetMessage", group: "faucet", label: "Custom message", kind: "string", defaultValue: "", isPublic: true },

  // System-wide controls — maintenance gate + announcement banner shown on
  // every page. Used by the dashboard <SystemBanner /> + maintenance overlay.
  { key: "maintenanceMode", group: "system", label: "Maintenance mode", kind: "boolean", defaultValue: false, isPublic: true, hint: "Shows a full-page maintenance overlay to all visitors. Admin page stays reachable." },
  { key: "maintenanceMessage", group: "system", label: "Maintenance message", kind: "string", defaultValue: "We'll be back shortly.", isPublic: true },
  { key: "announcementEnabled", group: "system", label: "Show announcement banner", kind: "boolean", defaultValue: false, isPublic: true },
  { key: "announcementText", group: "system", label: "Announcement text", kind: "string", defaultValue: "", isPublic: true },
  { key: "announcementLevel", group: "system", label: "Announcement level", kind: "enum", defaultValue: "info", isPublic: true, options: ["info", "success", "warn", "critical"] },
  { key: "announcementUrl", group: "system", label: "Announcement link URL", kind: "url", defaultValue: "", isPublic: true, hint: "Optional — turns the banner into a link." },
];

const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));
const PUBLIC_KEYS = new Set(SETTING_DEFS.filter((d) => d.isPublic).map((d) => d.key));

export function isKnownKey(k: string): boolean {
  return DEF_BY_KEY.has(k);
}

export function defaultsFor(keys: Iterable<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const def = DEF_BY_KEY.get(k);
    if (def) out[k] = def.defaultValue;
  }
  return out;
}

// ── Cache ───────────────────────────────────────────────────────────────────
// We hit DB once and keep the snapshot in memory for CACHE_TTL ms. Mutations
// invalidate the cache immediately so the admin UI reflects writes instantly.
const CACHE_TTL = 5_000;
let cache: { at: number; map: Map<string, unknown> } | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.map;
  try {
    const rows = await db.select().from(adminSettingsTable);
    const map = new Map<string, unknown>();
    for (const r of rows) map.set(r.key, r.value);
    cache = { at: Date.now(), map };
    return map;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_settings_load_failed",
    );
    // Return empty map; callers will fall back to defaults / env.
    return new Map();
  }
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const map = await loadAll();
  const out: Record<string, unknown> = {};
  for (const def of SETTING_DEFS) {
    out[def.key] = map.has(def.key) ? map.get(def.key) : def.defaultValue;
  }
  return out;
}

export async function getPublicSettings(): Promise<Record<string, unknown>> {
  const all = await getAllSettings();
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_KEYS) {
    if (k in all) out[k] = all[k];
  }
  return out;
}

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const map = await loadAll();
  if (map.has(key)) return map.get(key) as T;
  const def = DEF_BY_KEY.get(key);
  return def ? (def.defaultValue as T) : undefined;
}

export async function upsertSettings(updates: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(updates).filter(([k]) => DEF_BY_KEY.has(k));
  if (entries.length === 0) return;
  // Atomic across the whole payload — concurrent writers can't interleave a
  // partial-payload PUT (e.g. half maintenance + half DEX). Cache is only
  // invalidated on success; if the transaction throws, readers keep the old
  // values until the next successful write.
  await db.transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx
        .insert(adminSettingsTable)
        .values({ key, value: value as never })
        .onConflictDoUpdate({
          target: adminSettingsTable.key,
          set: { value: value as never, updatedAt: new Date() },
        });
    }
  });
  invalidateSettingsCache();
}

export async function deleteSettings(keys: string[]): Promise<void> {
  const valid = keys.filter((k) => DEF_BY_KEY.has(k));
  if (valid.length === 0) return;
  await db.delete(adminSettingsTable).where(inArray(adminSettingsTable.key, valid));
  invalidateSettingsCache();
}

// Resolve the effective upstream RPC URL: DB override > env var > built-in
// fallback. Backed by the same 5-second cache as everything else, so the hot
// /api/rpc path does at most one DB read per 5 seconds across the whole proxy.
export async function getEffectiveRpcUrl(): Promise<string> {
  const fromDb = await getSetting<string>("rpcUrl");
  if (typeof fromDb === "string" && fromDb.trim().length > 0) {
    return fromDb.trim();
  }
  return process.env["ZEBVIX_VPS_RPC"] ?? "http://93.127.213.192:8545";
}

// Suppress unused-import warning if `eq` is removed from the file later — we
// keep it imported so the admin route module can use the same drizzle helpers
// without re-importing.
void eq;
