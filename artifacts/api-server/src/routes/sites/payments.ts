import { Router, type IRouter, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, sitePaymentsTable, sitesTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../../lib/auth";

const router: IRouter = Router();

function serializePayment(row: typeof sitePaymentsTable.$inferSelect) {
  return {
    id: row.id,
    siteId: row.siteId,
    txHash: row.txHash,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    asset: row.asset,
    amount: row.amount,
    status: row.status,
    chainId: row.chainId,
    memo: row.memo ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/:id/payments",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
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
      .from(sitePaymentsTable)
      .where(eq(sitePaymentsTable.siteId, id))
      .orderBy(desc(sitePaymentsTable.createdAt));
    res.json(rows.map(serializePayment));
  },
);

export default router;
export { serializePayment };
