import { db } from "@prep-sheet/db";
import {
  maxRecipePageSize,
  recipePageSize,
  recipeSorts,
} from "@prep-sheet/db/recipe-list";
import {
  recipe,
  recipeCooking,
  recipeFavourite,
  recipeRating,
} from "@prep-sheet/db/schema/recipe";
import { recipeTag } from "@prep-sheet/db/schema/tag";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accessibleRecipe,
  type Database,
  requireGroup,
} from "../groups/access";

const pagination = {
  page: z.number().int().min(0).max(1_000_000).default(0),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(maxRecipePageSize)
    .default(recipePageSize),
};
export const collectionInput = z
  .object({
    ...pagination,
    groupId: z.uuid().nullable().optional(),
    search: z.string().max(2000).default(""),
    favouritesOnly: z.boolean().default(false),
    unratedOnly: z.boolean().default(false),
    neverCooked: z.boolean().default(false),
    cookedBefore: z.iso.date().optional(),
    tagIds: z.array(z.uuid()).max(105).default([]),
    sort: z.enum(recipeSorts).default("newest"),
  })
  .prefault({});

export const pickerInput = z
  .object({
    ...pagination,
    collection: z.union([z.enum(["all", "personal"]), z.uuid()]).default("all"),
    search: z.string().max(2000).default(""),
  })
  .prefault({});
export const taggingInput = z
  .object({
    ...pagination,
    search: z.string().max(2000).default(""),
    excludeTagId: z.uuid().optional(),
  })
  .prefault({});

export const favouriteOf = (userId: string) => sql<boolean>`exists (
  select 1 from ${recipeFavourite}
  where ${recipeFavourite.recipeId} = ${recipe.id} and ${recipeFavourite.userId} = ${userId}
)`;
export const ratingOf = (userId: string) => sql<number | null>`(
  select ${recipeRating.rating} from ${recipeRating}
  where ${recipeRating.recipeId} = ${recipe.id} and ${recipeRating.userId} = ${userId}
)`;
export const tagsOf = (userId: string) => sql<string[]>`coalesce((
  select json_agg(${recipeTag.tagId}) from ${recipeTag}
  where ${recipeTag.recipeId} = ${recipe.id} and ${recipeTag.userId} = ${userId}
), '[]'::json)`;
export const cookingSummary = (userId: string) => ({
  cookedCount: sql<number>`(select count(*)::int from ${recipeCooking} where ${recipeCooking.recipeId} = ${recipe}.${sql.identifier("id")} and ${recipeCooking.userId} = ${userId})`,
  lastCookedOn: sql<
    string | null
  >`(select max(${recipeCooking.cookedOn})::text from ${recipeCooking} where ${recipeCooking.recipeId} = ${recipe}.${sql.identifier("id")} and ${recipeCooking.userId} = ${userId})`,
});
const hasTag = (userId: string, tagId: string) => sql<boolean>`exists (
  select 1 from ${recipeTag} where ${recipeTag.recipeId} = ${recipe.id}
  and ${recipeTag.userId} = ${userId} and ${recipeTag.tagId} = ${tagId}
)`;

// ICU numeric collation preserves natural, case/accent-insensitive name ordering.
// UUID is always the final key, including equal names and timestamps.
const nameOrder = sql`${recipe.title} collate recipe_name`;
const minutes = (field: "prepMinutes" | "cookMinutes" | "totalMinutes") =>
  sql<number | null>`(${recipe.content}->>${field})::int`;
const prep = minutes("prepMinutes");
const cook = minutes("cookMinutes");
const total = minutes("totalMinutes");
const duration = sql<number | null>`case
  when ${total} is not null and (${prep} is null or ${cook} is null or ${total} >= ${prep} + ${cook}) then ${total}
  else ${prep} + ${cook} end`;
const titleMatches = (search: string) =>
  sql<boolean>`strpos(lower(${recipe.title}), lower(${search.trim()})) > 0`;

