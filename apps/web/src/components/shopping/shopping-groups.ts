import type { AppRouter } from "@prep-sheet/api/routers/index";
import { aisleGroups, shoppingCategories } from "@prep-sheet/db/shopping-plan";
import type { MeasurePreferences } from "@prep-sheet/db/units";
import type { inferRouterOutputs } from "@trpc/server";

export type Item = inferRouterOutputs<AppRouter>["shopping"]["list"][number];
export type Status = Item["status"];
export type Mode = "aisle" | "recipe";
/** A list row: one line, or lines of one item that add up, with their total. */
export type Entry =
  | { item: Item }
  | { key: string; name: string; quantity: string | null; items: Item[] };

export function shoppingGroups(
  needed: Item[],
  mode: Mode,
  measures: MeasurePreferences,
) {
  if (mode === "aisle") {
    const groups = aisleGroups(needed, measures);
    return shoppingCategories.flatMap((category) => {
      const entries = groups.flatMap(
        ({ category: aisle, ...group }): Entry[] =>
          aisle !== category
            ? []
            : group.items.length > 1
              ? [group]
              : group.items.map((item) => ({ item })),
      );
      return entries.length
        ? [{ key: category, title: category, category, entries }]
        : [];
    });
  }
  return [
    ...needed
      .reduce((map, item) => {
        const key = item.plannedMealId ?? item.recipeId ?? "other";
        map.set(key, [...(map.get(key) ?? []), item]);
        return map;
      }, new Map<string, Item[]>())
      .entries(),
  ].map(([key, entries]) => ({
    key,
    title: entries[0]?.recipeTitle ?? "Other groceries",
    category: undefined,
    entries: entries.map((item): Entry => ({ item })),
  }));
}
