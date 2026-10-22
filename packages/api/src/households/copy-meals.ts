import { createHash } from "node:crypto";
import type { Meal } from "@prep-sheet/db/meal-planner";
import { TRPCError } from "@trpc/server";

function copyId(namespace: string, id: string) {
  const hex = createHash("sha256").update(`${namespace}:${id}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function copyMeals(
  source: Meal[],
  destination: Meal[],
  from: string,
  namespace: string,
) {
  const selected = source.filter((meal) => meal.date >= from);
  const required = new Set(
    selected.flatMap((meal) =>
      meal.kind === "leftovers" ? [meal.sourceId] : [],
    ),
  );
  // Include earlier cooking sessions needed by upcoming leftovers.
  const candidates = source.filter(
    (meal) => meal.date >= from || required.has(meal.id),
  );
  const existing = new Set(destination.map((meal) => meal.id));
  const additions = candidates.flatMap((meal): Meal[] => {
    const id = copyId(namespace, meal.id);
    if (existing.has(id)) return [];
    return [
      {
        ...meal,
        id,
        ...(meal.kind === "leftovers"
          ? { sourceId: copyId(namespace, meal.sourceId) }
          : {}),
      },
    ];
  });
  if (destination.length + additions.length > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "These meals would exceed the planner's 1,000-meal limit. Remove older meals first.",
    });
  return {
    meals: [...destination, ...additions].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    ),
    copied: additions.length,
  };
}
