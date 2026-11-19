import { mealPlanner } from "@prep-sheet/db/schema/meal-planner";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { Database } from "../../households/access";
import { type ShoppingTrip, tripIsStale } from "./demands";

export async function plannerRow(tx: Database, householdId: string) {
  const [saved] = await tx
    .select()
    .from(mealPlanner)
    .where(eq(mealPlanner.householdId, householdId));
  return saved ?? { householdId, meals: [], revision: 0, trip: null };
}
type PlannerRow = Awaited<ReturnType<typeof plannerRow>>;

/** The one trip write: every change bumps the planner revision. */
export async function saveTrip(
  tx: Database,
  saved: PlannerRow,
  trip: ShoppingTrip | null,
) {
  const next = { ...saved, trip, revision: saved.revision + 1 };
  await tx
    .insert(mealPlanner)
    .values(next)
    .onConflictDoUpdate({ target: mealPlanner.householdId, set: next });
}

/** Block aisle-list writes until meal changes are reviewed. */
export async function requireCurrentTrip(tx: Database, householdId: string) {
  const saved = await plannerRow(tx, householdId);
  if (tripIsStale(saved.meals, saved.trip))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your meals have changed. Review meal-plan changes before updating or checking off this trip.",
    });
}
