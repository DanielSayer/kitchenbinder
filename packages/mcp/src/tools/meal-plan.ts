import { randomUUID } from "node:crypto";
import {
  calendarDate,
  defaultMealServings,
  type MealInput,
  plannerRecipeServings,
} from "@prep-sheet/db/meal-planner";
import { z } from "zod";
import { thisWeek, weekRange } from "../dates";
import { ToolError } from "./result";
import { householdScope, mealSlot, portionCount, retryId } from "./schemas";
import { behaviour, defineTool, type ToolContext } from "./tool";

export const getMealPlan = defineTool({
  name: "get_meal_plan",
  description:
    "Read planned meals for an inclusive date range. Dates are YYYY-MM-DD. Omitted dates mean this week in Australia/Brisbane using your saved week-start preference. Returns meal IDs and the planner revision needed to remove a meal safely.",
  input: z.object({
    ...householdScope,
    start: calendarDate.optional(),
    end: calendarDate.optional(),
  }),
  annotations: behaviour.read,
  async run({ householdId, ...bounds }, { api }) {
    const { start, end } = await weekRange(bounds, async () =>
      thisWeek((await api.preferences.get()).weekStartsOn),
    );
    if (start > end)
      throw new ToolError(
        "BAD_REQUEST",
        "The end date must be on or after the start date.",
      );
    const plan = await api.planner.get({ householdId });
    const meals = plan.meals.filter(
      (meal) => meal.date >= start && meal.date <= end,
    );
    return {
      summary: `${meals.length} planned meal(s) from ${start} to ${end}.`,
      data: {
        householdId: plan.householdId,
        revision: plan.revision,
        start,
        end,
        meals,
        issues: plan.issues,
        shoppingTripStale: plan.stale,
      },
    };
  },
});

type Plan = Awaited<ReturnType<ToolContext["api"]["planner"]["get"]>>;
type PlannedMeal = Plan["meals"][number];
type RecipeMeal = Extract<MealInput, { kind: "recipe" }>;

/** The recipe's whole-number servings, or the planner's default. */
async function recipeServings(api: ToolContext["api"], recipeId: string) {
  const recipe = await api.recipes.get({ id: recipeId });
  const parsed = portionCount.safeParse(
    Number(plannerRecipeServings(recipe.content.servings)),
  );
  return parsed.success ? parsed.data : defaultMealServings;
}

export const planMeal = defineTool({
  name: "plan_meal",
  description:
    "Add a recipe to a household's meal plan on YYYY-MM-DD. Meal slot is Breakfast, Lunch, Dinner or empty for no slot. baseServings defaults to the recipe's whole-number servings, or 2 if unavailable. servings to cook/eat defaults to that base. Both can be overridden with 1 to 100. This adds a meal without replacing existing meals. Reuse mealId for identical retries. Concurrent plan changes return a conflict; read and review the new plan before retrying.",
  input: z.object({
    ...householdScope,
    recipeId: z.uuid(),
    mealId: retryId(
      "Reuse for an identical retry. Use a new ID for a different meal.",
    ),
    date: calendarDate,
    slot: mealSlot.default("Dinner"),
    baseServings: portionCount.optional(),
    servings: portionCount.optional(),
  }),
  annotations: behaviour.create,
  async run(
    {
      householdId,
      recipeId,
      mealId = randomUUID(),
      date,
      slot,
      baseServings,
      servings,
    },
    { api },
  ) {
    const plan = await api.planner.get({ householdId });
    const existing = plan.meals.find((meal) => meal.id === mealId);
    const retry =
      existing?.kind === "recipe" && existing.recipeId === recipeId
        ? existing
        : undefined;
    // A retry keeps its original base even if the recipe has since changed.
    const base =
      baseServings ??
      retry?.baseServings ??
      (await recipeServings(api, recipeId));
    const meal: RecipeMeal = {
      id: mealId,
      kind: "recipe",
      recipeId,
      date,
      slot,
      baseServings: base,
      cook: servings ?? base,
      eat: servings ?? base,
    };
    const result = { mealId, date, slot };
    if (existing) {
      if (!sameMeal(existing, meal))
        throw new ToolError(
          "CONFLICT",
          "This meal ID belongs to an earlier plan. Review that meal and use a new mealId for a different addition.",
          { mealId },
        );
      return { summary: "This meal is already planned.", data: result };
    }
    await api.planner.save({ householdId, revision: plan.revision, meal });
    return {
      summary: `Meal planned for ${date}${slot ? `, ${slot}` : ""}.`,
      data: result,
    };
  },
});

function sameMeal(existing: PlannedMeal, meal: RecipeMeal) {
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

export const removePlannedMeal = defineTool({
  name: "remove_planned_meal",
  description:
    "Remove a planned meal after the user confirms. Read get_meal_plan first and pass its revision and the meal ID. Stale revisions fail safely; read and review the changed plan before retrying. This does not delete the recipe or automatically alter the shopping list.",
  input: z.object({
    ...householdScope,
    mealId: z.uuid(),
    revision: z.number().int().min(0),
  }),
  annotations: behaviour.remove,
  async run({ householdId, mealId, revision }, { api }) {
    await api.planner.remove({ householdId, id: mealId, revision });
    return { summary: "Planned meal removed.", data: { mealId } };
  },
});
