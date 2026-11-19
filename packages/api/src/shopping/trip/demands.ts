import { ingredientLines } from "@prep-sheet/db/ingredient-line";
import type {
  Coverage,
  Demand,
  Meal,
  MealTrip,
} from "@prep-sheet/db/meal-planner";

/** Stored as `meal_planner.trip`. */
export type ShoppingTrip = MealTrip;

// One demand per ingredient line to buy: `${mealId}:${position}`.
function demandKey(mealId: string, position: number) {
  return `${mealId}:${position}`;
}

/** What the planned meals in the covered dates need, one entry per line. */
export function shoppingDemands(meals: Meal[], coverage: Coverage): Demand[] {
  return meals
    .flatMap((meal) =>
      meal.kind === "recipe" &&
      meal.date >= coverage.start &&
      meal.date <= coverage.end
        ? ingredientLines(meal.ingredients, meal.ingredientData).flatMap(
            (line, position) =>
              // Headings such as "For the sauce:" aren't things to buy.
              line.heading
                ? []
                : [
                    {
                      key: demandKey(meal.id, position),
                      mealId: meal.id,
                      recipeId: meal.recipeId,
                      title: meal.title,
                      text: line.text,
                      parsed: line.parsed,
                      factor: meal.cook / meal.baseServings,
                      servings: meal.cook,
                    },
                  ],
          )
        : [],
    )
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function sameDemand(a: Demand, b: Demand) {
  return (
    a.key === b.key &&
    a.recipeId === b.recipeId &&
    a.text === b.text &&
    a.factor === b.factor
  );
}

/** Whether meal changes since the trip affect what to buy. */
export function tripIsStale(meals: Meal[], trip: ShoppingTrip | null) {
  if (!trip) return false;
  const current = shoppingDemands(meals, trip);
  return (
    current.length !== trip.demands.length ||
    current.some((demand, index) => {
      const previous = trip.demands[index];
      return !previous || !sameDemand(demand, previous);
    })
  );
}
