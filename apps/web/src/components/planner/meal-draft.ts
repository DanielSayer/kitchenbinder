import { type MealInput, mealInput } from "@prep-sheet/db/meal-planner";
import { z } from "zod";

export const mealDraftSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  slot: z.enum(["", "Breakfast", "Lunch", "Dinner"]),
  kind: z.enum(["recipe", "leftovers", "out"]),
  recipeId: z.string(),
  baseServings: z.string(),
  cook: z.string(),
  eat: z.string(),
  sourceId: z.string(),
  portions: z.string(),
  description: z.string(),
});
export type MealDraft = z.infer<typeof mealDraftSchema>;
const baselineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({
    kind: z.literal("known"),
    revision: z.number().int().nonnegative(),
    meal: mealInput.nullable(),
  }),
]);
export type MealBaseline = z.infer<typeof baselineSchema>;
const storedDraftSchema = z.object({
  version: z.literal(2),
  fields: mealDraftSchema,
  base: baselineSchema,
  legacySource: z.string().nullable().default(null),
});
export type StoredMealDraft = z.infer<typeof storedDraftSchema>;

export function initialMealDraft(
  date: string,
  meal?: MealInput,
  recipeId?: string,
): MealDraft {
  return {
    id: meal?.id ?? crypto.randomUUID(),
    date: meal?.date ?? date,
    slot: meal?.slot ?? "",
    kind: meal?.kind ?? "recipe",
    recipeId: meal?.kind === "recipe" ? meal.recipeId : (recipeId ?? ""),
    baseServings: meal?.kind === "recipe" ? String(meal.baseServings) : "",
    cook: meal?.kind === "recipe" ? String(meal.cook) : "2",
    eat: meal?.kind === "recipe" ? String(meal.eat) : "2",
    sourceId: meal?.kind === "leftovers" ? meal.sourceId : "",
    portions: meal?.kind === "leftovers" ? String(meal.portions) : "2",
    description: meal?.kind === "out" ? meal.description : "",
  };
}

export function readMealDraft(key: string): StoredMealDraft | null {
  try {
    // Active drafts belong to a tab. Another tab's save must not clear this one.
    const active = sessionStorage.getItem(key);
    const legacySource = active === null ? localStorage.getItem(key) : null;
    const value: unknown = JSON.parse(active ?? legacySource ?? "null");
    const current = storedDraftSchema.safeParse(value);
    if (current.success)
      return {
        ...current.data,
        legacySource: legacySource ?? current.data.legacySource,
      };
    const legacy = mealDraftSchema.safeParse(value);
    return legacy.success
      ? {
          version: 2,
          fields: legacy.data,
          base: { kind: "unknown" },
          legacySource,
        }
      : null;
  } catch {
    return null;
  }
}

export function parseMealDraft(draft: MealDraft) {
  const common = { id: draft.id, date: draft.date, slot: draft.slot };
  return mealInput.safeParse(
    draft.kind === "recipe"
      ? {
          ...common,
          kind: "recipe",
          recipeId: draft.recipeId,
          baseServings: Number(draft.baseServings),
          cook: Number(draft.cook),
          eat: Number(draft.eat),
        }
      : draft.kind === "leftovers"
        ? {
            ...common,
            kind: "leftovers",
            sourceId: draft.sourceId,
            portions: Number(draft.portions),
          }
        : { ...common, kind: "out", description: draft.description },
  );
}

const recipeFields = ["recipeId", "baseServings", "cook", "eat"] as const;
const leftoverFields = ["sourceId", "portions"] as const;
const outFields = ["description"] as const;
export const mealFieldLabels = {
  date: "Date",
  slot: "Meal time",
  recipeId: "Recipe",
  baseServings: "Original servings",
  cook: "Cook",
  eat: "Eat now",
  sourceId: "Leftovers source",
  portions: "Portions to use",
  description: "Description",
  details: "Meal and portions",
  deleted: "Deleted meal",
};
export type MealConflict = keyof typeof mealFieldLabels;
function detailFields(draft: MealDraft) {
  return draft.kind === "recipe"
    ? recipeFields
    : draft.kind === "leftovers"
      ? leftoverFields
      : outFields;
}
function details(draft: MealDraft) {
  return JSON.stringify([
    draft.kind,
    ...detailFields(draft).map((field) => draft[field]),
  ]);
}
export function conflictValue(
  draft: MealDraft,
  field: MealConflict,
  names: { recipe: string; source: string },
) {
  const value = (name: keyof MealDraft) =>
    name === "recipeId"
      ? names.recipe
      : name === "sourceId"
        ? names.source
        : draft[name] || "Empty";
  return field === "deleted"
    ? "Recreate this meal"
    : field === "details"
      ? `${draft.kind === "out" ? "Eating out" : draft.kind === "recipe" ? "Recipe" : "Leftovers"}: ${detailFields(
          draft,
        )
          .map((name) => `${mealFieldLabels[name]}: ${value(name)}`)
          .join(", ")}`
      : value(field);
}
export function applySavedMealField(
  mine: MealDraft,
  saved: MealDraft,
  field: MealConflict,
): MealDraft {
  if (field === "deleted") return mine;
  if (field === "details")
    return { ...saved, date: mine.date, slot: mine.slot };
  return { ...mine, [field]: saved[field] };
}
export function mergeMealDraft(
  base: MealBaseline,
  mine: MealDraft,
  saved: MealInput | null,
) {
  let merged = { ...mine };
  const conflicts: MealConflict[] = [];
  if (!saved) {
    if (base.kind === "unknown" || base.meal !== null)
      conflicts.push("deleted");
    return { merged, conflicts };
  }
  const fresh = initialMealDraft(saved.date, saved);
  const original =
    base.kind === "known" && base.meal
      ? initialMealDraft(base.meal.date, base.meal)
      : null;
  for (const field of ["date", "slot"] as const) {
    if (mine[field] === fresh[field]) continue;
    if (original && mine[field] === original[field])
      merged = { ...merged, [field]: fresh[field] };
    else if (!original || fresh[field] !== original[field])
      conflicts.push(field);
  }
  if (mine.kind !== fresh.kind) {
    if (original && details(mine) === details(original))
      merged = applySavedMealField(merged, fresh, "details");
    else if (!original || details(fresh) !== details(original))
      conflicts.push("details");
  } else {
    for (const field of detailFields(mine)) {
      if (mine[field] === fresh[field]) continue;
      if (original?.kind === mine.kind && mine[field] === original[field])
        merged = { ...merged, [field]: fresh[field] };
      else if (
        !original ||
        original.kind !== mine.kind ||
        fresh[field] !== original[field]
      )
        conflicts.push(field);
    }
  }
  return { merged, conflicts };
}
