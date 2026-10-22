import type { Meal } from "@prep-sheet/db/meal-planner";
import { mealInput } from "@prep-sheet/db/meal-planner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { useCollection } from "../groups/collection-context";
import { CollectionDropdown } from "../groups/collection-dropdown";
import {
  planningRefresh,
  usePlanningScope,
} from "../households/planning-context";
import { OrganiseDialog } from "../recipes/organise-dialog";
import {
  RecipePagination,
  recipePageSize,
  useRecipePage,
} from "../recipes/pagination";
import { dateLabel } from "./dates";

import {
  applySavedMealField,
  conflictValue,
  initialMealDraft,
  type MealBaseline,
  type MealConflict,
  type MealDraft,
  mealDraftSchema,
  mealFieldLabels,
  mergeMealDraft,
  parseMealDraft,
  readMealDraft,
  type StoredMealDraft,
} from "./meal-draft";

type Review = {
  base: MealBaseline;
  saved: MealDraft | null;
  savedRecipeTitle: string | null;
  merged: MealDraft;
  conflicts: MealConflict[];
  choices: Partial<Record<MealConflict, "mine" | "saved">>;
};
export function MealEditor({
  date,
  meal,
  recipeId,
  duplicate = false,
  onClose,
}: {
  date: string;
  meal?: Meal;
  recipeId?: string;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const { scope, scopeKey } = usePlanningScope();
  const trpc = useTRPC();
  const client = useQueryClient();
  const { data: session } = authClient.useSession();
  const key = `meal-draft:${session?.user.id ?? "guest"}:${scope.kind === "household" ? `${scopeKey}:` : ""}${duplicate ? "copy" : "edit"}:${meal?.id ?? date}`;
  const planner = useQuery(
    trpc.planner.get.queryOptions(scope, planningRefresh(scope)),
  );
  const { groups } = useCollection();
  const [stored, setStored] = useState<StoredMealDraft>(() => {
    const restored = readMealDraft(key);
    if (restored) return restored;
    const current =
      !duplicate && meal
        ? (planner.data?.meals.find((entry) => entry.id === meal.id) ?? meal)
        : undefined;
    const initial = initialMealDraft(date, current, recipeId);
    return {
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
  });
  const draft = stored.fields;
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const setDraft = useCallback(
    (update: (current: MealDraft) => MealDraft) =>
      setStored((current) => {
        const fields = update(current.fields);
        return fields === current.fields ? current : { ...current, fields };
      }),
    [],
  );
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"choose" | "details">(
    meal || recipeId ? "details" : "choose",
  );
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const reviewVisible = review !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Focus the heading when the visible step changes.
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step, reviewVisible]);
  const [collection, setCollection] = useState("all");
  const { page, setPage } = useRecipePage(JSON.stringify([search, collection]));
  const recipes = useQuery(
    trpc.shopping.recipes.queryOptions({
      search,
      collection,
      page,
      pageSize: recipePageSize,
    }),
  );
  const selected = useQuery(
    trpc.shopping.recipe.queryOptions(
      { id: draft.recipeId },
      {
        enabled:
          draft.kind === "recipe" &&
          !!draft.recipeId &&
          !(meal?.kind === "recipe" && meal.recipeId === draft.recipeId),
      },
    ),
  );
  const [error, setError] = useState("");
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
  const set = (values: Partial<MealDraft>) =>
    setDraft((current) => ({ ...current, ...values }));
  const selectedRecipe =
    selected.data ??
    (meal?.kind === "recipe" && meal.recipeId === draft.recipeId
      ? {
          title: meal.title,
          servings: meal.recipe?.servings ?? String(meal.baseServings),
        }
      : null);
  useEffect(() => {
    if (selectedRecipe) {
      const match = selectedRecipe.servings
        ?.trim()
        .match(/^(?:serves?\s*)?(\d+)(?:\s*(?:servings?|people|portions?))?$/i);
      if (match?.[1])
        setDraft((current) =>
          current.baseServings
            ? current
            : { ...current, baseServings: match[1] ?? "" },
        );
    }
  }, [selectedRecipe, setDraft]);
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
  const shown = recipes.isError ? [] : (recipes.data?.items ?? []);
  const sources =
    planner.data?.meals.filter(
      (entry) => entry.kind === "recipe" && entry.date < draft.date,
    ) ?? [];
  const selectedSource = sources.find((source) => source.id === draft.sourceId);
  const selectionReady =
    draft.kind === "recipe"
      ? Boolean(draft.recipeId)
      : draft.kind === "leftovers"
        ? Boolean(draft.sourceId)
        : true;
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
    setBusy(true);
    setError("");
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
        setReview({
          ...merged,
          base: freshBase,
          saved: saved ? initialMealDraft(saved.date, saved) : null,
          choices: {},
          savedRecipeTitle:
            savedMeal?.kind === "recipe" ? savedMeal.title : null,
        });
        return;
      }
      const result = parseMealDraft(merged.merged);
      if (!result.success) {
        setError(result.error.issues[0]?.message ?? "Check the meal details.");
        return;
      }
      // Preserve the agreed draft and its matching base even if the next request fails.
      setStored({ ...stored, fields: merged.merged, base: freshBase });
      setReview(null);
      await save.mutateAsync({
        scope,
        copyFrom:
          duplicate &&
          meal?.kind === "recipe" &&
          result.data.kind === "recipe" &&
          meal.recipeId === result.data.recipeId
            ? meal.id
            : undefined,
        revision: fresh.data.revision,
        meal: result.data,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't save. Your draft is still here.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const reviewValue = (fields: MealDraft, field: MealConflict) => {
    const source = planner.data?.meals.find(
      (entry) => entry.id === fields.sourceId,
    );
    const title =
      fields.recipeId === draft.recipeId ? selectedRecipe?.title : null;
    const savedTitle =
      fields.recipeId === review?.saved?.recipeId
        ? review.savedRecipeTitle
        : null;
    return conflictValue(fields, field, {
      recipe:
        title ??
        savedTitle ??
        (meal?.kind === "recipe" && meal.recipeId === fields.recipeId
          ? meal.title
          : "Recipe unavailable"),
      source:
        source?.kind === "recipe"
          ? `${source.title} on ${dateLabel(source.date)}`
          : "Cooking session unavailable",
    });
  };
  return (
    <OrganiseDialog
      title={duplicate ? "Duplicate meal" : meal ? "Edit meal" : "Add meal"}
      className="meal-dialog meal-editor-dialog"
      onClose={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectionReady) return;
          if (step === "choose") setStep("details");
          else void submit();
        }}
      >
        <fieldset disabled={save.isPending || busy} className="meal-form">
          {scope.kind === "household" && draft.kind === "recipe" && (
            <p className="meal-sharing-note">
              Household members can view this recipe in the planned meal. Recipe
              notes stay in the source collection.
            </p>
          )}
          {review ? (
            <section
              className="recipe-review"
              aria-labelledby="meal-review-heading"
            >
              <h3 id="meal-review-heading" tabIndex={-1} ref={stepHeading}>
                Review changed meal
              </h3>
              <p>
                The saved plan changed. Choose what to keep before saving. Your
                draft is still stored.
              </p>
              {review.conflicts.map((field) => (
                <fieldset key={field}>
                  <legend>{mealFieldLabels[field]}</legend>
                  {(["mine", "saved"] as const)
                    .filter(
                      (choice) => field !== "deleted" || choice === "mine",
                    )
                    .map((choice) => (
                      <label className="shopping-recipe-choice" key={choice}>
                        <input
                          type="radio"
                          name={`review-${field}`}
                          checked={review.choices[field] === choice}
                          onChange={() =>
                            setReview(
                              (current) =>
                                current && {
                                  ...current,
                                  choices: {
                                    ...current.choices,
                                    [field]: choice,
                                  },
                                },
                            )
                          }
                        />
                        <span>
                          <strong>
                            {choice === "mine" ? "My draft" : "Saved meal"}
                          </strong>{" "}
                          <span>
                            {reviewValue(
                              choice === "saved" && review.saved
                                ? review.saved
                                : review.merged,
                              field,
                            )}
                          </span>
                        </span>
                      </label>
                    ))}
                  {field === "deleted" && (
                    <p>
                      This meal was deleted. Saving recreates it. Close to keep
                      the draft without recreating it.
                    </p>
                  )}
                </fieldset>
              ))}
            </section>
          ) : (
            <>
              <div className="meal-step-heading">
                <p className="muted">
                  Step {step === "choose" ? "1" : "2"} of 2
                </p>
                <h3 ref={stepHeading} tabIndex={-1}>
                  {step === "choose" ? "Choose a meal" : "Meal details"}
                </h3>
              </div>
              {step === "details" && (
                <div className="meal-form-grid">
                  <label className="shopping-field">
                    Date
                    <input
                      type="date"
                      required
                      min="2000-01-01"
                      max="2100-12-31"
                      value={draft.date}
                      onChange={(event) => set({ date: event.target.value })}
                    />
                  </label>
                  <CollectionDropdown
                    label="Meal"
                    value={draft.slot}
                    options={[
                      { value: "", label: "Any time" },
                      ...["Breakfast", "Lunch", "Dinner"].map((value) => ({
                        value,
                        label: value,
                      })),
                    ]}
                    onValueChange={(value) => {
                      const slot = mealDraftSchema.shape.slot.safeParse(value);
                      if (slot.success) set({ slot: slot.data });
                    }}
                  />
                </div>
              )}
              {step === "choose" && (
                <fieldset className="meal-types" aria-label="Entry type">
                  {(
                    [
                      { value: "recipe", label: "Recipe" },
                      { value: "leftovers", label: "Leftovers" },
                      { value: "out", label: "Eating out" },
                    ] satisfies { value: MealDraft["kind"]; label: string }[]
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={draft.kind === option.value}
                      onClick={() => set({ kind: option.value })}
                    >
                      {option.label}
                    </button>
                  ))}
                </fieldset>
              )}
              {draft.kind === "recipe" && (
                <>
                  {step === "choose" && (
                    <>
                      <div className="meal-form-grid">
                        <label className="shopping-field">
                          Search recipes
                          <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Recipe name"
                          />
                        </label>
                        <CollectionDropdown
                          label="Collection"
                          value={collection}
                          onValueChange={setCollection}
                          options={[
                            { value: "all", label: "All collections" },
                            { value: "personal", label: "Personal collection" },
                            ...(groups.data?.map((group) => ({
                              value: group.id,
                              label: group.name,
                            })) ?? []),
                          ]}
                        />
                      </div>
                      <LoadingState pending={recipes.isPending}>
                        <ErrorNotice
                          message={
                            recipes.error?.message || groups.error?.message
                          }
                          retry={() => {
                            void recipes.refetch();
                            void groups.refetch();
                          }}
                        />
                        <div className="meal-recipe-options">
                          {shown.map((entry) => (
                            <label
                              className="shopping-recipe-choice"
                              key={entry.id}
                            >
                              <input
                                type="radio"
                                name="recipe"
                                checked={draft.recipeId === entry.id}
                                onChange={() =>
                                  set({ recipeId: entry.id, baseServings: "" })
                                }
                              />
                              <span>
                                <strong>{entry.title}</strong>
                                <small>
                                  {entry.groupId
                                    ? (groups.data?.find(
                                        (group) => group.id === entry.groupId,
                                      )?.name ?? "Shared collection")
                                    : "Personal collection"}
                                </small>
                                <small>
                                  {entry.servings
                                    ? `Original yield: ${entry.servings}`
                                    : "Yield not specified"}
                                </small>
                              </span>
                            </label>
                          ))}
                          {recipes.isSuccess && !shown.length && (
                            <p className="muted">
                              No recipes found. Try another search or
                              collection.
                            </p>
                          )}
                        </div>
                        {recipes.isSuccess && (
                          <RecipePagination
                            page={page}
                            total={recipes.data.total}
                            setPage={setPage}
                            disabled={save.isPending}
                          />
                        )}
                      </LoadingState>
                    </>
                  )}
                  {step === "details" && (
                    <>
                      {draft.recipeId && (
                        <p className="meal-selected">
                          Selected:{" "}
                          <strong>
                            {selectedRecipe?.title ??
                              (meal?.kind === "recipe"
                                ? meal.title
                                : "Recipe unavailable")}
                          </strong>
                        </p>
                      )}
                      <ErrorNotice
                        message={selected.error?.message}
                        retry={() => void selected.refetch()}
                      />
                      <div className="meal-form-grid meal-portions">
                        <label className="shopping-field">
                          Original servings
                          <input
                            type="number"
                            min="1"
                            max="100"
                            required
                            value={draft.baseServings}
                            onChange={(event) =>
                              set({ baseServings: event.target.value })
                            }
                          />
                        </label>
                        <label className="shopping-field">
                          Cook
                          <input
                            type="number"
                            min="1"
                            max="100"
                            required
                            value={draft.cook}
                            onChange={(event) =>
                              set({ cook: event.target.value })
                            }
                          />
                        </label>
                        <label className="shopping-field">
                          Eat now
                          <input
                            type="number"
                            min="1"
                            max={draft.cook || "100"}
                            required
                            value={draft.eat}
                            onChange={(event) =>
                              set({ eat: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      <p className="muted">
                        Ingredients scale from the original servings. Save{" "}
                        {Math.max(0, Number(draft.cook) - Number(draft.eat))}{" "}
                        portions for leftovers.
                      </p>
                    </>
                  )}
                </>
              )}
              {draft.kind === "leftovers" && (
                <>
                  {step === "choose" && (
                    <>
                      <p className="muted">
                        Choose an earlier meal. Leftovers add no shopping
                        ingredients.
                      </p>
                      <div className="meal-recipe-options">
                        {sources.map(
                          (source) =>
                            source.kind === "recipe" && (
                              <label
                                className="shopping-recipe-choice"
                                key={source.id}
                              >
                                <input
                                  type="radio"
                                  name="source"
                                  checked={draft.sourceId === source.id}
                                  onChange={() => set({ sourceId: source.id })}
                                />
                                <span>
                                  <strong>{source.title}</strong>
                                  <small>
                                    {dateLabel(source.date)} ·{" "}
                                    {source.cook - source.eat} saved portions
                                  </small>
                                </span>
                              </label>
                            ),
                        )}
                      </div>
                      {!sources.length && (
                        <p>
                          Add a recipe on an earlier day and save some portions
                          first.
                        </p>
                      )}
                    </>
                  )}
                  {step === "details" && (
                    <>
                      <p className="meal-selected">
                        <strong>
                          {selectedSource?.kind === "recipe"
                            ? selectedSource.title
                            : "Leftovers"}
                        </strong>
                      </p>
                      <label className="shopping-field">
                        Portions to use
                        <input
                          type="number"
                          min="1"
                          max="100"
                          required
                          value={draft.portions}
                          onChange={(event) =>
                            set({ portions: event.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              {draft.kind === "out" && step === "details" && (
                <label className="shopping-field">
                  Description, optional
                  <input
                    value={draft.description}
                    maxLength={200}
                    placeholder="Dinner with friends"
                    onChange={(event) =>
                      set({ description: event.target.value })
                    }
                  />
                </label>
              )}
              {draft.kind === "out" && step === "choose" && (
                <p className="muted">Meals out add no shopping ingredients.</p>
              )}
            </>
          )}
          <ErrorNotice
            message={error || save.error?.message || planner.error?.message}
          />
          {storageFailed && (
            <p role="status">
              Draft could not be saved in this browser. Keep this page open
              until you save your meal.
            </p>
          )}
          <div className="organise-dialog-footer">
            <button
              type="button"
              className="button button-outline"
              onClick={
                review
                  ? () => setReview(null)
                  : step === "choose"
                    ? discard
                    : () => {
                        setError("");
                        setStep("choose");
                      }
              }
            >
              {review
                ? "Back to editing"
                : step === "choose"
                  ? "Cancel"
                  : "Back"}
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={
                save.isPending ||
                busy ||
                review?.conflicts.some((field) => !review.choices[field]) ||
                planner.isPending ||
                planner.isError ||
                !selectionReady
              }
            >
              {save.isPending || busy
                ? "Saving..."
                : review
                  ? "Save reviewed meal"
                  : step === "choose"
                    ? "Continue"
                    : "Save meal"}
            </button>
          </div>
        </fieldset>
      </form>
    </OrganiseDialog>
  );
}
