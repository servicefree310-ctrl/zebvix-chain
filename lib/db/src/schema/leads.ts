import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const leadsTable = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id").notNull(),
    email: text("email"),
    walletAddress: text("wallet_address"),
    fields: jsonb("fields").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    siteIdx: index("leads_site_idx").on(t.siteId),
  }),
);

export type Lead = typeof leadsTable.$inferSelect;
export type NewLead = typeof leadsTable.$inferInsert;
