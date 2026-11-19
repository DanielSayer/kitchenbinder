import { z } from "zod";
import type { Ingredient, IngredientLine } from "./ingredient-line";

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
