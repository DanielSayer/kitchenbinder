import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import {
  collection,
  collectionRecipe,
  collectionShare,
} from "@prep-sheet/db/schema/collection";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  DrizzleQueryError,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { lockAccount } from "../billing/usage";
import {
  accessibleRecipe,
  lockHousehold,
  requireCollection,
  requireHousehold,
  visibleCollection,
} from "../households/access";
import { protectedProcedure, router } from "../index";

const collectionInput = z.object({ collectionId: z.uuid() });
const detailsInput = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500),
};
const recipeIdsInput = collectionInput.extend({
  recipeIds: z.array(z.uuid()).min(1).max(500),
});
const collectionLimit = 100;
const recipeLimit = 1000;

function handleNameConflict(error: unknown): never {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (
    cause instanceof Error &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === "collection_user_name_idx"
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "You already have a collection with that name.",
    });
  throw error;
}

// Entries the viewer can access; owners may keep recipes they can no longer see.
const recipeCountOf = (userId: string) => sql<number>`(
  select count(*)::int from ${collectionRecipe} join ${recipe} on ${recipe.id} = ${collectionRecipe.recipeId}
  where ${collectionRecipe.collectionId} = ${collection.id} and ${accessibleRecipe(userId)}
)`;
// All shares for the owner, otherwise only the viewer's households.
const sharedWithOf = (userId: string) => sql<
  { id: string; name: string; color: string }[]
>`coalesce((
  select json_agg(json_build_object('id', ${household.id}, 'name', ${household.name}, 'color', ${household.color}) order by ${household.createdAt}, ${household.id})
  from ${collectionShare} join ${household} on ${household.id} = ${collectionShare.householdId}
  where ${collectionShare.collectionId} = ${collection.id} and (${collection.userId} = ${userId} or exists (
    select 1 from ${householdMember}
    where ${householdMember.householdId} = ${household.id} and ${householdMember.userId} = ${userId}
  ))
), '[]'::json)`;

export async function listCollections(userId: string, id?: string) {
  const rows = await db
    .select({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      position: collection.position,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      ownerId: collection.userId,
      ownerName: user.name,
      isOwner: sql<boolean>`${collection.userId} = ${userId}`,
      recipeCount: recipeCountOf(userId),
      sharedWith: sharedWithOf(userId),
    })
    .from(collection)
    .innerJoin(user, eq(user.id, collection.userId))
    .where(
      and(visibleCollection(userId), id ? eq(collection.id, id) : undefined),
    )
    // Mine in my order, then shared collections by name.
    .orderBy(
      sql`${collection.userId} <> ${userId}`,
      sql`case when ${collection.userId} = ${userId} then ${collection.position} end`,
      sql`lower(${collection.name})`,
      asc(collection.id),
    );
  return rows.map(({ ownerId, ownerName, ...row }) => ({
    ...row,
    owner: { id: ownerId, name: ownerName },
  }));
}

