import type { AppRouter } from "@prep-sheet/api/routers/index";
import {
  combinedQuantity,
  groceryGroup,
  shoppingCategories,
} from "@prep-sheet/db/shopping-plan";
import type { MeasurePreferences } from "@prep-sheet/db/units";
import type { inferRouterOutputs } from "@trpc/server";

export type Item = inferRouterOutputs<AppRouter>["shopping"]["list"][number];
export type Status = Item["status"];
export type Mode = "aisle" | "recipe";
/** A list row: one line, or lines of one item that add up, with their total. */
export type Entry =
  | { item: Item }
  | { key: string; name: string; quantity: string; items: Item[] };

export function shoppingGroups(
  needed: Item[],
  mode: Mode,
  measures: MeasurePreferences,
) {
  return mode === "aisle"
    ? shoppingCategories.flatMap((category) => {
        const lines = needed.flatMap((item) => {
          const group = groceryGroup(item.text, item.ingredient);
          return group.category === category ? [{ item, group }] : [];
        });
        const byKey = new Map<string, Item[]>();
        for (const { item, group } of lines)
          if (group.key)
            byKey.set(group.key, [...(byKey.get(group.key) ?? []), item]);
        const entries: Entry[] = [];
        const placed = new Set<string>();
        for (const { item, group } of lines) {
          const same = group.key ? (byKey.get(group.key) ?? []) : [];
          const quantity =
            same.length > 1 ? combinedQuantity(same, measures) : null;
          if (!group.key || !quantity) entries.push({ item });
          else if (!placed.has(group.key)) {
            placed.add(group.key);
            entries.push({
              key: group.key,
              name: group.name,
              quantity,
              items: same,
            });
          }
        }
        return entries.length
          ? [{ key: category, title: category, category, entries }]
          : [];
      })
    : [
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
