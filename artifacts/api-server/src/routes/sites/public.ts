// Public (no-auth) endpoints for published sites: read by subdomain, track
// page views, submit leads, record crypto payments.
import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  sitesTable,
  pageViewsTable,
  leadsTable,
  sitePaymentsTable,
} from "@workspace/db";
import {
  TrackPageViewBody,
  SubmitLeadBody,
  RecordSitePaymentBody,
} from "@workspace/api-zod";
import { verifyPayment } from "../../lib/zebvix-rpc";
import { serializeLead } from "./leads";
import { serializePayment } from "./payments";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

function serializePublicSite(row: typeof sitesTable.$inferSelect) {
  return {
    id: row.id,
    subdomain: row.subdomain,
    title: row.title,
    description: row.description ?? "",
    blocks: (row.blocks ?? []) as unknown[],
    theme: (row.theme ?? {}) as Record<string, unknown>,
    seo: (row.seo ?? {}) as Record<string, unknown>,
    cryptoWallet: row.cryptoWallet ?? "",
  };
}

router.get(
  "/by-subdomain/:subdomain",
  async (req: Request, res: Response) => {
    const subdomain = String(req.params.subdomain).toLowerCase().trim();
    if (!subdomain) {
      res.status(400).json({ error: "invalid_subdomain" });
      return;
    }
    const rows = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.subdomain, subdomain));
    if (rows.length === 0 || !rows[0].published) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(serializePublicSite(rows[0]));
  },
);

router.post("/:siteId/track", async (req: Request, res: Response) => {
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = TrackPageViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  // Confirm site exists + is published; ignore otherwise (silent).
  const site = await db
    .select({ id: sitesTable.id, published: sitesTable.published })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  if (site.length === 0 || !site[0].published) {
    res.status(204).end();
    return;
  }
  try {
    await db.insert(pageViewsTable).values({
      siteId,
      path: parsed.data.path,
      referrer: parsed.data.referrer ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "track_page_view_failed",
    );
  }
  res.status(204).end();
});

router.post("/:siteId/leads", async (req: Request, res: Response) => {
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = SubmitLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const site = await db
    .select({ id: sitesTable.id, published: sitesTable.published })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  if (site.length === 0 || !site[0].published) {
    res.status(404).json({ error: "site_not_published" });
    return;
  }
  const inserted = await db
    .insert(leadsTable)
    .values({
      siteId,
      email: parsed.data.email ?? null,
      walletAddress: parsed.data.walletAddress ?? null,
      fields: (parsed.data.fields ?? {}) as Record<string, unknown>,
    })
    .returning();
  res.status(201).json(serializeLead(inserted[0]));
});

router.post("/:siteId/payments", async (req: Request, res: Response) => {
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = RecordSitePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const site = await db
    .select({ id: sitesTable.id, published: sitesTable.published })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  if (site.length === 0 || !site[0].published) {
    res.status(404).json({ error: "site_not_published" });
    return;
  }
  const body = parsed.data;
  const verification = await verifyPayment({
    txHash: body.txHash,
    fromAddress: body.fromAddress,
    toAddress: body.toAddress,
    asset: body.asset,
    amount: body.amount,
    chainId: body.chainId,
  });
  if (verification.status === "failed") {
    res
      .status(400)
      .json({ error: "verification_failed", reason: verification.reason });
    return;
  }
  try {
    const inserted = await db
      .insert(sitePaymentsTable)
      .values({
        siteId,
        txHash: body.txHash,
        fromAddress: body.fromAddress.toLowerCase(),
        toAddress: body.toAddress.toLowerCase(),
        asset: body.asset.toLowerCase(),
        amount: body.amount,
        chainId: body.chainId,
        memo: body.memo ?? null,
        status: verification.status,
      })
      .returning();
    res.status(201).json(serializePayment(inserted[0]));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "duplicate_tx" });
      return;
    }
    logger.error({ err: msg }, "record_payment_failed");
    res.status(500).json({ error: "record_failed" });
  }
});

export default router;
