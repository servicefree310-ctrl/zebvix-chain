import { Router } from "express";
import { z } from "zod";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { db, adminNavItemsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import {
  adminTokenConfigured,
  requireAdmin,
  verifyAdminToken,
} from "../lib/admin-auth";
import {
  SETTING_DEFS,
  getAllSettings,
  getPublicSettings,
  upsertSettings,
  deleteSettings,
  isKnownKey,
} from "../lib/admin-settings";
import { logger } from "../lib/logger";

const adminRouter = Router();

// Brute-force protection: cap admin-token attempts to 10/min per IP. Counts
// ONLY failed (non-2xx) responses, so legitimate users hitting GET /settings
// or GET /nav repeatedly are not throttled. Applied to /admin/auth/check
// AND every requireAdmin-protected route so an attacker can't bypass the cap
// by hammering the 401 oracle on /admin/settings or /admin/nav. Combined with
// the existing global /api limiter (600/min) and timingSafeEqual check, this
// gives static-token auth meaningful brute-force resistance.
const adminAuthLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "rate_limited", retryAfterSec: 60 },
  skipSuccessfulRequests: true,
});

// Lighter cap on mutating admin endpoints — generous for normal use, but
// blocks anyone who somehow obtains a token from hammering the API. Counts
// every request regardless of outcome.
const adminMutateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "rate_limited", retryAfterSec: 60 },
});

// ── Default nav seed ────────────────────────────────────────────────────────
// Mirrors the hardcoded arrays in
// artifacts/sui-fork-dashboard/src/components/layout/sidebar.tsx so the admin
// panel can edit / disable / re-order any of them. Custom items added through
// the panel live alongside these (isCustom=true).
interface NavSeed {
  slug: string;
  section: "core" | "live" | "addons";
  label: string;
  href: string;
  iconName: string;
  badge?: string;
  sortOrder: number;
}

