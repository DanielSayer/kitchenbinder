import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const household = pgTable("household", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The primary key enforces one household per account, including competing invitations.
export const householdMember = pgTable(
  "household_member",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("household_member_household_idx").on(table.householdId)],
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
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [index("household_invite_household_idx").on(table.householdId)],
);
