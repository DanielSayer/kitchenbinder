import type { Database } from "../households/access";
import { importCounts } from "../imports";
import {
  accountPlan,
  lockAccount,
  requireRecipeRoom,
  savedRecipeCount,
} from "./usage";

// Plan rules applied to counts the import module owns. Import admission runs
// the same rules itself, so the import module never depends on this file.

export async function usageSummary(tx: Database, userId: string) {
  const plan = await accountPlan(tx, userId);
  const { aiAttempts } = await importCounts(tx, userId, plan);
  const saved = await savedRecipeCount(tx, userId);
  return { ...plan, used: aiAttempts, saved };
}

// Caller holds the account lock until its insert or restore commits.
export async function checkRecipeCapacity(tx: Database, userId: string) {
  await lockAccount(tx, userId);
  const plan = await accountPlan(tx, userId);
  if (plan.recipes === null) return;
  const { inFlight } = await importCounts(tx, userId, plan);
  requireRecipeRoom(plan, await savedRecipeCount(tx, userId), inFlight);
}
