import type { Meal } from "@prep-sheet/db/meal-planner";

/** Where a dragged meal was dropped: a day (move) or another meal (swap). */
export type DropTarget =
  | { kind: "day"; date: string }
  | { kind: "meal"; id: string };
export type MealMove = { id: string; from: string; to: string };

/** The date changes a drop makes; none when it changes nothing. */
export function dropMoves(
  meals: Meal[],
  activeId: string,
  target: DropTarget,
): MealMove[] {
  const active = meals.find((meal) => meal.id === activeId);
  if (!active) return [];
  if (target.kind === "day")
    return target.date === active.date
      ? []
      : [{ id: active.id, from: active.date, to: target.date }];
  const other = meals.find((meal) => meal.id === target.id);
  if (!other || other.id === active.id || other.date === active.date) return [];
  return [
    { id: active.id, from: active.date, to: other.date },
    { id: other.id, from: other.date, to: active.date },
  ];
}

export function undoMoves(moves: MealMove[]): MealMove[] {
  return moves.map(({ id, from, to }) => ({ id, from: to, to: from }));
}

export function withMoves<T extends { id: string; date: string }>(
  meals: T[],
  moves: MealMove[],
): T[] {
  return meals.map((meal) => {
    const move = moves.find((entry) => entry.id === meal.id);
    return move ? { ...meal, date: move.to } : meal;
  });
}
