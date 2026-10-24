import { createHash } from "node:crypto";
import { db } from "@prep-sheet/db";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { user } from "@prep-sheet/db/schema/auth";
import { collection, collectionRecipe } from "@prep-sheet/db/schema/collection";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import {
  recipe,
  recipeCooking,
  recipeFavourite,
  recipeRating,
  recipeShare,
} from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  isNotNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { checkRecipeCapacity, lockAccount } from "../billing/usage";
import {
  accessibleRecipe,
  lockHousehold,
  ownedRecipe,
  requireHousehold,
} from "../households/access";
import { applyPlacement, preparePlacement } from "../households/placement";
import { websiteImportSchema } from "../import-contract";
import {
  discardWebsiteImport,
  importStatus,
  recentImports,
  submitWebsiteImport,
} from "../imports";
import { protectedProcedure, router } from "../index";
import {
  collectionInput,
  cookingSummary,
  favouriteOf,
  isOwnerOf,
  listRecipes,
  ratingOf,
  tagDetailsOf,
  taggingInput,
  taggingRecipePage,
  tagsOf,
} from "../recipes/list";
import { copyRecipeTags, setRecipeTags } from "../tags/recipes";

const idInput = z.object({ id: z.uuid() });
const placementInput = {
  // Share with this household on save. "Just me" means no share.
  householdId: z.uuid().nullable().optional(),
  // Add to this collection (owned by the caller) on save.
  collectionId: z.uuid().nullable().optional(),
};
const accessible = (id: string, userId: string) =>
  and(eq(recipe.id, id), accessibleRecipe(userId));
const owned = (id: string, userId: string) =>
  and(eq(recipe.id, id), ownedRecipe(userId));
const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Recipe not found." });
const ownerOnly = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Only the recipe's owner can do this.",
  });

// Households the recipe is shared with: all for the owner, otherwise the viewer's.
const sharedWithOf = (userId: string) => sql<
  { id: string; name: string; color: string; personal: boolean }[]
>`coalesce((
  select json_agg(json_build_object('id', ${household.id}, 'name', ${household.name}, 'color', ${household.color}, 'personal', ${household.personal}) order by ${household.createdAt}, ${household.id})
  from ${recipeShare} join ${household} on ${household.id} = ${recipeShare.householdId}
  where ${recipeShare.recipeId} = ${recipe.id} and (${recipe.userId} = ${userId} or exists (
    select 1 from ${householdMember}
    where ${householdMember.householdId} = ${household.id} and ${householdMember.userId} = ${userId}
  ))
), '[]'::json)`;
// The viewer's own collections containing this recipe.
const collectionIdsOf = (userId: string) => sql<string[]>`coalesce((
  select json_agg(${collectionRecipe.collectionId})
  from ${collectionRecipe} join ${collection} on ${collection.id} = ${collectionRecipe.collectionId}
  where ${collectionRecipe.recipeId} = ${recipe.id} and ${collection.userId} = ${userId}
), '[]'::json)`;

export async function getRecipe(id: string, userId: string) {
  const [result] = await db
    .select({
      ...getTableColumns(recipe),
      ownerName: user.name,
      isOwner: isOwnerOf(userId),
      sharedWith: sharedWithOf(userId),
      collectionIds: collectionIdsOf(userId),
      isFavourite: favouriteOf(userId),
      rating: ratingOf(userId),
      ...cookingSummary(userId),
      tagIds: tagsOf(),
      tags: tagDetailsOf(),
    })
    .from(recipe)
    .leftJoin(user, eq(user.id, recipe.userId))
    .where(accessible(id, userId));
  if (!result) throw missing();
  const { ownerName, ...rest } = result;
  return {
    ...rest,
    owner:
      result.userId && ownerName !== null
        ? { id: result.userId, name: ownerName }
        : null,
  };
}

async function requireOwnedRecipe(id: string, userId: string) {
  const saved = await getRecipe(id, userId);
  if (!saved.isOwner) throw ownerOnly();
  return saved;
}

