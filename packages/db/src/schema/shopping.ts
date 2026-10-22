import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ShoppingPlan } from "../shopping-plan";
import { user } from "./auth";
import { household } from "./household";

export const shoppingItem = pgTable(
  "shopping_item",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    householdId: uuid("household_id").references(() => household.id, {
      onDelete: "cascade",
    }),
    text: text("text").notNull(),
    status: text("status", { enum: ["needed", "bought", "owned"] })
      .notNull()
      .default("needed"),
    // Keep attribution even if the source recipe is deleted.
    recipeId: uuid("recipe_id"),
    recipeTitle: text("recipe_title"),
    servings: text("servings"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("shopping_item_user_idx").on(table.userId),
    index("shopping_item_household_idx").on(table.householdId),
    check(
      "shopping_item_scope_check",
      sql`num_nonnulls(${table.userId}, ${table.householdId}) = 1`,
    ),
  ],
);

export const shoppingPlan = pgTable(
  "shopping_plan",
  {
    userId: text("user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .unique()
      .references(() => household.id, { onDelete: "cascade" }),
    id: uuid("id").primaryKey(),
    content: jsonb("content").$type<ShoppingPlan>().notNull(),
    sources: jsonb("sources")
      .$type<{ id: string; text: string }[]>()
      .notNull()
      .default([]),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "shopping_plan_scope_check",
      sql`num_nonnulls(${table.userId}, ${table.householdId}) = 1`,
    ),
  ],
);
