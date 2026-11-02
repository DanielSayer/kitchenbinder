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
    // "metric" or "imperial" (US customary).
    unitSystem: text("unit_system").notNull().default("metric"),
    // Cup and spoon sizes: "au" (250 ml cup) or "us" (240 ml cup).
    measureStandard: text("measure_standard").notNull().default("au"),
  },
  (t) => [
    check(
      "user_preference_week_starts_on_check",
      sql`${t.weekStartsOn} between 0 and 6`,
    ),
    check(
      "user_preference_unit_system_check",
      sql`${t.unitSystem} in ('metric', 'imperial')`,
    ),
    check(
      "user_preference_measure_standard_check",
      sql`${t.measureStandard} in ('au', 'us')`,
    ),
  ],
);
