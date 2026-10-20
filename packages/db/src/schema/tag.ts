import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { group } from "./group";
import { recipe } from "./recipe";

export const tag = pgTable(
  "tag",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => group.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
  },
  (t) => [
    uniqueIndex("tag_user_name_idx").on(t.userId, sql`lower(${t.name})`),
    uniqueIndex("tag_group_name_idx").on(t.groupId, sql`lower(${t.name})`),
    check("tag_scope_check", sql`${t.userId} is null or ${t.groupId} is null`),
  ],
);

export const recipeTag = pgTable(
  "recipe_tag",
  {
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.tagId] }),
    index("recipe_tag_tag_idx").on(t.tagId),
    index("recipe_tag_recipe_idx").on(t.recipeId),
  ],
);
