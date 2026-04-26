import {
  pgTable,
  serial,
  text,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const sitesTable = pgTable(
  "sites",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    subdomain: text("subdomain").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    blocks: jsonb("blocks").notNull().default([]),
    extraPages: jsonb("extra_pages").notNull().default([]),
    theme: jsonb("theme").notNull().default({}),
    seo: jsonb("seo").notNull().default({}),
    cryptoWallet: text("crypto_wallet"),
    published: boolean("published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    subdomainUnique: uniqueIndex("sites_subdomain_unique").on(t.subdomain),
    userIdx: index("sites_user_idx").on(t.userId),
  }),
);

export type Site = typeof sitesTable.$inferSelect;
export type NewSite = typeof sitesTable.$inferInsert;
