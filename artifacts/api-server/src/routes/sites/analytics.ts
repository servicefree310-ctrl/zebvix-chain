// Combined router for owner analytics:
//   GET /sites/sites/:id/analytics  (per-site analytics)
//   GET /sites/dashboard/summary    (cross-site dashboard summary)
import { Router, type IRouter, type Response } from "express";
import { and, eq, sql, desc, gte } from "drizzle-orm";
import {
  db,
  sitesTable,
  pageViewsTable,
  leadsTable,
  sitePaymentsTable,
} from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../../lib/auth";
import { serializeLead } from "./leads";
import { serializeSite } from "./sites";

const router: IRouter = Router();

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function buildLast30Days(siteId: number) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  since.setUTCHours(0, 0, 0, 0);

  const [views, leads, payments] = await Promise.all([
    db
      .select({
        d: sql<string>`to_char(${pageViewsTable.createdAt}, 'YYYY-MM-DD')`.as("d"),
        c: sql<number>`count(*)::int`.as("c"),
      })
      .from(pageViewsTable)
      .where(
        and(
          eq(pageViewsTable.siteId, siteId),
          gte(pageViewsTable.createdAt, since),
        ),
      )
      .groupBy(sql`to_char(${pageViewsTable.createdAt}, 'YYYY-MM-DD')`),
    db
      .select({
        d: sql<string>`to_char(${leadsTable.createdAt}, 'YYYY-MM-DD')`.as("d"),
        c: sql<number>`count(*)::int`.as("c"),
      })
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.siteId, siteId),
          gte(leadsTable.createdAt, since),
        ),
      )
      .groupBy(sql`to_char(${leadsTable.createdAt}, 'YYYY-MM-DD')`),
    db
      .select({
        d: sql<string>`to_char(${sitePaymentsTable.createdAt}, 'YYYY-MM-DD')`.as("d"),
        c: sql<number>`count(*)::int`.as("c"),
        rev: sql<string>`coalesce(sum(${sitePaymentsTable.amount}), 0)::text`.as("rev"),
      })
      .from(sitePaymentsTable)
      .where(
        and(
          eq(sitePaymentsTable.siteId, siteId),
          gte(sitePaymentsTable.createdAt, since),
          eq(sitePaymentsTable.status, "confirmed"),
        ),
      )
      .groupBy(sql`to_char(${sitePaymentsTable.createdAt}, 'YYYY-MM-DD')`),
  ]);

  const viewMap = new Map(views.map((r) => [r.d, r.c]));
  const leadMap = new Map(leads.map((r) => [r.d, r.c]));
  const payMap = new Map(payments.map((r) => [r.d, { c: r.c, rev: r.rev }]));

  const out: {
    date: string;
    views: number;
    leads: number;
    payments: number;
    revenue: string;
  }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = isoDate(d);
    const pay = payMap.get(key);
    out.push({
      date: key,
      views: viewMap.get(key) ?? 0,
      leads: leadMap.get(key) ?? 0,
      payments: pay?.c ?? 0,
      revenue: pay?.rev ?? "0",
    });
  }
  return out;
}

async function totalsByAsset(siteIds: number[]): Promise<{
  zbx: string;
  zusd: string;
  bnb: string;
  count: number;
}> {
  if (siteIds.length === 0) {
    return { zbx: "0", zusd: "0", bnb: "0", count: 0 };
  }
  const rows = await db
    .select({
      asset: sitePaymentsTable.asset,
      total: sql<string>`coalesce(sum(${sitePaymentsTable.amount}), 0)::text`.as(
        "total",
      ),
      cnt: sql<number>`count(*)::int`.as("cnt"),
    })
    .from(sitePaymentsTable)
    .where(
      and(
        sql`${sitePaymentsTable.siteId} = ANY(${siteIds})`,
        eq(sitePaymentsTable.status, "confirmed"),
      ),
    )
    .groupBy(sitePaymentsTable.asset);
  let zbx = "0",
    zusd = "0",
    bnb = "0",
    count = 0;
  for (const r of rows) {
    count += r.cnt;
    if (r.asset === "zbx") zbx = r.total;
    else if (r.asset === "zusd") zusd = r.total;
    else if (r.asset === "bnb") bnb = r.total;
  }
  return { zbx, zusd, bnb, count };
}

router.get(
  "/:id/analytics",
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

    const [viewsTotal, leadsTotal, totals, last30Days, refRows] = await Promise.all([
      db
        .select({ c: sql<number>`count(*)::int`.as("c") })
        .from(pageViewsTable)
        .where(eq(pageViewsTable.siteId, id)),
      db
        .select({ c: sql<number>`count(*)::int`.as("c") })
        .from(leadsTable)
        .where(eq(leadsTable.siteId, id)),
      totalsByAsset([id]),
      buildLast30Days(id),
      db
        .select({
          referrer: sql<string>`coalesce(${pageViewsTable.referrer}, '(direct)')`.as(
            "referrer",
          ),
          c: sql<number>`count(*)::int`.as("c"),
        })
        .from(pageViewsTable)
        .where(eq(pageViewsTable.siteId, id))
        .groupBy(sql`coalesce(${pageViewsTable.referrer}, '(direct)')`)
        .orderBy(desc(sql`count(*)`))
        .limit(8),
    ]);

    res.json({
      siteId: id,
      totalViews: viewsTotal[0]?.c ?? 0,
      totalLeads: leadsTotal[0]?.c ?? 0,
      totalPayments: totals.count,
      totalRevenueZbx: totals.zbx,
      totalRevenueZusd: totals.zusd,
      totalRevenueBnb: totals.bnb,
      last30Days,
      topReferrers: refRows.map((r) => ({
        referrer: r.referrer,
        count: r.c,
      })),
    });
  },
);

router.get(
  "/summary",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const allSites = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.userId, req.userId!))
      .orderBy(desc(sitesTable.updatedAt));

    const siteIds = allSites.map((s) => s.id);
    const [viewsRow, leadsRow, totals, recentLeadsRows] = await Promise.all([
      siteIds.length === 0
        ? Promise.resolve([{ c: 0 }])
        : db
            .select({ c: sql<number>`count(*)::int`.as("c") })
            .from(pageViewsTable)
            .where(sql`${pageViewsTable.siteId} = ANY(${siteIds})`),
      siteIds.length === 0
        ? Promise.resolve([{ c: 0 }])
        : db
            .select({ c: sql<number>`count(*)::int`.as("c") })
            .from(leadsTable)
            .where(sql`${leadsTable.siteId} = ANY(${siteIds})`),
      totalsByAsset(siteIds),
      siteIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(leadsTable)
            .where(sql`${leadsTable.siteId} = ANY(${siteIds})`)
            .orderBy(desc(leadsTable.createdAt))
            .limit(8),
    ]);

    res.json({
      totalSites: allSites.length,
      publishedSites: allSites.filter((s) => s.published).length,
      totalViews: viewsRow[0]?.c ?? 0,
      totalLeads: leadsRow[0]?.c ?? 0,
      totalPayments: totals.count,
      totalRevenueZbx: totals.zbx,
      totalRevenueZusd: totals.zusd,
      totalRevenueBnb: totals.bnb,
      recentSites: allSites.slice(0, 6).map(serializeSite),
      recentLeads: recentLeadsRows.map(serializeLead),
    });
  },
);

export default router;
