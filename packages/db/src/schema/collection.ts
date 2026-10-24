import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { household } from "./household";
import { recipe } from "./recipe";

// A personal, ordered recipe grouping, shared with households via collection_share.
export const collection = pgTable(
  "collection",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("collection_user_position_idx").on(t.userId, t.position),
    uniqueIndex("collection_user_name_idx").on(t.userId, sql`lower(${t.name})`),
  ],
);

export const collectionRecipe = pgTable(
  "collection_recipe",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.recipeId] }),
    index("collection_recipe_recipe_idx").on(t.recipeId),
    index("collection_recipe_position_idx").on(t.collectionId, t.position),
  ],
);

export const collectionShare = pgTable(
  "collection_share",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.householdId] }),
    index("collection_share_household_idx").on(t.householdId),
  ],
);
