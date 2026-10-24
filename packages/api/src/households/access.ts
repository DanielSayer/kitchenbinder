import { db } from "@prep-sheet/db";
import { ensurePersonalHousehold } from "@prep-sheet/db/households";
import {
  collection,
  collectionRecipe,
  collectionShare,
} from "@prep-sheet/db/schema/collection";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { recipe, recipeShare } from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import { and, eq, exists, isNull, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type Database =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const memberOf = (householdId: AnyPgColumn | SQL, userId: string) =>
  exists(
    db
      .select({ id: householdMember.userId })
      .from(householdMember)
      .where(
        and(
          eq(householdMember.householdId, householdId),
          eq(householdMember.userId, userId),
        ),
      ),
  );

const sharedWithMember = (userId: string) =>
  exists(
    db
      .select({ id: recipeShare.recipeId })
      .from(recipeShare)
      .innerJoin(
        householdMember,
        eq(householdMember.householdId, recipeShare.householdId),
      )
      .where(
        and(
          eq(recipeShare.recipeId, recipe.id),
          eq(householdMember.userId, userId),
        ),
      ),
  );

// Only the collection owner's own recipes travel through a shared collection.
const inSharedCollection = (userId: string) =>
  exists(
    db
      .select({ id: collectionRecipe.recipeId })
      .from(collectionRecipe)
      .innerJoin(collection, eq(collection.id, collectionRecipe.collectionId))
      .innerJoin(
        collectionShare,
        eq(collectionShare.collectionId, collection.id),
      )
      .innerJoin(
        householdMember,
        eq(householdMember.householdId, collectionShare.householdId),
      )
      .where(
        and(
          eq(collectionRecipe.recipeId, recipe.id),
          eq(collection.userId, recipe.userId),
          eq(householdMember.userId, userId),
        ),
      ),
  );

// The three recipe access rules from docs/households.md, ignoring deletion.
export const recipePermission = (userId: string) =>
  or(
    eq(recipe.userId, userId),
    sharedWithMember(userId),
    inSharedCollection(userId),
  );

export const accessibleRecipe = (userId: string) =>
  and(isNull(recipe.deletedAt), recipePermission(userId));

// Only the owner edits, deletes, tags or shares a recipe.
export const ownedRecipe = (userId: string) =>
  and(isNull(recipe.deletedAt), eq(recipe.userId, userId));

export const visibleCollection = (userId: string) =>
  or(
    eq(collection.userId, userId),
    exists(
      db
        .select({ id: collectionShare.householdId })
        .from(collectionShare)
        .innerJoin(
          householdMember,
          eq(householdMember.householdId, collectionShare.householdId),
        )
        .where(
          and(
            eq(collectionShare.collectionId, collection.id),
            eq(householdMember.userId, userId),
          ),
        ),
    ),
  );

export async function requireHousehold(
  database: Database,
  id: string,
  userId: string,
  { ownerOnly = false, allowPersonal = true } = {},
) {
  const [result] = await database
    .select()
    .from(household)
    .innerJoin(householdMember, eq(householdMember.householdId, household.id))
    .where(and(eq(household.id, id), eq(householdMember.userId, userId)));
  if (!result)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Household not found or you no longer have access.",
    });
  if (!allowPersonal && result.household.personal)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Just me is your personal household and can't be changed.",
    });
  if (ownerOnly && result.household.ownerId !== userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the household owner can do this.",
    });
  return result.household;
}

// Serialize membership changes, invites, plan and list writes for this household.
export async function lockHousehold(database: Database, id: string) {
  await database
    .select({ id: household.id })
    .from(household)
    .where(eq(household.id, id))
    .for("update");
}

// Omitted household means the caller's personal household.
export async function resolveHousehold(
  database: Database,
  userId: string,
  householdId: string | undefined,
  { lock = false } = {},
) {
  const id = householdId ?? (await ensurePersonalHousehold(database, userId));
  if (lock) await lockHousehold(database, id);
  await requireHousehold(database, id, userId);
  return id;
}

export async function requireCollection(
  database: Database,
  id: string,
  userId: string,
  { ownerOnly = false, lock = false } = {},
) {
  const query = database
    .select()
    .from(collection)
    .where(
      and(
        eq(collection.id, id),
        ownerOnly ? eq(collection.userId, userId) : visibleCollection(userId),
      ),
    );
  const [found] = lock ? await query.for("update") : await query;
  if (!found)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Collection not found or you no longer have access.",
    });
  return found;
}

export const nextCollectionPosition = (collectionId: string) =>
  sql<number>`(select coalesce(max(${collectionRecipe.position}) + 1, 0) from ${collectionRecipe} where ${collectionRecipe.collectionId} = ${collectionId})`;

// Recipes whose owner deleted their account survive only while shared somewhere.
export async function deleteOrphanedRecipes(tx: Database, householdId: string) {
  await tx.execute(sql`
    delete from recipe r where r.user_id is null
      and exists (select 1 from recipe_share s where s.recipe_id = r.id and s.household_id = ${householdId})
      and not exists (select 1 from recipe_share s where s.recipe_id = r.id and s.household_id <> ${householdId})`);
}
