import { describe, expect, it } from "vitest";
import {
  coverageInput,
  type Meal,
  mealIssues,
  scaleIngredient,
  shoppingDemands,
  tripIsStale,
} from "./meal-planner";

const curry: Extract<Meal, { kind: "recipe" }> = {
  id: "curry",
  kind: "recipe",
  date: "2026-09-21",
  slot: "Dinner",
  recipeId: "recipe",
  title: "Curry",
  baseServings: 2,
  cook: 4,
  eat: 2,
  ingredients: ["200 g rice", "½ tsp salt"],
};
const coverage = {
  shoppingDate: "2026-09-19",
  start: "2026-09-20",
  end: "2026-09-25",
};
describe("meal planning rules", () => {
  it("counts each cooking session once and excludes leftovers and eating out", () => {
    const meals: Meal[] = [
      curry,
      { ...curry, id: "second", date: "2026-09-23" },
      {
        id: "leftover",
        date: "2026-09-22",
        slot: "Lunch",
        kind: "leftovers",
        sourceId: curry.id,
        portions: 2,
      },
      {
        id: "out",
        date: "2026-09-24",
        slot: "",
        kind: "out",
        description: "Dinner",
      },
    ];
    const demands = shoppingDemands(meals, coverage);
    expect(demands).toHaveLength(4);
    expect(demands.map((demand) => demand.key)).toEqual([
      "curry:0",
      "curry:1",
      "second:0",
      "second:1",
    ]);
    expect(demands.every((demand) => demand.factor === 2)).toBe(true);
  });
  it("only marks shopping stale for ingredient-affecting changes", () => {
    const trip = {
      ...coverage,
      demands: shoppingDemands([curry], coverage),
      allocations: [],
    };
    expect(
      tripIsStale(
        [{ ...curry, date: "2026-09-23", slot: "Lunch", eat: 3 }],
        trip,
      ),
    ).toBe(false);
    expect(tripIsStale([{ ...curry, cook: 6 }], trip)).toBe(true);
    expect(tripIsStale([{ ...curry, date: "2026-09-26" }], trip)).toBe(true);
    expect(tripIsStale([], trip)).toBe(true);
  });
  it("flags missing, early and over-allocated leftovers across dates", () => {
    const leftover: Meal = {
      id: "left",
      kind: "leftovers",
      sourceId: curry.id,
      date: "2026-09-22",
      slot: "Lunch",
      portions: 2,
    };
    expect(mealIssues([curry, leftover])).toEqual([]);
    expect(mealIssues([leftover])[0]?.message).toContain(
      "Choose a cooking session",
    );
    expect(
      mealIssues([curry, { ...leftover, date: curry.date }])[0]?.message,
    ).toContain("Move these leftovers");
    expect(
      mealIssues([
        curry,
        leftover,
        { ...leftover, id: "more", date: "2026-09-23" },
      ]),
    ).toHaveLength(2);
  });
  it.each([
    ["200 g rice", 2, "400 g rice"],
    ["½ tsp salt", 2, "1 tsp salt"],
    ["1 1/2 cups flour", 2, "3 cups flour"],
    ["1½ cups flour", 0.5, "0.75 cups flour"],
    ["2 x 400 g tins", 2, "4 x 400 g tins"],
  ])(
    "scales %s without altering the ingredient or pack size",
    (text, factor, expected) => {
      expect(scaleIngredient(String(text), Number(factor))).toEqual({
        text: expected,
        uncertain: false,
      });
    },
  );
  it("flags ranges and unspecified amounts instead of guessing", () => {
    expect(scaleIngredient("1-2 onions", 2).uncertain).toBe(true);
    expect(scaleIngredient("Salt to taste", 2).uncertain).toBe(true);
    expect(scaleIngredient("1/0 cup flour", 2).uncertain).toBe(true);
    expect(scaleIngredient("1,000 g rice", 2)).toEqual({
      text: "2000 g rice",
      uncertain: false,
    });
    expect(scaleIngredient("Salt to taste", 1)).toEqual({
      text: "Salt to taste",
      uncertain: false,
    });
  });
  it("validates real dates and shopping coverage", () => {
    expect(coverageInput.safeParse(coverage).success).toBe(true);
    expect(
      coverageInput.safeParse({ ...coverage, start: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      coverageInput.safeParse({ ...coverage, shoppingDate: "2026-09-23" })
        .success,
    ).toBe(false);
    expect(
      coverageInput.safeParse({ ...coverage, end: "2026-11-01" }).success,
    ).toBe(false);
  });
});
