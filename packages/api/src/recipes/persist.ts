import { recipe } from "@prep-sheet/db/schema/recipe";
import { recipeTag, tag } from "@prep-sheet/db/schema/tag";
import { and, inArray } from "drizzle-orm";
import type { Database } from "../groups/access";
import { collectionTagScope } from "../tags/access";

export async function persistRecipe(
  database: Database,
  value: typeof recipe.$inferInsert,
  tagIds: string[],
) {
  const inserted = await database
    .insert(recipe)
    .values(value)
    .onConflictDoNothing()
    .returning({ id: recipe.id });
  if (!inserted.length) return false;
  if (!tagIds.length || !value.userId) return true;
  const userId = value.userId;
  const valid = await database
    .select({ id: tag.id })
    .from(tag)
    .where(
      and(
        inArray(tag.id, tagIds),
        collectionTagScope(userId, value.groupId ?? null),
      ),
    );
  if (valid.length)
    await database
      .insert(recipeTag)
      .values(valid.map((t) => ({ recipeId: value.id, tagId: t.id })))
      .onConflictDoNothing();
  return true;
}
