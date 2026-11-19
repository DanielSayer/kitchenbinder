import { describe, expect, it } from "vitest";
import { coverageInput, type Meal, mealIssues } from "./meal-planner";

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
