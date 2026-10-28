import { calendarDate, type Meal } from "@prep-sheet/db/meal-planner";
import { householdMember } from "@prep-sheet/db/schema/household";
import {
  recipe,
  recipeCooking,
  recipeFavourite,
  recipeRating,
} from "@prep-sheet/db/schema/recipe";
import { recipeTag } from "@prep-sheet/db/schema/tag";
import { and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accessibleRecipe,
  type Database,
  requireCollection,
} from "../households/access";
import { inCollection, pickerFields } from "./list";
import { suggest } from "./suggest";

const maxCandidates = 2000;

export const suggestionsInput = z.object({
  householdId: z.uuid().optional(),
  weekStart: calendarDate,
  today: calendarDate,
  collectionId: z.uuid().optional(),
  shuffle: z.number().int().min(0).max(1_000_000).default(0),
});

const id = sql`${recipe}.${sql.identifier("id")}`;
const members = (householdId: string) =>
  sql`(select ${householdMember.userId} from ${householdMember} where ${householdMember.householdId} = ${householdId})`;

export async function mealSuggestions(
  database: Database,
  userId: string,
  householdId: string,
  meals: Meal[],
  input: z.infer<typeof suggestionsInput>,
) {
  if (input.collectionId)
    await requireCollection(database, input.collectionId, userId);
  const household = members(householdId);
  const rows = await database
    .select({
      ...pickerFields,
      createdAt: sql<string>`${recipe.createdAt}::text`,
      rating: sql<
        number | null
      >`(select avg(${recipeRating.rating})::float8 from ${recipeRating} where ${recipeRating.recipeId} = ${id} and ${recipeRating.userId} in ${household})`,
      favourite: sql<boolean>`exists (select 1 from ${recipeFavourite} where ${recipeFavourite.recipeId} = ${id} and ${recipeFavourite.userId} in ${household})`,
      lastCooked: sql<
        string | null
      >`(select max(coalesce(${recipeCooking.cookedOn}, ${recipeCooking.createdAt}::date))::text from ${recipeCooking} where ${recipeCooking.recipeId} = ${id} and ${recipeCooking.userId} in ${household})`,
      tagIds: sql<string[]>`coalesce((
        select json_agg(${recipeTag.tagId}) from ${recipeTag} where ${recipeTag.recipeId} = ${id}
      ), '[]'::json)`,
    })
    .from(recipe)
    .where(
      and(
        accessibleRecipe(userId),
        input.collectionId ? inCollection(input.collectionId) : undefined,
      ),
    )
    .orderBy(desc(recipe.createdAt), desc(recipe.id))
    .limit(maxCandidates);

  // Planned meals before the viewed week count as had; the viewed week is excluded.
  const weekEnd = new Date(Date.parse(input.weekStart) + 6 * 86400000)
    .toISOString()
    .slice(0, 10);
  const lastPlanned = new Map<string, string>();
  const excludeIds = new Set<string>();
  for (const meal of meals) {
    if (meal.kind !== "recipe") continue;
    if (meal.date >= input.weekStart && meal.date <= weekEnd)
      excludeIds.add(meal.recipeId);
    else if (
      meal.date < input.weekStart &&
      meal.date > (lastPlanned.get(meal.recipeId) ?? "")
    )
      lastPlanned.set(meal.recipeId, meal.date);
  }

  return suggest(
    rows.map(({ lastCooked, ...row }) => {
      const planned = lastPlanned.get(row.id) ?? null;
      return {
        ...row,
        lastHad:
          planned && (!lastCooked || planned > lastCooked)
            ? planned
            : lastCooked,
      };
    }),
    {
      today: input.today,
      seed: `${householdId}:${input.weekStart}:${input.shuffle}`,
      excludeIds,
    },
  );
}