const DEFAULT_NAV: NavSeed[] = [
  // CORE
  { slug: "core:overview", section: "core", label: "Overview", href: "/", iconName: "BookOpen", sortOrder: 10 },
  { slug: "core:chain-builder", section: "core", label: "Build Your Own Chain", href: "/chain-builder", iconName: "Hammer", badge: "NEW", sortOrder: 20 },
  { slug: "core:docs", section: "core", label: "Documentation", href: "/docs", iconName: "BookOpen", sortOrder: 30 },
  { slug: "core:quick-start", section: "core", label: "Quick Start Script", href: "/quick-start", iconName: "PlayCircle", sortOrder: 40 },
  { slug: "core:setup", section: "core", label: "Environment Setup", href: "/setup", iconName: "TerminalSquare", sortOrder: 50 },
  { slug: "core:genesis", section: "core", label: "Genesis Config", href: "/genesis", iconName: "FileJson", sortOrder: 60 },
  { slug: "core:validators", section: "core", label: "Validator Setup", href: "/validators", iconName: "Users", sortOrder: 70 },
  { slug: "core:network", section: "core", label: "Network Config", href: "/network", iconName: "Network", sortOrder: 80 },
  { slug: "core:tokenomics", section: "core", label: "Tokenomics", href: "/tokenomics", iconName: "Coins", sortOrder: 90 },
  { slug: "core:smart-contracts", section: "core", label: "Smart Contracts", href: "/smart-contracts", iconName: "FileCode2", badge: "LIVE", sortOrder: 100 },
  { slug: "core:customization", section: "core", label: "Customization", href: "/customization", iconName: "Settings", sortOrder: 110 },
  { slug: "core:checklist", section: "core", label: "Launch Checklist", href: "/checklist", iconName: "CheckSquare", sortOrder: 120 },
  { slug: "core:production", section: "core", label: "Production Chain", href: "/production", iconName: "Rocket", sortOrder: 130 },
  { slug: "core:sdk", section: "core", label: "Developer SDK (zebvix.js)", href: "/sdk", iconName: "Package", badge: "NEW", sortOrder: 140 },
  // LIVE
  { slug: "live:live-chain", section: "live", label: "Live Chain Status", href: "/live-chain", iconName: "Activity", badge: "LIVE", sortOrder: 10 },
  { slug: "live:rpc-playground", section: "live", label: "RPC Playground", href: "/rpc-playground", iconName: "Terminal", sortOrder: 20 },
  { slug: "live:zvm-explorer", section: "live", label: "ZVM Explorer", href: "/zvm-explorer", iconName: "Cpu", sortOrder: 30 },
  { slug: "live:block-explorer", section: "live", label: "Block Explorer", href: "/block-explorer", iconName: "Search", sortOrder: 40 },
  { slug: "live:balance-lookup", section: "live", label: "Balance Lookup", href: "/balance-lookup", iconName: "Wallet", sortOrder: 50 },
  { slug: "live:multisig-explorer", section: "live", label: "Multisig Explorer", href: "/multisig-explorer", iconName: "Shield", sortOrder: 60 },
  { slug: "live:pool-explorer", section: "live", label: "Pool Explorer", href: "/pool-explorer", iconName: "Droplets", sortOrder: 70 },
  { slug: "live:bridge-live", section: "live", label: "Bridge — Lock & Send", href: "/bridge-live", iconName: "Lock", badge: "LIVE", sortOrder: 80 },
  { slug: "live:staking", section: "live", label: "Staking Dashboard", href: "/staking", iconName: "TrendingUp", sortOrder: 90 },
  { slug: "live:token-create", section: "live", label: "Create Your Token", href: "/token-create", iconName: "Sparkles", badge: "NEW", sortOrder: 100 },
  { slug: "live:token-trade", section: "live", label: "Token Trade (AMM)", href: "/token-trade", iconName: "ArrowDownUp", sortOrder: 110 },
  { slug: "live:token-liquidity", section: "live", label: "Token Liquidity", href: "/token-liquidity", iconName: "Droplets", sortOrder: 120 },
  { slug: "live:token-metadata", section: "live", label: "Token Metadata", href: "/token-metadata", iconName: "Info", sortOrder: 130 },
  { slug: "live:dex", section: "live", label: "DEX / Swap", href: "/dex", iconName: "ArrowUpDown", sortOrder: 140 },
  { slug: "live:fabric-layer", section: "live", label: "Zebvix Fabric Layer", href: "/fabric-layer", iconName: "Layers", sortOrder: 150 },
  { slug: "live:code-review", section: "live", label: "Code Review — What Changed", href: "/code-review", iconName: "FileCode2", sortOrder: 160 },
  { slug: "live:chain-code", section: "live", label: "Chain Source Code", href: "/chain-code", iconName: "Code2", sortOrder: 170 },
  { slug: "live:service-code", section: "live", label: "Service & Page Code", href: "/service-code", iconName: "Code2", badge: "NEW", sortOrder: 180 },
  { slug: "live:chain-status", section: "live", label: "Chain Features", href: "/chain-status", iconName: "Sparkles", sortOrder: 190 },
  { slug: "live:consensus-roadmap", section: "live", label: "Consensus Roadmap (DAG-BFT)", href: "/consensus-roadmap", iconName: "GitBranch", sortOrder: 200 },
  { slug: "live:downloads", section: "live", label: "Downloads", href: "/downloads", iconName: "Download", sortOrder: 210 },
  // ADDONS
  { slug: "addons:wallet", section: "addons", label: "Web Wallet", href: "/wallet", iconName: "Wallet", sortOrder: 10 },
  { slug: "addons:import-wallet", section: "addons", label: "Import Wallet", href: "/import-wallet", iconName: "KeyRound", sortOrder: 20 },
  { slug: "addons:connect-wallet", section: "addons", label: "Connect Wallet", href: "/connect-wallet", iconName: "Wallet", sortOrder: 30 },
  { slug: "addons:swap", section: "addons", label: "Swap", href: "/swap", iconName: "ArrowLeftRight", sortOrder: 40 },
  { slug: "addons:bridge", section: "addons", label: "Bridge UI", href: "/bridge", iconName: "Network", sortOrder: 50 },
  { slug: "addons:faucet", section: "addons", label: "Faucet", href: "/faucet", iconName: "Droplets", sortOrder: 60 },
  { slug: "addons:governance", section: "addons", label: "Governance", href: "/governance", iconName: "Vote", sortOrder: 70 },
  { slug: "addons:payid-register", section: "addons", label: "PayID Register", href: "/payid-register", iconName: "UserPlus", sortOrder: 80 },
  { slug: "addons:payid-resolver", section: "addons", label: "PayID Resolver", href: "/payid-resolver", iconName: "AtSign", sortOrder: 90 },
];

