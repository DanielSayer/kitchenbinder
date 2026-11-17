import { z } from "zod";
import {
  type Ingredient,
  type IngredientLine,
  ingredientLines,
} from "./ingredient-line";

export const calendarDate = z.iso
  .date()
  .refine(
    (value) => value >= "2000-01-01" && value <= "2100-12-31",
    "Choose a date between 2000 and 2100.",
  );
const portions = z.number().int().min(1).max(100);
export const defaultMealServings = 2;

const common = {
  id: z.uuid(),
  date: calendarDate,
  slot: z.enum(["", "Breakfast", "Lunch", "Dinner"]),
};
export const mealInput = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("recipe"),
      recipeId: z.uuid(),
      baseServings: portions,
      cook: portions,
      eat: portions,
    })
    .refine(
      (meal) => meal.eat <= meal.cook,
      "Servings to eat cannot exceed servings to cook.",
    ),
  z.object({
    ...common,
    kind: z.literal("leftovers"),
    sourceId: z.uuid(),
    portions,
  }),
  z.object({
    ...common,
    kind: z.literal("out"),
    description: z.string().trim().max(200),
  }),
]);
export type MealInput = z.infer<typeof mealInput>;
export type Meal =
  | Exclude<MealInput, { kind: "recipe" }>
  | (Extract<MealInput, { kind: "recipe" }> & {
      title: string;
      ingredients: string[];
      /** Each line's parse, from the recipe when planned. Older meals lack it. */
      ingredientData?: IngredientLine[];
    });
export const coverageInput = z
  .object({
    shoppingDate: calendarDate,
    start: calendarDate,
    end: calendarDate,
  })
  .refine(
    (input) => input.start <= input.end,
    "The last meal date must follow the first.",
  )
  .refine(
    (input) => input.shoppingDate <= input.start,
    "Shop on or before the first meal date.",
  )
  .refine(
    (input) => Date.parse(input.end) - Date.parse(input.start) <= 31 * 86400000,
    "Choose up to 32 days per shop.",
  );
export type Coverage = z.infer<typeof coverageInput>;
export type Demand = {
  key: string;
  mealId: string;
  recipeId: string;
  title: string;
  text: string;
  /** Parse of the line at ×1. Older trips lack it. */
  parsed?: Ingredient | null;
  factor: number;
  servings: number;
};
export type Allocation = {
  key: string;
  itemId: string;
  factor: number;
  clearedBought?: true;
};
export type MealTrip = Coverage & {
  demands: Demand[];
  allocations: Allocation[];
};

export function mealIssues(meals: Meal[]) {
  const issues: { id: string; message: string }[] = [];
  for (const meal of meals) {
    if (meal.kind !== "leftovers") continue;
    const source = meals.find((entry) => entry.id === meal.sourceId);
    if (source?.kind !== "recipe") {
      issues.push({
        id: meal.id,
        message: "Choose a cooking session for these leftovers.",
      });
      continue;
    }
    if (source.date >= meal.date)
      issues.push({
        id: meal.id,
        message: `Move these leftovers after ${source.title} on ${source.date}.`,
      });
    const used = meals.reduce(
      (total, entry) =>
        total +
        (entry.kind === "leftovers" && entry.sourceId === source.id
          ? entry.portions
          : 0),
      0,
    );
    if (used > source.cook - source.eat)
      issues.push({
        id: meal.id,
        message: `${source.title} saves ${source.cook - source.eat} portions, but ${used} are planned as leftovers.`,
      });
  }
  return issues;
}

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
                      key: `${meal.id}:${position}`,
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
export function tripIsStale(meals: Meal[], trip: MealTrip) {
  const current = shoppingDemands(meals, trip);
  return (
    current.length !== trip.demands.length ||
    current.some((demand, index) => {
      const previous = trip.demands[index];
      return !previous || !sameDemand(demand, previous);
    })
  );
}
