import { z } from "zod";

export const calendarDate = z.iso
  .date()
  .refine(
    (value) => value >= "2000-01-01" && value <= "2100-12-31",
    "Choose a date between 2000 and 2100.",
  );
const portions = z.number().int().min(1).max(100);
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
        ? meal.ingredients.map((text, position) => ({
            key: `${meal.id}:${position}`,
            mealId: meal.id,
            recipeId: meal.recipeId,
            title: meal.title,
            text,
            factor: meal.cook / meal.baseServings,
            servings: meal.cook,
          }))
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

const fractions: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};
export function scaleIngredient(
  text: string,
  factor: number,
): { text: string; uncertain: boolean } {
  if (Math.abs(factor - 1) < 0.000001) return { text, uncertain: false };
  const match = text.match(
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?\s*[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(.*)$/,
  );
  if (!match?.[1] || !match[2] || /^(?:[-–,./]|to\b|or\b)/i.test(match[2])) {
    return {
      text: `${text} [check quantity for ×${Number(factor.toFixed(3))} recipe]`,
      uncertain: true,
    };
  }
  const amount = match[1].trim();
  let quantity = 0;
  if (amount.includes("/")) {
    const parts = amount.split(/[\s/]+/).map(Number);
    quantity =
      parts.length === 3
        ? (parts[0] ?? 0) + (parts[1] ?? 0) / (parts[2] ?? 1)
        : (parts[0] ?? 0) / (parts[1] ?? 1);
  } else {
    const fraction = Object.entries(fractions).find(([symbol]) =>
      amount.includes(symbol),
    );
    quantity = fraction
      ? Number(amount.replace(fraction[0], "").trim() || 0) + fraction[1]
      : Number(amount);
  }
  if (!Number.isFinite(quantity) || quantity <= 0)
    return {
      text: `${text} [check quantity for ×${Number(factor.toFixed(3))} recipe]`,
      uncertain: true,
    };
  return {
    text: `${Number((quantity * factor).toFixed(3))} ${match[2]}`,
    uncertain: false,
  };
}
