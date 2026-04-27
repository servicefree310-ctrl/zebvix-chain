import {
  pgTable,
  serial,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const adminSettingsTable = pgTable(
  "admin_settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type AdminSetting = typeof adminSettingsTable.$inferSelect;
export type NewAdminSetting = typeof adminSettingsTable.$inferInsert;

export const adminNavItemsTable = pgTable(
  "admin_nav_items",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    section: text("section").notNull(),
    label: text("label").notNull(),
    href: text("href").notNull(),
    iconName: text("icon_name").notNull().default("Link"),
    badge: text("badge"),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    isCustom: boolean("is_custom").notNull().default(false),
    openInNewTab: boolean("open_in_new_tab").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("admin_nav_items_slug_unique").on(t.slug),
    sectionIdx: index("admin_nav_items_section_idx").on(t.section),
  }),
);

export type AdminNavItem = typeof adminNavItemsTable.$inferSelect;
export type NewAdminNavItem = typeof adminNavItemsTable.$inferInsert;
