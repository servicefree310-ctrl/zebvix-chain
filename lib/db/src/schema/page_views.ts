import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const pageViewsTable = pgTable(
  "page_views",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id").notNull(),
    path: text("path").notNull().default("/"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    siteIdx: index("page_views_site_idx").on(t.siteId),
    siteCreatedIdx: index("page_views_site_created_idx").on(
      t.siteId,
      t.createdAt,
    ),
  }),
);

export type PageView = typeof pageViewsTable.$inferSelect;
export type NewPageView = typeof pageViewsTable.$inferInsert;
