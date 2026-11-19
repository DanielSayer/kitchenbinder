import { randomUUID } from "node:crypto";
import { shoppingItem, shoppingPlan } from "@prep-sheet/db/schema/shopping";
import {
  generateShoppingPlan,
  type ShoppingPlan,
} from "@prep-sheet/db/shopping-plan";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../households/access";
import type { Item } from "./reconcile";
import { requireCurrentTrip } from "./store";

/** Stored as `shopping_plan.content`. */
export type AisleList = ShoppingPlan;
type AisleListRow = typeof shoppingPlan.$inferSelect;
type ListItem = Pick<Item, "id" | "text"> &
  Partial<Pick<Item, "ingredient" | "status">>;

/** Build the aisle list from every item not already owned, and store it. */
export async function saveAisleList(
  tx: Database,
  householdId: string,
  items: ListItem[],
) {
  const sources = items.filter((item) => item.status !== "owned");
  const saved = {
    id: randomUUID(),
    householdId,
    content: generateShoppingPlan(sources),
    sources: sources.map(({ id, text }) => ({ id, text })),
    generatedAt: new Date(),
  };
  await tx
    .insert(shoppingPlan)
    .values(saved)
    .onConflictDoUpdate({ target: shoppingPlan.householdId, set: saved });
  return saved.id;
}

/** Whether items changed since the aisle list was built. */
function aisleListIsStale(list: AisleListRow, items: Item[]) {
  const current = new Map(items.map((item) => [item.id, item]));
  const sources = new Set(list.sources.map((source) => source.id));
  return (
    list.sources.some((source) => {
      const item = current.get(source.id);
      return !item || item.text !== source.text || item.status === "owned";
    }) ||
    items.some((item) => item.status === "needed" && !sources.has(item.id))
  );
}

export async function generateAisleList(tx: Database, householdId: string) {
  await requireCurrentTrip(tx, householdId);
  const items = await tx
    .select()
    .from(shoppingItem)
    .where(eq(shoppingItem.householdId, householdId))
    .for("update");
  if (!items.some((item) => item.status === "needed"))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Add some items you still need before generating a list.",
    });
  return { id: await saveAisleList(tx, householdId, items) };
}

export async function aisleList(database: Database, householdId: string) {
  const [list] = await database
    .select()
    .from(shoppingPlan)
    .where(eq(shoppingPlan.householdId, householdId));
  if (!list) return null;
  const items = await database
    .select()
    .from(shoppingItem)
    .where(eq(shoppingItem.householdId, householdId));
  return { ...list, items, stale: aisleListIsStale(list, items) };
}

/** Tick or untick every line of one aisle group. */
export async function checkAisleGroup(
  tx: Database,
  householdId: string,
  input: { planId: string; groupIndex: number; bought: boolean },
) {
  await requireCurrentTrip(tx, householdId);
  const [list] = await tx
    .select()
    .from(shoppingPlan)
    .where(
      and(
        eq(shoppingPlan.householdId, householdId),
        eq(shoppingPlan.id, input.planId),
      ),
    );
  const selected = list?.content.groups[input.groupIndex];
  if (!list || !selected)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This generated list has changed. Refresh the page to continue.",
    });
  const items = await tx
    .select()
    .from(shoppingItem)
    .where(eq(shoppingItem.householdId, householdId))
    .for("update");
  if (aisleListIsStale(list, items))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your ingredients have changed. Generate the list again before checking off items.",
    });
  await tx
    .update(shoppingItem)
    .set({ status: input.bought ? "bought" : "needed" })
    .where(
      and(
        eq(shoppingItem.householdId, householdId),
        inArray(shoppingItem.id, selected.itemIds),
      ),
    );
}
