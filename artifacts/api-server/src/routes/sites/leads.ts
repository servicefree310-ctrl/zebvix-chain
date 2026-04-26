import { Router, type IRouter, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, leadsTable, sitesTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../../lib/auth";

const router: IRouter = Router();

function serializeLead(row: typeof leadsTable.$inferSelect) {
  return {
    id: row.id,
    siteId: row.siteId,
    email: row.email ?? null,
    walletAddress: row.walletAddress ?? null,
    fields: (row.fields ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/:id/leads",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    // Verify ownership.
    const owner = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(and(eq(sitesTable.id, id), eq(sitesTable.userId, req.userId!)));
    if (owner.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rows = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.siteId, id))
      .orderBy(desc(leadsTable.createdAt));
    res.json(rows.map(serializeLead));
  },
);

export default router;
export { serializeLead };
