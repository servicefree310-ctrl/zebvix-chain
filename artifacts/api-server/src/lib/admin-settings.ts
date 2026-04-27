import { db, adminSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

// ── Setting catalog ─────────────────────────────────────────────────────────
// Centralised so the admin UI, the public-settings endpoint, and the RPC
// override all agree on what exists and what is safe to expose.
export type SettingKind = "string" | "number" | "url" | "color" | "boolean";

export interface SettingDef {
  key: string;
  group: "chain" | "branding" | "links";
  label: string;
  hint?: string;
  kind: SettingKind;
  defaultValue: string | number | boolean;
  isPublic: boolean;
  isSensitive?: boolean;
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
  // Upsert one at a time — small N, simple and safe.
  for (const [key, value] of entries) {
    await db
      .insert(adminSettingsTable)
      .values({ key, value: value as never })
      .onConflictDoUpdate({
        target: adminSettingsTable.key,
        set: { value: value as never, updatedAt: new Date() },
      });
  }
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
