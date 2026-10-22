import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import type { Meal, MealTrip } from "../meal-planner";
import { user } from "./auth";
import { household } from "./household";

export const mealPlanner = pgTable(
  "meal_planner",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    userId: text("user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .unique()
      .references(() => household.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(0),
    meals: jsonb("meals").$type<Meal[]>().notNull().default([]),
    trip: jsonb("trip").$type<MealTrip>(),
  },
  (table) => [
    check(
      "meal_planner_scope_check",
      sql`num_nonnulls(${table.userId}, ${table.householdId}) = 1`,
    ),
  ],
);
