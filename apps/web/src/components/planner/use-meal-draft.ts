import { type Meal, mealInput } from "@prep-sheet/db/meal-planner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTRPC } from "@/utils/trpc";
import {
  applySavedMealField,
  initialMealDraft,
  type MealBaseline,
  type MealConflict,
  type MealDraft,
  mergeMealDraft,
  parseMealDraft,
  readMealDraft,
  type StoredMealDraft,
} from "./meal-draft";
import {
  initialMealEditor,
  type MealReview,
  mealEditorReducer,
} from "./meal-editor-state";

export function useMealDraft({
  date,
  meal,
  recipeId,
  duplicate,
  storageKey: key,
  householdId,
  onClose,
}: {
  date: string;
  meal?: Meal;
  recipeId?: string;
  duplicate: boolean;
  storageKey: string;
  householdId?: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const planner = useQuery(trpc.planner.get.queryOptions({ householdId }));
  const editing = Boolean(meal) && !duplicate;
  const [state, dispatch] = useReducer(mealEditorReducer, undefined, () => {
    const restored = readMealDraft(key);
    if (restored)
      return initialMealEditor(restored, Boolean(meal) || Boolean(recipeId));
    const current =
      !duplicate && meal
        ? (planner.data?.meals.find((entry) => entry.id === meal.id) ?? meal)
        : undefined;
    const initial = initialMealDraft(date, current, recipeId);
    const stored: StoredMealDraft = {
      version: 2,
      legacySource: null,
      fields: duplicate
        ? {
            ...initialMealDraft(date, meal, recipeId),
            id: crypto.randomUUID(),
            date,
          }
        : initial,
      base:
        !duplicate && meal
          ? planner.data
            ? {
                kind: "known",
                revision: planner.data.revision,
                meal: mealInput.parse(current),
              }
            : { kind: "unknown" }
          : {
              kind: "known",
              revision: planner.data?.revision ?? 0,
              meal: null,
            },
    };
    return initialMealEditor(stored, Boolean(meal) || Boolean(recipeId));
  });
  const { stored, review, query, detailsOpen, busy, error } = state;
  const draft = stored.fields;
  const saving = useRef(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const set = (values: Partial<MealDraft>) =>
    dispatch({ type: "change", values });
  const setDetailsOpen = useCallback(
    (open: boolean) => dispatch({ type: "details", open }),
    [],
  );
  const initialiseServings = useCallback(
    (servings: string, editing: boolean) =>
      dispatch({ type: "servings", servings, editing }),
    [],
  );
  const setReview = (review: MealReview | null) =>
    dispatch({ type: "review", review });
  const chooseConflict = (field: MealConflict, choice: "mine" | "saved") =>
    dispatch({ type: "choose", field, choice });
  const typeSearch = (text: string) => dispatch({ type: "search", text });
  const changeNote = (text: string) => dispatch({ type: "note", text });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(stored));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [stored, key]);
  useEffect(() => {
    if (!storageFailed) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [storageFailed]);
  const discard = () => {
    try {
      sessionStorage.removeItem(key);
      if (
        stored.legacySource !== null &&
        localStorage.getItem(key) === stored.legacySource
      )
        localStorage.removeItem(key);
    } catch {
      /* Optional storage. */
    }
    onClose();
  };
  const save = useMutation(
    trpc.planner.save.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
          client.invalidateQueries({ queryKey: trpc.shopping.pathKey() }),
        ]);
        discard();
      },
    }),
  );
  const close = () => {
    if (saving.current || save.isPending) return;
    if (
      storageFailed &&
      !window.confirm(
        "This draft could not be stored. Close and lose these changes?",
      )
    )
      return;
    onClose();
  };
  const submit = async () => {
    if (saving.current || save.isPending) return;
    let next = draft;
    let base = stored.base;
    if (review) {
      next = review.merged;
      for (const field of review.conflicts) {
        const choice = review.choices[field];
        if (!choice) return;
        if (choice === "saved" && review.saved)
          next = applySavedMealField(next, review.saved, field);
      }
      base = review.base;
    }
    saving.current = true;
    dispatch({ type: "saving" });
    save.reset();
    try {
      // Always fetch before merging. A cached revision cannot authorise old fields.
      const fresh = await planner.refetch({ throwOnError: true });
      if (!fresh.data)
        throw new Error(
          "Couldn't load the latest plan. Your draft is still here.",
        );
      const savedMeal = fresh.data.meals.find((entry) => entry.id === next.id);
      const saved = savedMeal ? mealInput.parse(savedMeal) : null;
      const merged = mergeMealDraft(base, next, saved);
      const freshBase: MealBaseline = {
        kind: "known",
        revision: fresh.data.revision,
        meal: saved,
      };
      if (merged.conflicts.length) {
        dispatch({
          type: "review",
          review: {
            ...merged,
            base: freshBase,
            saved: saved ? initialMealDraft(saved.date, saved) : null,
            choices: {},
            savedRecipeTitle:
              savedMeal?.kind === "recipe" ? savedMeal.title : null,
          },
        });
        return;
      }
      const result = parseMealDraft(merged.merged);
      if (!result.success) {
        dispatch({
          type: "error",
          message: result.error.issues[0]?.message ?? "Check the meal details.",
          showDetails: true,
        });
        return;
      }
      // Preserve the agreed draft and its matching base even if the next request fails.
      dispatch({ type: "rebase", fields: merged.merged, base: freshBase });
      await save.mutateAsync({
        householdId,
        revision: fresh.data.revision,
        meal: result.data,
      });
    } catch (cause) {
      dispatch({
        type: "error",
        message:
          cause instanceof Error
            ? cause.message
            : "Couldn't save. Your draft is still here.",
      });
    } finally {
      saving.current = false;
      dispatch({ type: "settled" });
    }
  };

  return {
    planner,
    editing,
    draft,
    review,
    query,
    detailsOpen,
    error,
    storageFailed,
    pending: save.isPending || busy,
    saveError: save.error?.message,
    set,
    setReview,
    chooseConflict,
    setDetailsOpen,
    initialiseServings,
    typeSearch,
    changeNote,
    discard,
    close,
    submit,
  };
}
