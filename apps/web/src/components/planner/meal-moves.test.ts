import type { Meal } from "@prep-sheet/db/meal-planner";
import { describe, expect, it } from "vitest";
import { dropMoves, undoMoves, withMoves } from "./meal-moves";

const note = (id: string, date: string): Meal => ({
  id,
  kind: "out",
  date,
  slot: "Dinner",
  description: id,
});
const meals = [
  note("dal", "2026-10-29"),
  note("salmon", "2026-10-28"),
  note("tacos", "2026-10-29"),
];

describe("dropMoves", () => {
  it("moves a meal onto another day, past days included", () => {
    expect(
      dropMoves(meals, "dal", { kind: "day", date: "2026-10-26" }),
    ).toEqual([{ id: "dal", from: "2026-10-29", to: "2026-10-26" }]);
  });

  it("swaps with a meal on another day", () => {
    expect(dropMoves(meals, "dal", { kind: "meal", id: "salmon" })).toEqual([
      { id: "dal", from: "2026-10-29", to: "2026-10-28" },
      { id: "salmon", from: "2026-10-28", to: "2026-10-29" },
    ]);
  });

  it("does nothing on its own day, itself or a meal on the same day", () => {
    expect(
      dropMoves(meals, "dal", { kind: "day", date: "2026-10-29" }),
    ).toEqual([]);
    expect(dropMoves(meals, "dal", { kind: "meal", id: "dal" })).toEqual([]);
    expect(dropMoves(meals, "dal", { kind: "meal", id: "tacos" })).toEqual([]);
    expect(dropMoves(meals, "gone", { kind: "meal", id: "dal" })).toEqual([]);
  });
});

describe("undoMoves and withMoves", () => {
  it("reverses and applies moves", () => {
    const moves = dropMoves(meals, "dal", { kind: "meal", id: "salmon" });
    const moved = withMoves(meals, moves);
    expect(moved.map((meal) => meal.date)).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-29",
    ]);
    expect(withMoves(moved, undoMoves(moves))).toEqual(meals);
  });
});
