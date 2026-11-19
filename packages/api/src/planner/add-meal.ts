import { randomUUID } from "node:crypto";
import { baseServings } from "@prep-sheet/db/ingredient-line";
import {
  calendarDate,
  defaultMealServings,
  type Meal,
  type MealInput,
} from "@prep-sheet/db/meal-planner";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type Database, resolveHousehold } from "../households/access";
import { recipeSnapshot, saveState, state, withMeal } from "./state";

const portions = z.number().int().min(1).max(100);

export const addMealInput = z.object({
  // Omitted householdId = the caller's personal household.
  householdId: z.uuid().optional(),
  /** Reuse for a safe retry; omitted means a new meal. */
  id: z.uuid().optional(),
  recipeId: z.uuid(),
  date: calendarDate,
  slot: z.enum(["", "Breakfast", "Lunch", "Dinner"]).default(""),
  baseServings: portions.optional(),
  /** Servings to cook and eat; defaults to the base. */
  servings: portions.optional(),
});
export type AddMealInput = z.input<typeof addMealInput>;

type RecipeMeal = Extract<MealInput, { kind: "recipe" }>;

/** The recipe's base servings, or the default when unreadable or over 100. */
function recipeBase(servings: string | null | undefined) {
  const parsed = portions.safeParse(baseServings(servings));
  return parsed.success
    ? { base: parsed.data, assumed: false }
    : { base: defaultMealServings, assumed: true };
}

function sameMeal(existing: Meal, meal: RecipeMeal) {
  return (
    existing.kind === "recipe" &&
    existing.recipeId === meal.recipeId &&
    existing.date === meal.date &&
    existing.slot === meal.slot &&
    existing.baseServings === meal.baseServings &&
    existing.cook === meal.cook &&
    existing.eat === meal.eat
  );
}

/**
 * Adds a recipe meal without a revision: it never overwrites another meal.
 * Reusing an ID for the same meal is a no-op; for a different meal, a conflict.
 * A retry after the meal was removed adds it again.
 */
export async function addMeal(
  tx: Database,
  userId: string,
  input: z.output<typeof addMealInput>,
) {
  const householdId = await resolveHousehold(tx, userId, input.householdId, {
    lock: true,
  });
  const saved = await state(tx, householdId);
  const id = input.id ?? randomUUID();
  const existing = saved.meals.find((meal) => meal.id === id);
  const planned = (base: number): RecipeMeal => ({
    id,
    kind: "recipe",
    recipeId: input.recipeId,
    date: input.date,
    slot: input.slot,
    baseServings: base,
    cook: input.servings ?? base,
    eat: input.servings ?? base,
  });
  if (existing) {
    // A retry keeps its saved base even if the recipe's servings changed.
    const base =
      input.baseServings ??
      (existing.kind === "recipe" && existing.recipeId === input.recipeId
        ? existing.baseServings
        : defaultMealServings);
    if (!sameMeal(existing, planned(base)))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This meal ID belongs to a different planned meal. Review that meal and use a new ID for a different addition.",
      });
    return { mealId: id, revision: saved.revision, baseServingsAssumed: false };
  }
  const { snapshot, servings } = await recipeSnapshot(
    tx,
    userId,
    input.recipeId,
  );
  const fallback = recipeBase(servings);
  const base = input.baseServings ?? fallback.base;
  const meal: Meal = { ...planned(base), ...snapshot };
  const revision = saved.revision + 1;
  await saveState(tx, {
    ...saved,
    meals: withMeal(saved.meals, meal),
    revision,
  });
  return {
    mealId: id,
    revision,
    baseServingsAssumed: input.baseServings === undefined && fallback.assumed,
  };
}
