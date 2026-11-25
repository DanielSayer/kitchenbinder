import { calendarDate, type Meal } from "@prep-sheet/db/meal-planner";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type Database, resolveHousehold } from "../households/access";
import { conflict, saveState, state } from "./state";

export const moveMealsInput = z.object({
  // Omitted householdId = the caller's personal household.
  householdId: z.uuid().optional(),
  /** Applied together: a swap is two moves. */
  moves: z
    .array(z.object({ id: z.uuid(), from: calendarDate, to: calendarDate }))
    .min(1)
    .max(50)
    .refine(
      (moves) => new Set(moves.map((move) => move.id)).size === moves.length,
      "Move each meal once.",
    ),
});
export type MoveMealsInput = z.input<typeof moveMealsInput>;
export type MealMove = z.output<typeof moveMealsInput>["moves"][number];

/**
 * Meals with the moves applied, in date order. Each meal must still be on its
 * `from` date, so a move made from an outdated plan fails instead of guessing.
 */
export function movedMeals(meals: Meal[], moves: MealMove[]) {
  const byId = new Map(moves.map((move) => [move.id, move]));
  const found = new Set<string>();
  const next = meals.map((meal) => {
    const move = byId.get(meal.id);
    if (!move) return meal;
    found.add(meal.id);
    if (meal.date !== move.from) throw conflict();
    return { ...meal, date: move.to };
  });
  if (found.size !== moves.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That meal was removed. Refresh your plan and try again.",
    });
  return next.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}

/**
 * Changes only the dates of meals, without a revision: other edits made in the
 * meantime are kept. Slots, servings and leftover links are unchanged.
 */
export async function moveMeals(
  tx: Database,
  userId: string,
  input: z.output<typeof moveMealsInput>,
) {
  const householdId = await resolveHousehold(tx, userId, input.householdId, {
    lock: true,
  });
  const saved = await state(tx, householdId);
  const meals = movedMeals(saved.meals, input.moves);
  const revision = saved.revision + 1;
  await saveState(tx, { ...saved, meals, revision });
  return { revision };
}
