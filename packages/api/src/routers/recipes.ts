import { createHash } from "node:crypto";
import { db } from "@prep-sheet/db";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { user } from "@prep-sheet/db/schema/auth";
import {
  recipe,
  recipeCooking,
  recipeFavourite,
  recipeRating,
} from "@prep-sheet/db/schema/recipe";
import { recipeTag, tag } from "@prep-sheet/db/schema/tag";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { checkRecipeCapacity, lockAccount } from "../billing/usage";
import {
  accessibleRecipe,
  lockGroup,
  recipePermission,
  requireGroup,
} from "../groups/access";
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
  listRecipes,
  ratingOf,
  taggingInput,
  taggingRecipePage,
  tagsOf,
} from "../recipes/list";

const idInput = z.object({ id: z.uuid() });
const owned = (id: string, userId: string) =>
  and(eq(recipe.id, id), accessibleRecipe(userId));
const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Recipe not found." });

export async function getRecipe(id: string, userId: string) {
  const [result] = await db
    .select({
      ...getTableColumns(recipe),
      isFavourite: favouriteOf(userId),
      rating: ratingOf(userId),
      ...cookingSummary(userId),
      tagIds: tagsOf(userId),
    })
    .from(recipe)
    .where(owned(id, userId));
  if (!result) throw missing();
  return result;
}

export const recipesRouter = router({
  recentlyDeleted: protectedProcedure
    .input(z.object({ groupId: z.uuid().nullable() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      if (input.groupId) await requireGroup(db, input.groupId, userId);
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
            recipePermission(userId),
            input.groupId
              ? eq(recipe.groupId, input.groupId)
              : isNull(recipe.groupId),
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
            recipePermission(ctx.session.user.id),
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
            recipePermission(ctx.session.user.id),
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
      await getRecipe(input.id, userId);
      const [available] = await db
        .select()
        .from(tag)
        .where(
          and(
            eq(tag.id, input.tagId),
            or(isNull(tag.userId), eq(tag.userId, userId)),
          ),
        );
      if (!available)
        throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found." });
      if (input.selected)
        await db
          .insert(recipeTag)
          .values({ userId, recipeId: input.id, tagId: input.tagId })
          .onConflictDoNothing();
      else
        await db
          .delete(recipeTag)
          .where(
            and(
              eq(recipeTag.userId, userId),
              eq(recipeTag.recipeId, input.id),
              eq(recipeTag.tagId, input.tagId),
            ),
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
      const [recipes, tags] = await Promise.all([
        db
          .select({ id: recipe.id })
          .from(recipe)
          .where(and(inArray(recipe.id, recipeIds), accessibleRecipe(userId))),
        db
          .select({ id: tag.id })
          .from(tag)
          .where(
            and(
              inArray(tag.id, tagIds),
              or(isNull(tag.userId), eq(tag.userId, userId)),
            ),
          ),
      ]);
      if (recipes.length !== recipeIds.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more recipes could not be found.",
        });
      if (tags.length !== tagIds.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more tags could not be found.",
        });

      if (input.operation === "add") {
        await db
          .insert(recipeTag)
          .values(
            recipeIds.flatMap((recipeId) =>
              tagIds.map((tagId) => ({ userId, recipeId, tagId })),
            ),
          )
          .onConflictDoNothing();
      } else {
        await db
          .delete(recipeTag)
          .where(
            and(
              eq(recipeTag.userId, userId),
              inArray(recipeTag.recipeId, recipeIds),
              inArray(recipeTag.tagId, tagIds),
            ),
          );
      }
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
  createManual: protectedProcedure
    .input(
      idInput.extend({
        content: recipeContentSchema,
        groupId: z.uuid().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const manualRequestHash = createHash("sha256")
        .update(
          JSON.stringify({ groupId: input.groupId, content: input.content }),
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
        if (input.groupId) {
          await lockGroup(tx, input.groupId);
          await requireGroup(tx, input.groupId, userId);
        }
        await tx
          .insert(recipe)
          .values({
            id: input.id,
            userId,
            groupId: input.groupId,
            title: input.content.title,
            content: input.content,
            manualRequestHash,
            origin: "manual",
            sourceUrl: null,
          })
          .onConflictDoNothing();
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
    .input(idInput.extend({ newId: z.uuid(), groupId: z.uuid().nullable() }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await checkRecipeCapacity(tx, userId);
        if (input.groupId) {
          await lockGroup(tx, input.groupId);
          await requireGroup(tx, input.groupId, userId);
        }
        const [source] = await tx
          .select()
          .from(recipe)
          .where(owned(input.id, userId));
        if (!source) throw missing();
        const [saved] = await tx
          .insert(recipe)
          .values({
            id: input.newId,
            userId,
            groupId: input.groupId,
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
        const sourceTags = await tx
          .select({ tagId: recipeTag.tagId })
          .from(recipeTag)
          .where(
            and(eq(recipeTag.recipeId, input.id), eq(recipeTag.userId, userId)),
          );
        if (sourceTags.length)
          await tx
            .insert(recipeTag)
            .values(
              sourceTags.map((t) => ({ ...t, userId, recipeId: saved.id })),
            );
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
        await getRecipe(input.id, ctx.session.user.id);
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
    if (!deleted.length) throw missing();
    return { success: true };
  }),
});
