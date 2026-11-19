import { ingredientLines } from "@prep-sheet/db/ingredient-line";
import type { Meal } from "@prep-sheet/db/meal-planner";
import { mealPlanner } from "@prep-sheet/db/schema/meal-planner";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { accessibleRecipe, type Database } from "../households/access";

/** A household's saved plan, or an empty one at revision 0. */
export async function state(tx: Database, householdId: string) {
  const [saved] = await tx
    .select()
    .from(mealPlanner)
    .where(eq(mealPlanner.householdId, householdId));
  return saved ?? { householdId, meals: [], revision: 0, trip: null };
}
export type PlanState = Awaited<ReturnType<typeof state>>;

export async function saveState(tx: Database, saved: PlanState) {
  await tx
    .insert(mealPlanner)
    .values(saved)
    .onConflictDoUpdate({ target: mealPlanner.householdId, set: saved });
}

export function conflict() {
  return new TRPCError({
    code: "CONFLICT",
    message:
      "Your plan or shopping list changed. Refresh and review it again before saving.",
  });
}

/** Plan meals with `meal` added or replaced, in date order, capped at 1,000. */
export function withMeal(meals: Meal[], meal: Meal) {
  const next = [...meals.filter((entry) => entry.id !== meal.id), meal].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  if (next.length > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Your planner is full. Remove older meals before adding more.",
    });
  return next;
}

/**
 * What a recipe meal stores from its recipe when planned, plus the recipe's
 * servings text. Meals keep this snapshot even if the recipe later changes.
 */
export async function recipeSnapshot(
  tx: Database,
  userId: string,
  recipeId: string,
) {
  const [source] = await tx
    .select()
    .from(recipe)
    .where(and(eq(recipe.id, recipeId), accessibleRecipe(userId)));
  if (!source)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That recipe is no longer available. Choose another recipe.",
    });
  return {
    snapshot: {
      title: source.title,
      ingredients: source.content.ingredients,
      ingredientData: ingredientLines(
        source.content.ingredients,
        source.ingredientData,
      ),
    },
    servings: source.content.servings,
  };
}
