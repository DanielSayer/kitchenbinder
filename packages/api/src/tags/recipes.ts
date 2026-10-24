import { randomUUID } from "node:crypto";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { recipeTag, tag } from "@prep-sheet/db/schema/tag";
import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { type Database, ownedRecipe } from "../households/access";
import { availableTagScope, customTagScope, lockTags } from "./access";

// Only the recipe owner tags a recipe, using built-in or their own tags.
export async function setRecipeTags(
  database: Database,
  userId: string,
  recipeIds: string[],
  tagIds: string[],
  selected: boolean,
) {
  await lockTags(database, userId);
  const recipes = await database
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(inArray(recipe.id, recipeIds), ownedRecipe(userId)));
  if (recipes.length !== recipeIds.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "One or more recipes could not be found. Only a recipe's owner can change its tags.",
    });
  const tags = await database
    .select({ id: tag.id })
    .from(tag)
    .where(and(inArray(tag.id, tagIds), availableTagScope(userId)));
  if (tags.length !== tagIds.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "One or more tags could not be found.",
    });
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

// Copies the source owner's tags into the copier's own tags. Caller holds the account lock.
export async function copyRecipeTags(
  database: Database,
  userId: string,
  sourceId: string,
  destinationId: string,
) {
  const sourceTags = await database
    .select({ tag })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(eq(recipeTag.recipeId, sourceId));
  const [{ total } = { total: 0 }] = await database
    .select({ total: count() })
    .from(tag)
    .where(customTagScope(userId));
  let customCount = total;
  const ids: string[] = [];
  for (const { tag: source } of sourceTags) {
    if (!source.userId || source.userId === userId) {
      ids.push(source.id);
      continue;
    }
    const [existing] = await database
      .select({ id: tag.id })
      .from(tag)
      .where(
        and(
          availableTagScope(userId),
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
          "You can have up to 100 custom tags. Remove a tag before copying this recipe.",
      });
    const id = randomUUID();
    await database.insert(tag).values({
      id,
      userId,
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
