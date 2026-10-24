import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { RecipeContent } from "../recipe-content";
import { user } from "./auth";
import { household } from "./household";

export const recipe = pgTable(
  "recipe",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    content: jsonb("content").$type<RecipeContent>().notNull(),
    // Immutable identity of the original manual submission, including its destination.
    manualRequestHash: text("manual_request_hash"),
    revision: integer("revision").default(1).notNull(),
    sourceUrl: text("source_url"),
    origin: text("origin", {
      enum: ["imported", "generated", "manual"],
    }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("recipe_user_created_idx").on(table.userId, table.createdAt),
    index("recipe_deleted_expiry_idx").on(table.expiresAt),
    check(
      "recipe_deletion_dates_check",
      sql`(${table.deletedAt} is null and ${table.expiresAt} is null) or (${table.deletedAt} is not null and ${table.expiresAt} is not null and ${table.expiresAt} > ${table.deletedAt})`,
    ),
  ],
);

// Recipes are personal; sharing grants a household's members read access.
export const recipeShare = pgTable(
  "recipe_share",
  {
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.recipeId, table.householdId] }),
    index("recipe_share_household_idx").on(table.householdId),
  ],
);

export const recipeFavourite = pgTable(
  "recipe_favourite",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.recipeId] }),
    index("recipe_favourite_recipe_idx").on(table.recipeId),
  ],
);

export const recipeRating = pgTable(
  "recipe_rating",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.recipeId] }),
    index("recipe_rating_recipe_idx").on(table.recipeId),
    check("recipe_rating_value_check", sql`${table.rating} between 1 and 5`),
  ],
);

export const recipeCooking = pgTable(
  "recipe_cooking",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    cookedOn: date("cooked_on"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("recipe_cooking_user_recipe_idx").on(table.userId, table.recipeId),
  ],
);
