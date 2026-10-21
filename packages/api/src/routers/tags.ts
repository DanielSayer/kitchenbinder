import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { tag } from "@prep-sheet/db/schema/tag";
import { TRPCError } from "@trpc/server";
import { and, asc, count, DrizzleQueryError, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, requireGroup } from "../groups/access";
import { protectedProcedure, router } from "../index";
import {
  collectionTagScope,
  customTagScope,
  lockTagCollection,
} from "../tags/access";

const collectionScope = z.object({
  groupId: z.uuid().nullable().default(null),
});

const tagDetailsInput = collectionScope.extend({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(300).default(""),
});

const defaults = (
  [
    [
      "High protein",
      "A substantial protein source per serving, such as meat, fish, eggs, tofu or legumes. Do not invent nutrition figures.",
    ],
    [
      "Under 30 minutes",
      "Total elapsed time is strictly less than 30 minutes, including preparation, cooking and any waiting. Skip if total time is unknown.",
    ],
    [
      "Under an hour",
      "Total elapsed time is strictly less than 60 minutes, including preparation, cooking and any waiting. Skip if total time is unknown.",
    ],
    [
      "Vegetarian",
      "No meat, fish, seafood, meat stock or gelatine. Check all ingredients.",
    ],
    [
      "Freezer friendly",
      "The finished dish can reasonably be frozen and reheated without losing its intended texture.",
    ],
  ] as const
).map(([name, description], index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  name,
  description,
}));

let defaultTagsReady: Promise<void> | undefined;

// Share first-use initialization across requests. A failed insert can be retried.
function initializeDefaultTags() {
  defaultTagsReady ??= db
    .insert(tag)
    .values(defaults)
    .onConflictDoNothing()
    .then(() => undefined)
    .catch((error: unknown) => {
      defaultTagsReady = undefined;
      throw error;
    });
  return defaultTagsReady;
}

function nameConflict() {
  return new TRPCError({
    code: "CONFLICT",
    message: "A tag with that name already exists.",
  });
}

function handleTagWriteError(error: unknown): never {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (
    cause instanceof Error &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    (cause.constraint === "tag_user_name_idx" ||
      cause.constraint === "tag_group_name_idx")
  ) {
    throw nameConflict();
  }
  throw error;
}

async function checkTagName(
  tx: Database,
  userId: string,
  name: string,
  groupId: string | null,
  excludingId?: string,
) {
  const [existing] = await tx
    .select({ id: tag.id })
    .from(tag)
    .where(
      and(
        collectionTagScope(userId, groupId),
        eq(sql`lower(${tag.name})`, sql`lower(${name})`),
        excludingId ? ne(tag.id, excludingId) : undefined,
      ),
    )
    .limit(1);
  if (existing) throw nameConflict();
}

export async function availableTags(
  userId: string,
  groupId: string | null = null,
) {
  if (groupId) await requireGroup(db, groupId, userId);
  await initializeDefaultTags();
  return db
    .select()
    .from(tag)
    .where(collectionTagScope(userId, groupId))
    .orderBy(asc(tag.name));
}

export const tagsRouter = router({
  list: protectedProcedure
    .input(collectionScope.prefault({}))
    .query(({ ctx, input }) =>
      availableTags(ctx.session.user.id, input.groupId),
    ),
  create: protectedProcedure
    .input(tagDetailsInput)
    .mutation(async ({ ctx, input }) => {
      await initializeDefaultTags();
      const userId = ctx.session.user.id;
      return db
        .transaction(async (tx) => {
          await lockTagCollection(tx, userId, input.groupId);
          await checkTagName(tx, userId, input.name, input.groupId);
          const [custom] = await tx
            .select({ total: count() })
            .from(tag)
            .where(customTagScope(userId, input.groupId));
          if ((custom?.total ?? 0) >= 100)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "You can create up to 100 custom tags per collection.",
            });
          const [saved] = await tx
            .insert(tag)
            .values({
              id: randomUUID(),
              ...input,
              userId: input.groupId ? null : userId,
            })
            .returning();
          if (!saved) throw new Error("Tag insert returned no row.");
          return saved;
        })
        .catch(handleTagWriteError);
    }),
  update: protectedProcedure
    .input(tagDetailsInput.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await initializeDefaultTags();
      const userId = ctx.session.user.id;
      return db
        .transaction(async (tx) => {
          await lockTagCollection(tx, userId, input.groupId);
          const ownedTag = and(
            eq(tag.id, input.id),
            customTagScope(userId, input.groupId),
          );
          const [existing] = await tx.select().from(tag).where(ownedTag);
          if (!existing)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Custom tag not found.",
            });
          await checkTagName(tx, userId, input.name, input.groupId, input.id);
          const [saved] = await tx
            .update(tag)
            .set({ name: input.name, description: input.description })
            .where(ownedTag)
            .returning();
          if (!saved) throw new Error("Tag update returned no row.");
          return saved;
        })
        .catch(handleTagWriteError);
    }),
  delete: protectedProcedure
    .input(collectionScope.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return db.transaction(async (tx) => {
        await lockTagCollection(tx, userId, input.groupId);
        const deleted = await tx
          .delete(tag)
          .where(
            and(eq(tag.id, input.id), customTagScope(userId, input.groupId)),
          )
          .returning();
        if (!deleted.length)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Custom tag not found.",
          });
        return { success: true };
      });
    }),
});
