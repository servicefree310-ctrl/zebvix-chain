import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const sitePaymentsTable = pgTable(
  "site_payments",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id").notNull(),
    txHash: text("tx_hash").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    asset: text("asset").notNull(), // zbx | zusd | bnb
    amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
    chainId: integer("chain_id").notNull(),
    status: text("status").notNull().default("pending"), // pending | confirmed | failed
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    siteIdx: index("site_payments_site_idx").on(t.siteId),
    txUnique: uniqueIndex("site_payments_tx_unique").on(t.chainId, t.txHash),
  }),
);

export type SitePayment = typeof sitePaymentsTable.$inferSelect;
export type NewSitePayment = typeof sitePaymentsTable.$inferInsert;
