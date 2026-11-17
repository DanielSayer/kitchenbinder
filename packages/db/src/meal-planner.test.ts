import { describe, expect, it } from "vitest";
import {
  coverageInput,
  type Meal,
  mealIssues,
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
  it("leaves ingredient headings off the shopping list", () => {
    const demands = shoppingDemands(
      [{ ...curry, ingredients: ["For the rice:", "200 g rice"] }],
      coverage,
    );
    expect(demands.map((demand) => [demand.key, demand.text])).toEqual([
      ["curry:1", "200 g rice"],
    ]);
  });
  it("uses the snapshot's line parses, falling back to the code parser", () => {
    const [rice, salt] = shoppingDemands(
      [
        {
          ...curry,
          ingredients: ["Sauce", "200 g rice", "½ tsp salt"],
          ingredientData: [
            { text: "Sauce", heading: true, parsed: null, source: "ai" },
            {
              text: "200 g rice",
              heading: false,
              parsed: {
                quantity: 200,
                quantityMax: null,
                unit: "g",
                size: null,
                item: "basmati rice",
                detail: null,
                optional: false,
              },
              source: "ai",
            },
          ],
        },
      ],
      coverage,
    );
    expect(rice?.parsed?.item).toBe("basmati rice");
    expect(salt).toMatchObject({
      text: "½ tsp salt",
      parsed: { item: "salt" },
    });
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
