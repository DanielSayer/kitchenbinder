import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { RecipeContent } from "../recipe-content";
import { user } from "./auth";

export const recipeImport = pgTable(
  "recipe_import",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Keep destinations if a household or collection is deleted. Never silently
    // save without the requested share/collection placement.
    householdId: uuid("household_id"),
    collectionId: uuid("collection_id"),
    fingerprint: text("fingerprint").notNull(),
    input: text("input").notNull(),
    sourceUrl: text("source_url"),
    sourceKind: text("source_kind", { enum: ["captured", "website"] })
      .notNull()
      .default("captured"),
    usageReleased: boolean("usage_released").notNull().default(false),
    usageBucket: text("usage_bucket", { enum: ["free", "trial", "pro"] })
      .notNull()
      .default("free"),
    state: text("state", {
      enum: ["queued", "fetching", "processing", "ready", "saved", "failed"],
    })
      .notNull()
      .default("queued"),
    generated: jsonb("generated").$type<{
      content: RecipeContent;
      tagIds: string[];
      origin?: "imported" | "generated";
    }>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    workerToken: uuid("worker_token"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    saveAttempts: integer("save_attempts").notNull().default(0),
    nextSaveAttemptAt: timestamp("next_save_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    saveClaimedAt: timestamp("save_claimed_at", { withTimezone: true }),
  },
  (t) => [
    index("recipe_import_queue_idx").on(t.state, t.createdAt),
    index("recipe_import_user_idx").on(t.userId, t.createdAt),
    index("recipe_import_save_retry_idx").on(t.state, t.nextSaveAttemptAt),
  ],
);

export const extensionRate = pgTable("extension_rate", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  window: timestamp("window", { withTimezone: true }).notNull(),
  requests: integer("requests").notNull(),
});
