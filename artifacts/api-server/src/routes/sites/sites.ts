import { Router, type IRouter, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, sitesTable } from "@workspace/db";
import { CreateSiteBody, UpdateSiteBody, PublishSiteBody } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../../lib/auth";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const MAX_EXTRA_PAGES = 12;
const MAX_BLOCKS_PER_PAGE = 60;
const RESERVED_SLUGS = new Set(["", "home", "index", "p", "api", "admin"]);

function sanitizeSlug(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

interface NormalizedPage {
  slug: string;
  name: string;
  blocks: unknown[];
  seo: Record<string, unknown>;
}

function normalizeExtraPages(input: unknown): NormalizedPage[] {
  if (!Array.isArray(input)) return [];
  const out: NormalizedPage[] = [];
  const used = new Set<string>();
  for (const raw of input) {
    if (out.length >= MAX_EXTRA_PAGES) break;
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const baseSlug = sanitizeSlug(p.slug ?? p.name);
    if (!baseSlug || RESERVED_SLUGS.has(baseSlug)) continue;
    let slug = baseSlug;
    let n = 2;
    while (used.has(slug) && n <= 99) {
      const suffix = `-${n}`;
      const trimmedBase = baseSlug.slice(0, Math.max(1, 30 - suffix.length));
      slug = `${trimmedBase}${suffix}`;
      n++;
    }
    if (used.has(slug)) continue;
    used.add(slug);
    const nameRaw = typeof p.name === "string" && p.name.trim() ? p.name.trim() : slug;
    const name = nameRaw.slice(0, 60);
    const blocksRaw = Array.isArray(p.blocks) ? p.blocks : [];
    const blocks = blocksRaw
      .filter((b) => b && typeof b === "object")
      .slice(0, MAX_BLOCKS_PER_PAGE);
    const seoRaw = p.seo && typeof p.seo === "object" ? (p.seo as Record<string, unknown>) : {};
    out.push({ slug, name, blocks, seo: seoRaw });
  }
  return out;
}

function serializeSite(row: typeof sitesTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    subdomain: row.subdomain,
    title: row.title,
    description: row.description ?? "",
    blocks: (row.blocks ?? []) as unknown[],
    extraPages: (row.extraPages ?? []) as unknown[],
    theme: (row.theme ?? {}) as Record<string, unknown>,
    seo: (row.seo ?? {}) as Record<string, unknown>,
    cryptoWallet: row.cryptoWallet ?? undefined,
    published: row.published,
    publishedAt: row.publishedAt
      ? row.publishedAt.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const rows = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.userId, req.userId!))
    .orderBy(desc(sitesTable.updatedAt));
  res.json(rows.map(serializeSite));
});

router.post("/", requireAuth, async (req: AuthedRequest, res: Response) => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  const subdomain = body.subdomain.toLowerCase().trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(subdomain)) {
    res.status(400).json({ error: "invalid_subdomain" });
    return;
  }
  try {
    const inserted = await db
      .insert(sitesTable)
      .values({
        userId: req.userId!,
        subdomain,
        title: body.title,
        description: body.description ?? "",
        blocks: body.blocks as unknown as Record<string, unknown>[],
        extraPages: normalizeExtraPages(body.extraPages) as unknown as Record<string, unknown>[],
        theme: body.theme as unknown as Record<string, unknown>,
        seo: body.seo as unknown as Record<string, unknown>,
        cryptoWallet: body.cryptoWallet ?? null,
      })
      .returning();
    res.status(201).json(serializeSite(inserted[0]));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "subdomain_taken" });
      return;
    }
    logger.error({ err: msg }, "create_site_failed");
    res.status(500).json({ error: "create_failed" });
  }
});

router.get("/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const rows = await db
    .select()
    .from(sitesTable)
    .where(and(eq(sitesTable.id, id), eq(sitesTable.userId, req.userId!)));
  if (rows.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(serializeSite(rows[0]));
});

router.patch("/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = UpdateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
    return;
  }
  const patch = parsed.data;
  if (patch.subdomain) {
    const sd = patch.subdomain.toLowerCase().trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(sd)) {
      res.status(400).json({ error: "invalid_subdomain" });
      return;
    }
    patch.subdomain = sd;
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.subdomain !== undefined) update.subdomain = patch.subdomain;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.blocks !== undefined) update.blocks = patch.blocks;
  if (patch.extraPages !== undefined) update.extraPages = normalizeExtraPages(patch.extraPages);
  if (patch.theme !== undefined) update.theme = patch.theme;
  if (patch.seo !== undefined) update.seo = patch.seo;
  if (patch.cryptoWallet !== undefined) update.cryptoWallet = patch.cryptoWallet;

  try {
    const updated = await db
      .update(sitesTable)
      .set(update)
      .where(and(eq(sitesTable.id, id), eq(sitesTable.userId, req.userId!)))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(serializeSite(updated[0]));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "subdomain_taken" });
      return;
    }
    logger.error({ err: msg }, "update_site_failed");
    res.status(500).json({ error: "update_failed" });
  }
});

router.delete("/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const deleted = await db
    .delete(sitesTable)
    .where(and(eq(sitesTable.id, id), eq(sitesTable.userId, req.userId!)))
    .returning({ id: sitesTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

router.post(
  "/:id/publish",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = PublishSiteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const published = parsed.data.published;
    const updated = await db
      .update(sitesTable)
      .set({
        published,
        publishedAt: published ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(sitesTable.id, id), eq(sitesTable.userId, req.userId!)))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(serializeSite(updated[0]));
  },
);

export default router;
export { serializeSite };
