import { randomUUID } from "node:crypto";
import { scaleLine } from "@prep-sheet/db/ingredient-line";
import type { Allocation, Demand } from "@prep-sheet/db/meal-planner";
import type { shoppingItem } from "@prep-sheet/db/schema/shopping";
import { checkCapacity } from "./capacity";
import { type ShoppingTrip, sameDemand } from "./demands";

export type Item = typeof shoppingItem.$inferSelect;
type ItemWrite = typeof shoppingItem.$inferInsert;
export type Change = {
  kind: "add" | "remove" | "change" | "keep";
  title: string;
  before: string | null;
  after: string | null;
};

/**
 * Map the demands onto the list: keep what still covers them, remove
 * needed lines no longer wanted and add the missing amounts. Bought and
 * owned lines are never removed. Pure apart from new item ids.
 */
export function reconcile(
  items: Item[],
  demands: Demand[],
  trip: ShoppingTrip | null,
  householdId: string,
  userId: string,
) {
  const removed: string[] = [];
  const additions: ItemWrite[] = [];
  const allocations: Allocation[] = [];
  const changes: Change[] = [];
  const warnings = new Set<string>();
  const previous = new Map(trip?.demands.map((demand) => [demand.key, demand]));
  const byId = new Map(items.map((item) => [item.id, item]));
  const activeKeys = new Set(demands.map((demand) => demand.key));
  const remove = (item: Item) => {
    removed.push(item.id);
    changes.push({
      kind: "remove",
      title: item.recipeTitle ?? "Recipe",
      before: item.text,
      after: null,
    });
  };
  for (const item of items) {
    const allocation = trip?.allocations.find(
      (entry) => entry.itemId === item.id,
    );
    // The first trip replaces recipe lines still needed; the rest stay unlinked.
    if (!trip && item.recipeId && item.status === "needed") remove(item);
    else if (allocation && !activeKeys.has(allocation.key)) {
      if (item.status === "needed") remove(item);
      else
        changes.push({
          kind: "keep",
          title: item.recipeTitle ?? "Recipe",
          before: item.text,
          after: `Kept as ${item.status === "owned" ? "already owned" : "bought"}; no longer needed for these meals.`,
        });
    }
  }
  for (const demand of demands) {
    const old = previous.get(demand.key);
    const sameLine =
      old?.text === demand.text && old.recipeId === demand.recipeId;
    const linked =
      trip?.allocations.filter((allocation) => allocation.key === demand.key) ??
      [];
    const cleared = sameLine
      ? linked.filter((allocation) => allocation.clearedBought)
      : [];
    allocations.push(...cleared);
    const existing = linked.flatMap((allocation) => {
      const item = byId.get(allocation.itemId);
      return item ? [{ allocation, item }] : [];
    });
    if (old && sameDemand(demand, old)) {
      allocations.push(...existing.map(({ allocation }) => allocation));
      continue;
    }
    let covered = cleared.reduce(
      (total, allocation) => total + allocation.factor,
      0,
    );
    for (const { allocation, item } of existing) {
      if (item.status !== "needed") {
        if (sameLine) {
          covered += allocation.factor;
          allocations.push(allocation);
        }
        changes.push({
          kind: "keep",
          title: demand.title,
          before: item.text,
          after: `Keep ${item.status === "owned" ? "already owned" : "bought"} quantity.`,
        });
      } else removed.push(item.id);
    }
    const replaced =
      existing
        .filter(({ item }) => item.status === "needed")
        .map(({ item }) => item.text)
        .join("; ") || null;
    const remaining = Math.max(0, demand.factor - covered);
    if (remaining > 0.000001) {
      const scaled = scaleLine(
        { text: demand.text, parsed: demand.parsed ?? null },
        remaining,
      );
      if (scaled.uncertain) warnings.add(`${demand.title}: ${scaled.text}`);
      const id = randomUUID();
      additions.push({
        id,
        householdId,
        addedBy: userId,
        text: scaled.text,
        ingredient: scaled.ingredient,
        recipeId: demand.recipeId,
        recipeTitle: demand.title,
        servings: `${demand.servings} servings planned`,
        position: additions.length,
      });
      allocations.push({ key: demand.key, itemId: id, factor: remaining });
      changes.push({
        kind: old ? "change" : "add",
        title: demand.title,
        before: replaced,
        after: scaled.text,
      });
    } else if (replaced) {
      changes.push({
        kind: "remove",
        title: demand.title,
        before: replaced,
        after: "Covered by bought or already-owned quantities.",
      });
    }
  }
  // Unlinked groceries, including manual edits/additions, are kept on updates.
  const retained = items.filter((item) => !removed.includes(item.id));
  checkCapacity(retained.length + additions.length, "trip");
  return {
    removed,
    additions,
    allocations,
    changes: changes.sort(
      (a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind),
    ),
    warnings: [...warnings],
    retained,
  };
}