async function ensureSeeded(): Promise<void> {
  try {
    const rows = await db.select({ slug: adminNavItemsTable.slug }).from(adminNavItemsTable);
    if (rows.length > 0) return;
    await db.insert(adminNavItemsTable).values(
      DEFAULT_NAV.map((n) => ({
        slug: n.slug,
        section: n.section,
        label: n.label,
        href: n.href,
        iconName: n.iconName,
        badge: n.badge ?? null,
        sortOrder: n.sortOrder,
        enabled: true,
        isCustom: false,
        openInNewTab: false,
      })),
    );
    logger.info({ count: DEFAULT_NAV.length }, "admin_nav_seeded");
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_nav_seed_failed",
    );
  }
}

// Best-effort seed on module load. Failure here is non-fatal — the routes
// will simply return empty results until the DB is reachable.
void ensureSeeded();

// ── Auth status (public) ────────────────────────────────────────────────────
adminRouter.get("/admin/auth/status", (_req, res) => {
  res.json({ configured: adminTokenConfigured() });
});

const checkSchema = z.object({ token: z.string().min(1).max(512) });
adminRouter.post("/admin/auth/check", adminAuthLimiter, (req, res) => {
  if (!adminTokenConfigured()) {
    res.status(503).json({ ok: false, error: "admin_not_configured" });
    return;
  }
  const parsed = checkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "invalid_body" });
    return;
  }
  const ok = verifyAdminToken(parsed.data.token);
  if (!ok) {
    res.status(401).json({ ok: false, error: "invalid_token" });
    return;
  }
  res.json({ ok: true });
});

// ── Settings catalog (public) ───────────────────────────────────────────────
// Lets the admin UI render the right form without bundling the schema twice.
adminRouter.get("/admin/settings/catalog", (_req, res) => {
  res.json({
    defs: SETTING_DEFS.map((d) => ({
      key: d.key,
      group: d.group,
      label: d.label,
      hint: d.hint ?? null,
      kind: d.kind,
      defaultValue: d.defaultValue,
      isPublic: d.isPublic,
      isSensitive: d.isSensitive ?? false,
      // Render hints — frontend uses these to build select/range inputs.
      ...(d.options ? { options: d.options } : {}),
      ...(typeof d.min === "number" ? { min: d.min } : {}),
      ...(typeof d.max === "number" ? { max: d.max } : {}),
    })),
  });
});

