import { sql } from "drizzle-orm";
import { check, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth";

// Personal app preferences. Missing row = defaults.
export const userPreference = pgTable(
  "user_preference",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    // 0 = Sunday ... 6 = Saturday, like Date#getDay.
    weekStartsOn: integer("week_starts_on").notNull().default(1),
  },
  (t) => [
    check(
      "user_preference_week_starts_on_check",
      sql`${t.weekStartsOn} between 0 and 6`,
    ),
  ],
);
