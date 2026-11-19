import { calendarDate } from "@prep-sheet/db/meal-planner";
import { z } from "zod";
import { thisWeek, weekRange } from "../dates";
import { ToolError } from "./result";
import { householdScope, mealSlot, portionCount, retryId } from "./schemas";
import { behaviour, defineTool } from "./tool";

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

export const planMeal = defineTool({
  name: "plan_meal",
  description:
    "Add a recipe to a household's meal plan on YYYY-MM-DD. Meal slot is Breakfast, Lunch, Dinner or empty for no slot. baseServings defaults to the recipe's servings (first number, or lower end of a range); if those can't be read, it uses 2 and returns baseServingsAssumed=true, so tell the user. servings to cook/eat defaults to that base. Both can be overridden with 1 to 100. This adds a meal without replacing existing meals and needs no revision. Reuse mealId for identical retries; a different meal with the same mealId is a conflict.",
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
  async run({ mealId, ...meal }, { api }) {
    const result = await api.planner.addMeal({ id: mealId, ...meal });
    const { date, slot } = meal;
    return {
      summary: `Meal planned for ${date}${slot ? `, ${slot}` : ""}.${
        result.baseServingsAssumed
          ? " The recipe's servings couldn't be read, so 2 base servings were assumed."
          : ""
      }`,
      data: {
        mealId: result.mealId,
        date,
        slot,
        baseServingsAssumed: result.baseServingsAssumed,
      },
    };
  },
});

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
