import { createHash } from "node:crypto";
import {
  type Allocation,
  type Coverage,
  mealIssues,
} from "@prep-sheet/db/meal-planner";
import { shoppingItem, shoppingPlan } from "@prep-sheet/db/schema/shopping";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../households/access";
import { saveAisleList } from "./aisle-list";
import { type ShoppingTrip, shoppingDemands } from "./demands";
import { type Item, reconcile } from "./reconcile";
import { plannerRow, saveTrip } from "./store";

function conflict() {
  return new TRPCError({
    code: "CONFLICT",
    message:
      "Your plan or shopping list changed. Refresh and review it again before saving.",
  });
}

async function review(
  tx: Database,
  householdId: string,
  userId: string,
  coverage: Coverage,
) {
  const saved = await plannerRow(tx, householdId);
  const items = await tx
    .select()
    .from(shoppingItem)
    .where(eq(shoppingItem.householdId, householdId))
    .orderBy(shoppingItem.id);
  const demands = shoppingDemands(saved.meals, coverage);
  const meals = saved.meals.filter(
    (meal) => meal.date >= coverage.start && meal.date <= coverage.end,
  );
  const issues = mealIssues(saved.meals).filter((issue) =>
    meals.some((meal) => meal.id === issue.id),
  );
  const result = reconcile(items, demands, saved.trip, householdId, userId);
  // Applying checks nothing changed since this review.
  const token = createHash("sha256")
    .update(JSON.stringify({ saved, items, input: { coverage } }))
    .digest("hex");
  return { saved, demands, result, token, issues, meals };
}

/** What shopping for the covered meals would change on the list. */
export async function previewTrip(
  database: Database,
  householdId: string,
  userId: string,
  coverage: Coverage,
) {
  const { token, issues, meals, result } = await review(
    database,
    householdId,
    userId,
    coverage,
  );
  return {
    token,
    issues,
    meals,
    changes: result.changes,
    warnings: result.warnings,
  };
}

/** Apply a reviewed trip: update the list, save the trip, rebuild the aisle list. */
export async function applyTrip(
  tx: Database,
  householdId: string,
  userId: string,
  input: { coverage: Coverage; token: string },
) {
  const reviewed = await review(tx, householdId, userId, input.coverage);
  if (reviewed.token !== input.token) throw conflict();
  if (reviewed.issues.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Resolve the leftover warnings before generating this trip.",
    });
  const { removed, additions, allocations, retained } = reviewed.result;
  if (removed.length)
    await tx
      .delete(shoppingItem)
      .where(
        and(
          eq(shoppingItem.householdId, householdId),
          inArray(shoppingItem.id, removed),
        ),
      );
  if (additions.length) await tx.insert(shoppingItem).values(additions);
  await saveTrip(tx, reviewed.saved, {
    ...input.coverage,
    demands: reviewed.demands,
    allocations,
  });
  await saveAisleList(tx, householdId, [...retained, ...additions]);
}

/**
 * Unlink removed items from the trip. Bought amounts are remembered so a
 * later trip doesn't buy them again.
 */
async function forgetItems(
  tx: Database,
  householdId: string,
  items: Pick<Item, "id" | "status">[],
) {
  const status = new Map(items.map((item) => [item.id, item.status]));
  const saved = await plannerRow(tx, householdId);
  const trip = saved.trip;
  if (!trip?.allocations.some((allocation) => status.has(allocation.itemId)))
    return;
  const allocations = trip.allocations.flatMap((allocation): Allocation[] => {
    const removed = status.get(allocation.itemId);
    if (!removed) return [allocation];
    return removed === "bought" ? [{ ...allocation, clearedBought: true }] : [];
  });
  await saveTrip(tx, saved, { ...trip, allocations });
}

export async function removeListItem(
  tx: Database,
  householdId: string,
  id: string,
) {
  const removed = await tx
    .delete(shoppingItem)
    .where(
      and(eq(shoppingItem.id, id), eq(shoppingItem.householdId, householdId)),
    )
    .returning({ id: shoppingItem.id, status: shoppingItem.status });
  await forgetItems(tx, householdId, removed);
}

/** Clear bought items, or reset the list, the trip and the aisle list. */
export async function clearList(
  tx: Database,
  householdId: string,
  scope: "bought" | "all",
) {
  const removed = await tx
    .delete(shoppingItem)
    .where(
      and(
        eq(shoppingItem.householdId, householdId),
        scope === "bought" ? eq(shoppingItem.status, "bought") : undefined,
      ),
    )
    .returning({ id: shoppingItem.id, status: shoppingItem.status });
  if (scope === "bought") return forgetItems(tx, householdId, removed);
  await tx
    .delete(shoppingPlan)
    .where(eq(shoppingPlan.householdId, householdId));
  const saved = await plannerRow(tx, householdId);
  if (saved.trip) await saveTrip(tx, saved, null);
}

/** The planned meal each trip item is for. */
export async function plannedMeals(database: Database, householdId: string) {
  const { trip } = await plannerRow(database, householdId);
  const meals = new Map(trip?.demands.map((demand) => [demand.key, demand]));
  return new Map(
    trip?.allocations.flatMap((allocation) => {
      const mealId = meals.get(allocation.key)?.mealId;
      return mealId ? [[allocation.itemId, mealId] as const] : [];
    }),
  );
}

export type { ShoppingTrip };
