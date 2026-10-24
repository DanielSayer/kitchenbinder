import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const householdColors = [
  "tomato",
  "olive",
  "butter",
  "plum",
  "sage",
] as const;
export type HouseholdColor = (typeof householdColors)[number];

export const household = pgTable(
  "household",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // Every user owns exactly one personal "Just me" household.
    personal: boolean("personal").default(false).notNull(),
    color: text("color", { enum: householdColors }).default("sage").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("household_personal_owner_idx")
      .on(table.ownerId)
      .where(sql`${table.personal}`),
    check(
      "household_color_check",
      sql`${table.color} in ('tomato', 'olive', 'butter', 'plum', 'sage')`,
    ),
  ],
);

export const householdMember = pgTable(
  "household_member",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.userId] }),
    index("household_member_user_idx").on(table.userId),
  ],
);

export const householdInvite = pgTable(
  "household_invite",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [index("household_invite_household_idx").on(table.householdId)],
);