export function collectionQueries(
  database: Database,
  userId: string,
  input: z.infer<typeof collectionInput>,
) {
  const history = cookingSummary(userId);
  const search = input.search.trim();
  const where = and(
    accessibleRecipe(userId),
    input.groupId ? eq(recipe.groupId, input.groupId) : isNull(recipe.groupId),
    search
      ? sql`(${titleMatches(search)} or exists (
      select 1 from jsonb_array_elements_text(${recipe.content}->'ingredients') as ingredient(value)
      where strpos(lower(ingredient.value), lower(${search})) > 0
    ))`
      : undefined,
    input.favouritesOnly ? favouriteOf(userId) : undefined,
    input.unratedOnly ? sql`${ratingOf(userId)} is null` : undefined,
    input.neverCooked ? sql`${history.cookedCount} = 0` : undefined,
    input.cookedBefore
      ? sql`${history.lastCookedOn} < ${input.cookedBefore}`
      : undefined,
    ...input.tagIds.map((id) => hasTag(userId, id)),
  );
  const order = (() => {
    switch (input.sort) {
      case "newest":
        return [desc(recipe.createdAt), asc(recipe.id)];
      case "name":
        return [asc(nameOrder), asc(recipe.id)];
      case "highest-rated":
        return [
          sql`${ratingOf(userId)} desc nulls last`,
          asc(nameOrder),
          asc(recipe.id),
        ];
      case "last-cooked":
        return [
          sql`${history.lastCookedOn} desc nulls last`,
          asc(nameOrder),
          asc(recipe.id),
        ];
      case "cooking-time":
        return [
          sql`${duration} asc nulls last`,
          asc(nameOrder),
          asc(recipe.id),
        ];
    }
  })();
  return {
    count: database
      .select({ total: sql<number>`count(*)::int` })
      .from(recipe)
      .where(where),
    items: database
      .select({
        id: recipe.id,
        title: recipe.title,
        description: sql<string>`${recipe.content}->>'description'`,
        ingredientCount: sql<number>`jsonb_array_length(${recipe.content}->'ingredients')`,
        prepMinutes: prep,
        cookMinutes: cook,
        totalMinutes: total,
        createdAt: recipe.createdAt,
        isFavourite: favouriteOf(userId),
        rating: ratingOf(userId),
        ...history,
        tagIds: tagsOf(userId),
      })
      .from(recipe)
      .where(where)
      .orderBy(...order)
      .limit(input.pageSize)
      .offset(input.page * input.pageSize),
  };
}

export async function listRecipes(
  userId: string,
  input: z.infer<typeof collectionInput>,
) {
  if (input.groupId) await requireGroup(db, input.groupId, userId);
  return db.transaction(
    async (tx) => {
      const queries = collectionQueries(tx, userId, input);
      const [count] = await queries.count;
      const items = await queries.items;
      return { items, total: count?.total ?? 0 };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

const pickerFields = {
  id: recipe.id,
  title: recipe.title,
  groupId: recipe.groupId,
  servings: sql<string | null>`${recipe.content}->>'servings'`,
};
export async function shoppingRecipePage(
  userId: string,
  input: z.infer<typeof pickerInput>,
) {
  if (input.collection !== "all" && input.collection !== "personal")
    await requireGroup(db, input.collection, userId);
  const where = and(
    accessibleRecipe(userId),
    input.collection === "all"
      ? undefined
      : input.collection === "personal"
        ? isNull(recipe.groupId)
        : eq(recipe.groupId, input.collection),
    input.search.trim() ? titleMatches(input.search) : undefined,
  );
  return db.transaction(
    async (tx) => {
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(recipe)
        .where(where);
      const items = await tx
        .select(pickerFields)
        .from(recipe)
        .where(where)
        .orderBy(asc(nameOrder), asc(recipe.id))
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);
      return { items, total: count?.total ?? 0 };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function taggingRecipePage(
  userId: string,
  input: z.infer<typeof taggingInput>,
) {
  const where = and(
    accessibleRecipe(userId),
    input.search.trim() ? titleMatches(input.search) : undefined,
    input.excludeTagId
      ? sql`not ${hasTag(userId, input.excludeTagId)}`
      : undefined,
  );
  return db.transaction(
    async (tx) => {
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(recipe)
        .where(where);
      const items = await tx
        .select({ id: recipe.id, title: recipe.title, groupId: recipe.groupId })
        .from(recipe)
        .where(where)
        .orderBy(asc(nameOrder), asc(recipe.id))
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);
      return { items, total: count?.total ?? 0 };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function pickerRecipe(userId: string, id: string) {
  const [item] = await db
    .select(pickerFields)
    .from(recipe)
    .where(and(eq(recipe.id, id), accessibleRecipe(userId)));
  return item ?? null;
}
