import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const authRateLimit = pgTable(
  "auth_rate_limit",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("auth_rate_limit_expiry_idx").on(table.expiresAt)],
);
