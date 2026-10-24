import {
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
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => user.id, {
      onDelete: "set null",
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
  (table) => [index("shopping_item_household_idx").on(table.householdId)],
);

export const shoppingPlan = pgTable("shopping_plan", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  id: uuid("id").notNull(),
  content: jsonb("content").$type<ShoppingPlan>().notNull(),
  sources: jsonb("sources")
    .$type<{ id: string; text: string }[]>()
    .notNull()
    .default([]),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
});