export const collectionsRouter = router({
  // Mine plus collections shared with my households.
  list: protectedProcedure.query(({ ctx }) =>
    listCollections(ctx.session.user.id),
  ),
  get: protectedProcedure
    .input(collectionInput)
    .query(async ({ ctx, input }) => {
      const [found] = await listCollections(
        ctx.session.user.id,
        input.collectionId,
      );
      if (!found)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Collection not found or you no longer have access.",
        });
      return found;
    }),
  create: protectedProcedure
    .input(
      z.object({
        id: z.uuid().optional(),
        name: detailsInput.name,
        description: detailsInput.description.default(""),
      }),
    )
    .mutation(({ ctx, input }) =>
      db
        .transaction(async (tx) => {
          const userId = ctx.session.user.id;
          await lockAccount(tx, userId);
          const [existing] = await tx
            .select({
              total: count(),
              next: sql<number>`coalesce(max(${collection.position}) + 1, 0)`,
            })
            .from(collection)
            .where(eq(collection.userId, userId));
          if ((existing?.total ?? 0) >= collectionLimit)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `You can have up to ${collectionLimit} collections.`,
            });
          const [created] = await tx
            .insert(collection)
            .values({
              id: input.id ?? randomUUID(),
              userId,
              name: input.name,
              description: input.description,
              position: existing?.next ?? 0,
            })
            .returning();
          if (!created) throw new Error("Collection insert returned no row.");
          return created;
        })
        .catch(handleNameConflict),
    ),
  update: protectedProcedure
    .input(
      collectionInput.extend({
        name: detailsInput.name.optional(),
        description: detailsInput.description.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await db
        .update(collection)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(collection.id, input.collectionId),
            eq(collection.userId, ctx.session.user.id),
          ),
        )
        .returning()
        .catch(handleNameConflict);
      if (!updated[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Collection not found.",
        });
      return updated[0];
    }),
  // Deleting a collection never deletes its recipes.
  delete: protectedProcedure
    .input(collectionInput)
    .mutation(async ({ ctx, input }) => {
      const deleted = await db
        .delete(collection)
        .where(
          and(
            eq(collection.id, input.collectionId),
            eq(collection.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: collection.id });
      if (!deleted.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Collection not found.",
        });
      return { success: true };
    }),
  // Full order of my collections.
  reorder: protectedProcedure
    .input(z.object({ collectionIds: z.array(z.uuid()).max(collectionLimit) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await lockAccount(tx, userId);
        const mine = await tx
          .select({ id: collection.id })
          .from(collection)
          .where(eq(collection.userId, userId));
        const wanted = new Set(input.collectionIds);
        if (
          wanted.size !== input.collectionIds.length ||
          mine.length !== wanted.size ||
          mine.some((item) => !wanted.has(item.id))
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "Your collections changed. Refresh and try again.",
          });
        for (const [position, id] of input.collectionIds.entries())
          await tx
            .update(collection)
            .set({ position })
            .where(and(eq(collection.id, id), eq(collection.userId, userId)));
        return { success: true };
      }),
    ),
  // Appends recipes I can access, keeping existing entries where they are.
  addRecipes: protectedProcedure
    .input(recipeIdsInput)
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await requireCollection(tx, input.collectionId, userId, {
          ownerOnly: true,
          lock: true,
        });
        const ids = [...new Set(input.recipeIds)];
        const found = await tx
          .select({ id: recipe.id })
          .from(recipe)
          .where(and(inArray(recipe.id, ids), accessibleRecipe(userId)));
        if (found.length !== ids.length)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "A selected recipe is no longer available. Review your selection and try again.",
          });
        const existing = await tx
          .select({ recipeId: collectionRecipe.recipeId })
          .from(collectionRecipe)
          .where(eq(collectionRecipe.collectionId, input.collectionId));
        const present = new Set(existing.map((item) => item.recipeId));
        const additions = ids.filter((id) => !present.has(id));
        if (existing.length + additions.length > recipeLimit)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `A collection can hold up to ${recipeLimit} recipes.`,
          });
        if (additions.length) {
          const [last] = await tx
            .select({
              position: sql<number | null>`max(${collectionRecipe.position})`,
            })
            .from(collectionRecipe)
            .where(eq(collectionRecipe.collectionId, input.collectionId));
          const first = (last?.position ?? -1) + 1;
          await tx.insert(collectionRecipe).values(
            additions.map((recipeId, index) => ({
              collectionId: input.collectionId,
              recipeId,
              position: first + index,
            })),
          );
        }
        return { added: additions.length };
      }),
    ),
  removeRecipes: protectedProcedure
    .input(recipeIdsInput)
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await requireCollection(tx, input.collectionId, ctx.session.user.id, {
          ownerOnly: true,
          lock: true,
        });
        const removed = await tx
          .delete(collectionRecipe)
          .where(
            and(
              eq(collectionRecipe.collectionId, input.collectionId),
              inArray(collectionRecipe.recipeId, input.recipeIds),
            ),
          )
          .returning({ id: collectionRecipe.recipeId });
        return { removed: removed.length };
      }),
    ),
  // Moves the given recipes, in order, to the front; the rest keep their order.
  reorderRecipes: protectedProcedure
    .input(
      collectionInput.extend({
        recipeIds: z.array(z.uuid()).max(recipeLimit),
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await requireCollection(tx, input.collectionId, ctx.session.user.id, {
          ownerOnly: true,
          lock: true,
        });
        const entries = await tx
          .select({ recipeId: collectionRecipe.recipeId })
          .from(collectionRecipe)
          .where(eq(collectionRecipe.collectionId, input.collectionId))
          .orderBy(
            asc(collectionRecipe.position),
            asc(collectionRecipe.addedAt),
          );
        const present = new Set(entries.map((item) => item.recipeId));
        const wanted = [...new Set(input.recipeIds)];
        if (wanted.some((id) => !present.has(id)))
          throw new TRPCError({
            code: "CONFLICT",
            message: "This collection changed. Refresh and try again.",
          });
        const chosen = new Set(wanted);
        const order = [
          ...wanted,
          ...entries
            .map((item) => item.recipeId)
            .filter((id) => !chosen.has(id)),
        ];
        for (const [position, recipeId] of order.entries())
          await tx
            .update(collectionRecipe)
            .set({ position })
            .where(
              and(
                eq(collectionRecipe.collectionId, input.collectionId),
                eq(collectionRecipe.recipeId, recipeId),
              ),
            );
        return { success: true };
      }),
    ),
  share: protectedProcedure
    .input(collectionInput.extend({ householdId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await lockHousehold(tx, input.householdId);
        await requireHousehold(tx, input.householdId, userId, {
          allowPersonal: false,
        });
        await requireCollection(tx, input.collectionId, userId, {
          ownerOnly: true,
        });
        await tx
          .insert(collectionShare)
          .values({
            collectionId: input.collectionId,
            householdId: input.householdId,
          })
          .onConflictDoNothing();
        return { success: true };
      }),
    ),
  unshare: protectedProcedure
    .input(collectionInput.extend({ householdId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireCollection(db, input.collectionId, ctx.session.user.id, {
        ownerOnly: true,
      });
      await db
        .delete(collectionShare)
        .where(
          and(
            eq(collectionShare.collectionId, input.collectionId),
            eq(collectionShare.householdId, input.householdId),
          ),
        );
      return { success: true };
    }),
});