export const recipesRouter = router({
  // The caller's own recipes in their 30-day recovery period.
  recentlyDeleted: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    return db
      .select({
        id: recipe.id,
        title: recipe.title,
        deletedAt: recipe.deletedAt,
        expiresAt: recipe.expiresAt,
        deletedByName: user.name,
      })
      .from(recipe)
      .leftJoin(user, eq(user.id, recipe.deletedBy))
      .where(
        and(
          eq(recipe.userId, userId),
          isNotNull(recipe.deletedAt),
          gt(recipe.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(recipe.deletedAt), asc(recipe.id));
  }),
  restore: protectedProcedure.input(idInput).mutation(async ({ input, ctx }) =>
    db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ userId: recipe.userId })
        .from(recipe)
        .where(
          and(
            eq(recipe.id, input.id),
            eq(recipe.userId, ctx.session.user.id),
            isNotNull(recipe.deletedAt),
          ),
        );
      if (!candidate) throw missing();
      if (candidate.userId) await checkRecipeCapacity(tx, candidate.userId);
      const [restored] = await tx
        .update(recipe)
        .set({ deletedAt: null, deletedBy: null, expiresAt: null })
        .where(
          and(
            eq(recipe.id, input.id),
            eq(recipe.userId, ctx.session.user.id),
            isNotNull(recipe.deletedAt),
            gt(recipe.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: recipe.id });
      if (!restored)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "This recipe is no longer available to restore. Refresh Recently deleted.",
        });
      return restored;
    }),
  ),
  cookingHistory: protectedProcedure
    .input(idInput)
    .query(async ({ input, ctx }) => {
      await getRecipe(input.id, ctx.session.user.id);
      return db
        .select({
          id: recipeCooking.id,
          cookedOn: recipeCooking.cookedOn,
          note: recipeCooking.note,
        })
        .from(recipeCooking)
        .where(
          and(
            eq(recipeCooking.recipeId, input.id),
            eq(recipeCooking.userId, ctx.session.user.id),
          ),
        )
        .orderBy(
          sql`${recipeCooking.cookedOn} desc nulls last`,
          desc(recipeCooking.createdAt),
          desc(recipeCooking.id),
        );
    }),
  saveCooking: protectedProcedure
    .input(
      idInput.extend({
        entryId: z.uuid(),
        cookedOn: z.iso.date().nullable(),
        note: z.string().trim().max(5000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await getRecipe(input.id, userId);
      const [saved] = await db
        .insert(recipeCooking)
        .values({
          id: input.entryId,
          recipeId: input.id,
          userId,
          cookedOn: input.cookedOn,
          note: input.note,
        })
        .onConflictDoUpdate({
          target: recipeCooking.id,
          set: { cookedOn: input.cookedOn, note: input.note },
          setWhere: and(
            eq(recipeCooking.userId, userId),
            eq(recipeCooking.recipeId, input.id),
          ),
        })
        .returning({ id: recipeCooking.id });
      if (!saved) throw missing();
      return saved;
    }),
  deleteCooking: protectedProcedure
    .input(idInput.extend({ entryId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      await getRecipe(input.id, ctx.session.user.id);
      await db
        .delete(recipeCooking)
        .where(
          and(
            eq(recipeCooking.id, input.entryId),
            eq(recipeCooking.recipeId, input.id),
            eq(recipeCooking.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),
  list: protectedProcedure
    .input(collectionInput)
    .query(({ ctx, input }) => listRecipes(ctx.session.user.id, input)),
  taggingList: protectedProcedure
    .input(taggingInput)
    .query(({ ctx, input }) => taggingRecipePage(ctx.session.user.id, input)),
  get: protectedProcedure
    .input(idInput)
    .query(({ input, ctx }) => getRecipe(input.id, ctx.session.user.id)),
  setTag: protectedProcedure
    .input(idInput.extend({ tagId: z.uuid(), selected: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await db.transaction((tx) =>
        setRecipeTags(tx, userId, [input.id], [input.tagId], input.selected),
      );
      return { success: true };
    }),
  setTags: protectedProcedure
    .input(
      z.object({
        recipeIds: z.array(z.uuid()).min(1).max(100),
        tagIds: z.array(z.uuid()).min(1).max(105),
        operation: z.enum(["add", "remove"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const recipeIds = [...new Set(input.recipeIds)];
      const tagIds = [...new Set(input.tagIds)];
      await db.transaction((tx) =>
        setRecipeTags(tx, userId, recipeIds, tagIds, input.operation === "add"),
      );
      return {
        success: true,
        recipeCount: recipeIds.length,
        tagCount: tagIds.length,
      };
    }),
  setFavourite: protectedProcedure
    .input(idInput.extend({ isFavourite: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await getRecipe(input.id, userId);
      if (input.isFavourite) {
        await db
          .insert(recipeFavourite)
          .values({ userId, recipeId: input.id })
          .onConflictDoNothing();
      } else {
        await db
          .delete(recipeFavourite)
          .where(
            and(
              eq(recipeFavourite.userId, userId),
              eq(recipeFavourite.recipeId, input.id),
            ),
          );
      }
      return { id: input.id, isFavourite: input.isFavourite };
    }),
  setRating: protectedProcedure
    .input(
      idInput.extend({ rating: z.number().int().min(1).max(5).nullable() }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await getRecipe(input.id, userId);
      if (input.rating === null) {
        await db
          .delete(recipeRating)
          .where(
            and(
              eq(recipeRating.userId, userId),
              eq(recipeRating.recipeId, input.id),
            ),
          );
      } else {
        await db
          .insert(recipeRating)
          .values({ userId, recipeId: input.id, rating: input.rating })
          .onConflictDoUpdate({
            target: [recipeRating.userId, recipeRating.recipeId],
            set: { rating: input.rating },
          });
      }
      return { id: input.id, rating: input.rating };
    }),
  create: protectedProcedure
    .input(websiteImportSchema)
    .mutation(({ input, ctx }) =>
      submitWebsiteImport(ctx.session.user.id, input),
    ),
  recentImports: protectedProcedure
    .input(z.object({ accountId: z.string() }))
    .query(({ ctx, input }) => {
      if (input.accountId !== ctx.session.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return recentImports(ctx.session.user.id);
    }),
  importStatus: protectedProcedure
    .input(idInput)
    .query(({ input, ctx }) => importStatus(ctx.session.user.id, input.id)),
  discardImport: protectedProcedure
    .input(websiteImportSchema)
    .mutation(({ input, ctx }) =>
      discardWebsiteImport(ctx.session.user.id, input),
    ),
  share: protectedProcedure
    .input(idInput.extend({ householdId: z.uuid() }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await lockHousehold(tx, input.householdId);
        await requireHousehold(tx, input.householdId, userId, {
          allowPersonal: false,
        });
        const [found] = await tx
          .select({ id: recipe.id })
          .from(recipe)
          .where(owned(input.id, userId));
        if (!found) throw missing();
        await tx
          .insert(recipeShare)
          .values({ recipeId: input.id, householdId: input.householdId })
          .onConflictDoNothing();
        return { success: true };
      }),
    ),
  unshare: protectedProcedure
    .input(idInput.extend({ householdId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [found] = await db
        .select({ id: recipe.id })
        .from(recipe)
        .where(
          and(eq(recipe.id, input.id), eq(recipe.userId, ctx.session.user.id)),
        );
      if (!found) throw missing();
      await db
        .delete(recipeShare)
        .where(
          and(
            eq(recipeShare.recipeId, input.id),
            eq(recipeShare.householdId, input.householdId),
          ),
        );
      return { success: true };
    }),
  createManual: protectedProcedure
    .input(
      idInput.extend({
        content: recipeContentSchema,
        ...placementInput,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const placement = {
        householdId: input.householdId ?? null,
        collectionId: input.collectionId ?? null,
      };
      // "groupId" keeps identities of saves submitted before households stable.
      const manualRequestHash = createHash("sha256")
        .update(
          JSON.stringify({
            groupId: placement.householdId,
            ...(placement.collectionId
              ? { collectionId: placement.collectionId }
              : {}),
            content: input.content,
          }),
        )
        .digest("hex");
      await db.transaction(async (tx) => {
        await lockAccount(tx, userId);
        const [existing] = await tx
          .select({
            id: recipe.id,
            userId: recipe.userId,
            manualRequestHash: recipe.manualRequestHash,
          })
          .from(recipe)
          .where(eq(recipe.id, input.id));
        if (existing && existing.userId !== userId) throw missing();
        if (existing && existing.manualRequestHash !== manualRequestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This save ID belongs to an earlier submission. Recover that save before applying your changes. Your draft has not been saved.",
          });
        if (existing) return;
        await checkRecipeCapacity(tx, userId);
        const prepared = await preparePlacement(tx, userId, placement);
        const inserted = await tx
          .insert(recipe)
          .values({
            id: input.id,
            userId,
            title: input.content.title,
            content: input.content,
            manualRequestHash,
            origin: "manual",
            sourceUrl: null,
          })
          .onConflictDoNothing()
          .returning({ id: recipe.id });
        if (inserted.length) await applyPlacement(tx, input.id, prepared);
      });
      const saved = await getRecipe(input.id, userId);
      if (
        saved.userId !== userId ||
        saved.manualRequestHash !== manualRequestHash ||
        saved.origin !== "manual"
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "This recipe ID has already been used. Start a new recipe.",
        });
      return saved;
    }),
  copy: protectedProcedure
    .input(idInput.extend({ newId: z.uuid(), ...placementInput }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await checkRecipeCapacity(tx, userId);
        const prepared = await preparePlacement(tx, userId, {
          householdId: input.householdId ?? null,
          collectionId: input.collectionId ?? null,
        });
        const [source] = await tx
          .select()
          .from(recipe)
          .where(accessible(input.id, userId));
        if (!source) throw missing();
        const [saved] = await tx
          .insert(recipe)
          .values({
            id: input.newId,
            userId,
            title: source.title,
            content: source.content,
            sourceUrl: source.sourceUrl,
            origin: source.origin,
          })
          .onConflictDoNothing()
          .returning({ id: recipe.id });
        if (!saved)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This copy has already been saved. Refresh your collection.",
          });
        await copyRecipeTags(tx, userId, input.id, saved.id);
        await applyPlacement(tx, saved.id, prepared);
        return saved;
      }),
    ),
  update: protectedProcedure
    .input(
      idInput.extend({
        content: recipeContentSchema,
        expectedRevision: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db
        .update(recipe)
        .set({
          title: input.content.title,
          content: input.content,
          updatedAt: new Date(),
          revision: sql`${recipe.revision} + 1`,
        })
        .where(
          and(
            owned(input.id, ctx.session.user.id),
            eq(recipe.revision, input.expectedRevision),
          ),
        )
        .returning();
      if (!result) {
        await requireOwnedRecipe(input.id, ctx.session.user.id);
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This recipe changed since you started editing. Your draft has been kept. Compare changes or reload the saved recipe.",
        });
      }
      return result;
    }),
  delete: protectedProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    const deleted = await db
      .update(recipe)
      .set({
        deletedAt: sql`now()`,
        deletedBy: ctx.session.user.id,
        expiresAt: sql`now() + interval '30 days'`,
      })
      .where(owned(input.id, ctx.session.user.id))
      .returning({ id: recipe.id });
    if (!deleted.length) {
      await requireOwnedRecipe(input.id, ctx.session.user.id);
      throw missing();
    }
    return { success: true };
  }),
});
