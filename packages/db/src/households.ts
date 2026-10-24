import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { household, householdMember } from "./schema/household";

// biome-ignore lint/suspicious/noExplicitAny: accepts the database or any transaction.
type Database = PgDatabase<PgQueryResultHKT, any, any>;

export const personalHouseholdName = "Just me";

// Idempotent: every user owns exactly one personal household and is its member.
export async function ensurePersonalHousehold(
  database: Database,
  userId: string,
): Promise<string> {
  const find = async () => {
    const [found] = await database
      .select({ id: household.id, member: householdMember.userId })
      .from(household)
      .leftJoin(
        householdMember,
        and(
          eq(householdMember.householdId, household.id),
          eq(householdMember.userId, userId),
        ),
      )
      .where(and(eq(household.ownerId, userId), eq(household.personal, true)));
    return found;
  };
  const existing = await find();
  if (existing?.member) return existing.id;
  let id = existing?.id;
  if (!id) {
    await database
      .insert(household)
      .values({
        id: randomUUID(),
        name: personalHouseholdName,
        ownerId: userId,
        personal: true,
        color: "sage",
      })
      .onConflictDoNothing({
        target: household.ownerId,
        where: sql`${household.personal}`,
      });
    id = (await find())?.id;
    if (!id) throw new Error("Personal household could not be created.");
  }
  await database
    .insert(householdMember)
    .values({ householdId: id, userId })
    .onConflictDoNothing();
  return id;
}
