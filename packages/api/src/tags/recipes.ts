import { randomUUID } from "node:crypto";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { recipeTag, tag } from "@prep-sheet/db/schema/tag";
import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { accessibleRecipe, type Database } from "../groups/access";
import {
  collectionTagScope,
  customTagScope,
  lockTagCollection,
} from "./access";

export async function setRecipeTags(
  database: Database,
  userId: string,
  recipeIds: string[],
  tagIds: string[],
  selected: boolean,
) {
  // Match the account-then-group lock order used by recipe insertion/copying.
  await lockTagCollection(database, userId, null);
  const candidates = await database
    .select({ groupId: recipe.groupId })
    .from(recipe)
    .where(and(inArray(recipe.id, recipeIds), accessibleRecipe(userId)));
  const groupIds = [
    ...new Set(
      candidates.flatMap((item) => (item.groupId ? [item.groupId] : [])),
    ),
  ].sort();
  for (const groupId of groupIds)
    await lockTagCollection(database, userId, groupId);
  const recipes = await database
    .select({ id: recipe.id, groupId: recipe.groupId })
    .from(recipe)
    .where(and(inArray(recipe.id, recipeIds), accessibleRecipe(userId)));
  if (recipes.length !== recipeIds.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "One or more recipes could not be found.",
    });
  for (const groupId of new Set(recipes.map((item) => item.groupId))) {
    const tags = await database
      .select({ id: tag.id })
      .from(tag)
      .where(and(inArray(tag.id, tagIds), collectionTagScope(userId, groupId)));
    if (tags.length !== tagIds.length)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "One or more tags could not be found in this collection.",
      });
  }
  if (selected) {
    await database
      .insert(recipeTag)
      .values(
        recipeIds.flatMap((recipeId) =>
          tagIds.map((tagId) => ({ recipeId, tagId })),
        ),
      )
      .onConflictDoNothing();
  } else {
    await database
      .delete(recipeTag)
      .where(
        and(
          inArray(recipeTag.recipeId, recipeIds),
          inArray(recipeTag.tagId, tagIds),
        ),
      );
  }
}

// The destination collection must be locked before copying its tag definitions.
export async function copyRecipeTags(
  database: Database,
  userId: string,
  sourceId: string,
  destinationId: string,
  groupId: string | null,
) {
  const sourceTags = await database
    .select({ tag })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(eq(recipeTag.recipeId, sourceId));
  const [{ total } = { total: 0 }] = await database
    .select({ total: count() })
    .from(tag)
    .where(customTagScope(userId, groupId));
  let customCount = total;
  const ids: string[] = [];
  for (const { tag: source } of sourceTags) {
    if (!source.userId && !source.groupId) {
      ids.push(source.id);
      continue;
    }
    const [existing] = await database
      .select({ id: tag.id })
      .from(tag)
      .where(
        and(
          collectionTagScope(userId, groupId),
          eq(sql`lower(${tag.name})`, sql`lower(${source.name})`),
        ),
      );
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    if (customCount >= 100)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "The destination collection can have up to 100 custom tags. Remove a tag before copying this recipe.",
      });
    const id = randomUUID();
    await database.insert(tag).values({
      id,
      userId: groupId ? null : userId,
      groupId,
      name: source.name,
      description: source.description,
    });
    customCount++;
    ids.push(id);
  }
  if (ids.length)
    await database
      .insert(recipeTag)
      .values(ids.map((tagId) => ({ recipeId: destinationId, tagId })))
      .onConflictDoNothing();
}