// ── Public settings (no auth) ───────────────────────────────────────────────
adminRouter.get("/admin/settings/public", async (_req, res) => {
  try {
    const values = await getPublicSettings();
    res.json({ values });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_settings_public_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

// ── Full settings (auth) ────────────────────────────────────────────────────
adminRouter.get("/admin/settings", adminAuthLimiter, requireAdmin, async (_req, res) => {
  try {
    const values = await getAllSettings();
    res.json({ values });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_settings_get_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

const settingsBodySchema = z
  .object({
    values: z.record(z.string(), z.unknown()),
  })
  .strict();

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

type FieldError = { key: string; reason: string };

// Per-key validation that mirrors SETTING_DEFS.kind. Returns either a
// sanitised, ready-to-write record or a list of field errors. Empty strings
// are allowed for optional inputs (urls/colors) and treated as "clear".
function validateSettings(
  input: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; errors: FieldError[] } {
  const out: Record<string, unknown> = {};
  const errors: FieldError[] = [];
  for (const [k, raw] of Object.entries(input)) {
    if (!isKnownKey(k)) continue;
    const def = SETTING_DEFS.find((d) => d.key === k)!;
    let v: unknown = raw;
    // Normalise strings.
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === null || v === undefined) {
      // Allow clearing optional fields back to default. Numbers/bps stay
      // required (must be explicit) — except enum, which falls back to default.
      if (def.kind === "number" || def.kind === "bps") {
        errors.push({ key: k, reason: "must be a number" });
        continue;
      }
      if (def.kind === "boolean") out[k] = Boolean(def.defaultValue);
      else if (def.kind === "enum") out[k] = String(def.defaultValue);
      else out[k] = "";
      continue;
    }
    switch (def.kind) {
      case "number": {
        // Type-strict: only real numbers or strict numeric strings. Booleans
        // and arrays/objects must NOT silently coerce (Number(true) === 1,
        // Number([1]) === 1) — that would be a type-confusion bypass.
        let n: number;
        if (typeof v === "number") {
          n = v;
        } else if (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v)) {
          n = Number(v);
        } else {
          errors.push({ key: k, reason: "must be a number" });
          continue;
        }
        if (!Number.isFinite(n) || n < 0 || n > 2 ** 53 - 1) {
          errors.push({ key: k, reason: "must be a non-negative finite number" });
          continue;
        }
        if (typeof def.min === "number" && n < def.min) {
          errors.push({ key: k, reason: `must be >= ${def.min}` });
          continue;
        }
        if (typeof def.max === "number" && n > def.max) {
          errors.push({ key: k, reason: `must be <= ${def.max}` });
          continue;
        }
        out[k] = n;
        break;
      }
      case "bps": {
        // Same type-strict policy as `number` — basis points are integer-only.
        let n: number;
        if (typeof v === "number") {
          n = v;
        } else if (typeof v === "string" && /^\d+$/.test(v)) {
          n = Number(v);
        } else {
          errors.push({ key: k, reason: "must be an integer 0..10000 (basis points)" });
          continue;
        }
        if (!Number.isInteger(n) || n < 0 || n > 10_000) {
          errors.push({ key: k, reason: "must be an integer 0..10000 (basis points)" });
          continue;
        }
        out[k] = n;
        break;
      }
      case "boolean": {
        if (typeof v !== "boolean") {
          errors.push({ key: k, reason: "must be true or false" });
          continue;
        }
        out[k] = v;
        break;
      }
      case "url": {
        if (typeof v !== "string" || !URL_RE.test(v) || v.length > 1024) {
          errors.push({ key: k, reason: "must be a http(s) URL under 1024 chars" });
          continue;
        }
        out[k] = v;
        break;
      }
      case "color": {
        if (typeof v !== "string" || !COLOR_RE.test(v)) {
          errors.push({ key: k, reason: "must be a #rrggbb hex color" });
          continue;
        }
        out[k] = v.toLowerCase();
        break;
      }
      case "enum": {
        const opts = def.options ?? [];
        if (typeof v !== "string" || !opts.includes(v)) {
          errors.push({ key: k, reason: `must be one of: ${opts.join(", ")}` });
          continue;
        }
        out[k] = v;
        break;
      }
      case "csv": {
        if (typeof v !== "string") {
          errors.push({ key: k, reason: "must be a string (comma-separated)" });
          continue;
        }
        if (v.length > 4096) {
          errors.push({ key: k, reason: "csv too long (max 4096 chars)" });
          continue;
        }
        // Normalise: split, trim, drop empties, dedupe, alphanumeric+_- only.
        const items = Array.from(
          new Set(
            v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        );
        const bad = items.find((it) => !/^[A-Za-z0-9_.\-]{1,64}$/.test(it));
        if (bad) {
          errors.push({ key: k, reason: `invalid token "${bad}" — letters, digits, _-. only, max 64 chars` });
          continue;
        }
        if (items.length > 200) {
          errors.push({ key: k, reason: "too many entries (max 200)" });
          continue;
        }
        out[k] = items.join(",");
        break;
      }
      case "string":
      default: {
        if (typeof v !== "string") {
          errors.push({ key: k, reason: "must be a string" });
          continue;
        }
        if (v.length > 4096) {
          errors.push({ key: k, reason: "string too long (max 4096)" });
          continue;
        }
        out[k] = v;
        break;
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, values: out };
}

adminRouter.put("/admin/settings", adminAuthLimiter, adminMutateLimiter, requireAdmin, async (req, res) => {
  const parsed = settingsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const validated = validateSettings(parsed.data.values);
  if (!validated.ok) {
    res.status(400).json({ error: "invalid_values", fields: validated.errors });
    return;
  }
  try {
    await upsertSettings(validated.values);
    const values = await getAllSettings();
    res.json({ ok: true, values });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_settings_put_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

const deleteBodySchema = z.object({ keys: z.array(z.string()).max(100) });
adminRouter.delete("/admin/settings", adminAuthLimiter, adminMutateLimiter, requireAdmin, async (req, res) => {
  const parsed = deleteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    await deleteSettings(parsed.data.keys);
    const values = await getAllSettings();
    res.json({ ok: true, values });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_settings_delete_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

// ── Nav items ───────────────────────────────────────────────────────────────
function rowOut(r: typeof adminNavItemsTable.$inferSelect) {
  return {
    id: r.id,
    slug: r.slug,
    section: r.section,
    label: r.label,
    href: r.href,
    iconName: r.iconName,
    badge: r.badge,
    sortOrder: r.sortOrder,
    enabled: r.enabled,
    isCustom: r.isCustom,
    openInNewTab: r.openInNewTab,
    updatedAt: r.updatedAt,
  };
}

adminRouter.get("/admin/nav/public", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(adminNavItemsTable)
      .where(eq(adminNavItemsTable.enabled, true))
      .orderBy(asc(adminNavItemsTable.section), asc(adminNavItemsTable.sortOrder));
    res.json({ items: rows.map(rowOut) });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_nav_public_failed",
    );
    // Return empty so the sidebar overlay logic falls back cleanly to its
    // hardcoded defaults instead of breaking the app.
    res.json({ items: [] });
  }
});

adminRouter.get("/admin/nav", adminAuthLimiter, requireAdmin, async (_req, res) => {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(adminNavItemsTable)
      .orderBy(asc(adminNavItemsTable.section), asc(adminNavItemsTable.sortOrder));
    res.json({ items: rows.map(rowOut) });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_nav_get_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

const SECTION_VALUES = ["core", "live", "addons"] as const;
const navCreateSchema = z.object({
  slug: z.string().min(1).max(128).regex(/^[a-z0-9:_-]+$/i),
  section: z.enum(SECTION_VALUES),
  label: z.string().min(1).max(128),
  href: z.string().min(1).max(512),
  iconName: z.string().min(1).max(64).default("Link"),
  badge: z.union([z.enum(["LIVE", "NEW", "PRO"]), z.null()]).optional(),
  sortOrder: z.number().int().min(0).max(10000).default(1000),
  enabled: z.boolean().default(true),
  openInNewTab: z.boolean().default(false),
});

adminRouter.post("/admin/nav", adminAuthLimiter, adminMutateLimiter, requireAdmin, async (req, res) => {
  const parsed = navCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", detail: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  try {
    const [row] = await db
      .insert(adminNavItemsTable)
      .values({
        slug: data.slug,
        section: data.section,
        label: data.label,
        href: data.href,
        iconName: data.iconName,
        badge: data.badge ?? null,
        sortOrder: data.sortOrder,
        enabled: data.enabled,
        isCustom: true,
        openInNewTab: data.openInNewTab,
      })
      .returning();
    res.status(201).json({ item: rowOut(row) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key/i.test(msg)) {
      res.status(409).json({ error: "slug_exists" });
      return;
    }
    logger.error({ err: msg }, "admin_nav_create_failed");
    res.status(500).json({ error: "failed" });
  }
});

const navUpdateSchema = z.object({
  label: z.string().min(1).max(128).optional(),
  href: z.string().min(1).max(512).optional(),
  iconName: z.string().min(1).max(64).optional(),
  badge: z.union([z.enum(["LIVE", "NEW", "PRO"]), z.null()]).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
  openInNewTab: z.boolean().optional(),
  section: z.enum(SECTION_VALUES).optional(),
});

adminRouter.put("/admin/nav/:id", adminAuthLimiter, adminMutateLimiter, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = navUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", detail: parsed.error.flatten() });
    return;
  }
  const update = { ...parsed.data, updatedAt: new Date() };
  try {
    const [row] = await db
      .update(adminNavItemsTable)
      .set(update)
      .where(eq(adminNavItemsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ item: rowOut(row) });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_nav_update_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

adminRouter.delete("/admin/nav/:id", adminAuthLimiter, adminMutateLimiter, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  try {
    const [row] = await db
      .select()
      .from(adminNavItemsTable)
      .where(eq(adminNavItemsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!row.isCustom) {
      // Built-in items can be disabled but not deleted, otherwise the seed
      // wouldn't bring them back without a manual reset.
      res.status(409).json({
        error: "cannot_delete_builtin",
        message: "Built-in items can be disabled but not deleted. Use the Disable toggle instead.",
      });
      return;
    }
    await db.delete(adminNavItemsTable).where(eq(adminNavItemsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_nav_delete_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

adminRouter.post("/admin/nav/reset", adminAuthLimiter, adminMutateLimiter, requireAdmin, async (_req, res) => {
  try {
    // Wipe and re-seed the built-in entries; preserve custom items.
    await db.delete(adminNavItemsTable).where(eq(adminNavItemsTable.isCustom, false));
    await db.insert(adminNavItemsTable).values(
      DEFAULT_NAV.map((n) => ({
        slug: n.slug,
        section: n.section,
        label: n.label,
        href: n.href,
        iconName: n.iconName,
        badge: n.badge ?? null,
        sortOrder: n.sortOrder,
        enabled: true,
        isCustom: false,
        openInNewTab: false,
      })),
    );
    res.json({ ok: true, count: DEFAULT_NAV.length });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "admin_nav_reset_failed",
    );
    res.status(500).json({ error: "failed" });
  }
});

export default adminRouter;
