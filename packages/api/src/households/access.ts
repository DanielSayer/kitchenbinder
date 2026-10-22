import { db } from "@prep-sheet/db";
import type { PlanningScope } from "@prep-sheet/db/planning-scope";
import { user } from "@prep-sheet/db/schema/auth";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../groups/access";

export type PlanningOwner =
  | { kind: "personal"; userId: string; householdId: null }
  | { kind: "household"; userId: null; householdId: string };

export function scopeOwner(
  scope: PlanningScope,
  userId: string,
): PlanningOwner {
  return scope.kind === "personal"
    ? { kind: "personal", userId, householdId: null }
    : { kind: "household", userId: null, householdId: scope.householdId };
}
export function ownerColumns(owner: PlanningOwner) {
  return { userId: owner.userId, householdId: owner.householdId };
}
export function scopeFilter(
  table: { userId: AnyPgColumn; householdId: AnyPgColumn },
  owner: PlanningOwner,
) {
  return owner.kind === "personal"
    ? eq(table.userId, owner.userId)
    : eq(table.householdId, owner.householdId);
}
export function scopeTarget<
  Table extends { userId: AnyPgColumn; householdId: AnyPgColumn },
>(table: Table, owner: { householdId: string | null }) {
  return owner.householdId === null ? table.userId : table.householdId;
}
export async function lockAccount(tx: Database, userId: string) {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update");
}
export async function lockHousehold(tx: Database, id: string) {
  await tx
    .select({ id: household.id })
    .from(household)
    .where(eq(household.id, id))
    .for("update");
}
export async function requireHousehold(
  tx: Database,
  id: string,
  userId: string,
  ownerOnly = false,
) {
  const [found] = await tx
    .select({ household })
    .from(household)
    .innerJoin(householdMember, eq(householdMember.householdId, household.id))
    .where(and(eq(household.id, id), eq(householdMember.userId, userId)));
  if (!found)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "This household is no longer available to you. Switch to Personal to continue.",
    });
  if (ownerOnly && found.household.ownerId !== userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the household owner can do this.",
    });
  return found.household;
}

// Membership changes and all shared reads/writes use the same lock. A removed
// member cannot pass a stale membership check while a change is in flight.
export function withPlanningScope<T>(
  userId: string,
  scope: PlanningScope,
  action: (tx: Database, owner: PlanningOwner) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    if (scope.kind === "household") {
      await lockHousehold(tx, scope.householdId);
      await requireHousehold(tx, scope.householdId, userId);
    } else await lockAccount(tx, userId);
    return action(tx, scopeOwner(scope, userId));
  });
}
