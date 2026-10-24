import type { Meal } from "@prep-sheet/db/meal-planner";
import { mealInput } from "@prep-sheet/db/meal-planner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, RotateCcw, Search } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useHousehold } from "@/components/households/household-context";
import {
  Chip,
  ChipRow,
  RecipeCover,
  Segmented,
  Sheet,
} from "@/components/pantry";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import {
  RecipePagination,
  recipePageSize,
  useRecipePage,
} from "../recipes/pagination";
import { formatServings } from "../recipes/scale-ingredients";
import {
  dateLabel,
  dayOfMonth,
  shortDate,
  weekDays,
  weekday,
  weekStart,
} from "./dates";
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
const slots = [
  { value: "", label: "Any" },
  { value: "Breakfast", label: "Breakfast" },
  { value: "Lunch", label: "Lunch" },
  { value: "Dinner", label: "Dinner" },
] as const;

/**
 * Add-a-meal bottom sheet: day, then dish. Search any recipe you can access,
 * pick an earlier cook's leftovers, or type something new to save it as a note.
 * Editing reuses the same sheet with details open. Drafts persist per tab and
 * merge against concurrent edits before saving.
 */
export function MealEditor({
  date,
  meal,
  recipeId,
  duplicate = false,
  open = true,
  onClose,
  onDuplicate,
  onRemove,
}: {
  date: string;
  meal?: Meal;
  recipeId?: string;
  duplicate?: boolean;
  open?: boolean;
  onClose: () => void;
  onDuplicate?: (meal: Meal) => void;
  onRemove?: (meal: Meal) => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const { data: session } = authClient.useSession();
  const key = `meal-draft:${session?.user.id ?? "guest"}:${duplicate ? "copy" : "edit"}:${meal?.id ?? date}`;
  const householdId = useHousehold().householdId ?? undefined;
  const planner = useQuery(trpc.planner.get.queryOptions({ householdId }));
  const collections = useQuery(trpc.collections.list.queryOptions());
  const editing = Boolean(meal) && !duplicate;
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
  const [query, setQuery] = useState(() =>
    draft.kind === "out" ? draft.description : "",
  );
  const search = useDeferredValue(query.trim());
  const [detailsOpen, setDetailsOpen] = useState(
    Boolean(meal) || Boolean(recipeId),
  );
  const [collection, setCollection] = useState("all");
  const { page, setPage } = useRecipePage(JSON.stringify([search, collection]));
  const recipes = useQuery(
    trpc.shopping.recipes.queryOptions({
      search,
      collectionId: collection === "all" ? undefined : collection,
      page,
      pageSize: recipePageSize,
    }),
  );
  const selected = useQuery(
    trpc.shopping.recipe.queryOptions(
      { id: draft.recipeId },
      { enabled: draft.kind === "recipe" && !!draft.recipeId },
    ),
  );
  const [error, setError] = useState("");
  const formId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewVisible = review !== null;
  useEffect(() => {
    if (reviewVisible) reviewHeading.current?.focus();
  }, [reviewVisible]);
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
  const selectedRecipe = selected.data;
  useEffect(() => {
    if (!selectedRecipe) return;
    const match = selectedRecipe.servings
      ?.trim()
      .match(/^(?:serves?\s*)?(\d+)(?:\s*(?:servings?|people|portions?))?$/i);
    const servings = match?.[1];
    if (servings)
      setDraft((current) =>
        current.baseServings
          ? current
          : editing
            ? { ...current, baseServings: servings }
            : // New meals cook the recipe as written by default.
              {
                ...current,
                baseServings: servings,
                cook: servings,
                eat: servings,
              },
      );
    else setDetailsOpen(true);
  }, [selectedRecipe, setDraft, editing]);
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
  const shown = recipes.isError ? [] : (recipes.data?.items ?? []);
  const sources =
    planner.data?.meals.filter(
      (entry): entry is Extract<Meal, { kind: "recipe" }> =>
        entry.kind === "recipe" &&
        entry.date < draft.date &&
        (entry.cook > entry.eat || entry.id === draft.sourceId) &&
        (!search ||
          entry.title.toLowerCase().includes(search.toLowerCase()) ||
          "leftovers".includes(search.toLowerCase())),
    ) ?? [];
  const source = planner.data?.meals.find(
    (entry) => entry.id === draft.sourceId,
  );
  const recipeTitle =
    selectedRecipe?.title ??
    shown.find((entry) => entry.id === draft.recipeId)?.title ??
    (meal?.kind === "recipe" && meal.recipeId === draft.recipeId
      ? meal.title
      : null);
  const selectionReady =
    draft.kind === "recipe"
      ? Boolean(draft.recipeId)
      : draft.kind === "leftovers"
        ? Boolean(draft.sourceId)
        : Boolean(draft.description.trim()) || editing;
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
        setDetailsOpen(true);
        setError(result.error.issues[0]?.message ?? "Check the meal details.");
        return;
      }
      // Preserve the agreed draft and its matching base even if the next request fails.
      setStored({ ...stored, fields: merged.merged, base: freshBase });
      setReview(null);
      await save.mutateAsync({
        householdId,
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
    const entry = planner.data?.meals.find(
      (item) => item.id === fields.sourceId,
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
        entry?.kind === "recipe"
          ? `${entry.title} on ${dateLabel(entry.date)}`
          : "Cooking session unavailable",
    });
  };
  const chooseNote = (text: string) => {
    setQuery(text);
    set({ kind: "out", description: text });
  };
  const day = weekday(draft.date);
  const dishName =
    draft.kind === "recipe"
      ? (recipeTitle ?? "meal")
      : draft.kind === "leftovers"
        ? "leftovers"
        : "note";
  const pending = save.isPending || busy;
  const primaryLabel = pending
    ? "Saving..."
    : review
      ? "Save reviewed meal"
      : editing
        ? "Save meal"
        : selectionReady
          ? `Add ${dishName} to ${day}`
          : "Choose a dish";
  const radioName = `${formId}-dish`;
  const days = weekDays(weekStart(draft.date));
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={
        duplicate ? "Duplicate meal" : editing ? "Edit meal" : "Add a meal"
      }
      initialFocus={editing || review ? undefined : searchInput}
      className="meal-sheet"
      footer={
        <>
          <button
            type="submit"
            form={formId}
            className="button button-primary button-block meal-sheet-cta"
            disabled={
              pending ||
              review?.conflicts.some((field) => !review.choices[field]) ||
              planner.isPending ||
              planner.isError ||
              !selectionReady
            }
          >
            <span>{primaryLabel}</span>
          </button>
          <div className="meal-sheet-secondary">
            {review ? (
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setReview(null)}
              >
                Back to editing
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={pending}
                  onClick={discard}
                >
                  {editing ? "Discard changes" : "Cancel"}
                </button>
                {editing && meal && onDuplicate && (
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={pending}
                    onClick={() => onDuplicate(meal)}
                  >
                    Duplicate
                  </button>
                )}
                {editing && meal && onRemove && (
                  <button
                    type="button"
                    className="button button-ghost meal-sheet-remove"
                    disabled={pending}
                    onClick={() => onRemove(meal)}
                  >
                    Remove
                  </button>
                )}
              </>
            )}
          </div>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (selectionReady) void submit();
        }}
      >
        <fieldset disabled={pending} className="meal-sheet-form">
          {review ? (
            <section
              className="meal-review"
              aria-labelledby={`${formId}-review`}
            >
              <h3 id={`${formId}-review`} tabIndex={-1} ref={reviewHeading}>
                Review changed meal
              </h3>
              <p>
                The saved plan changed. Choose what to keep before saving. Your
                draft is still stored.
              </p>
              {review.conflicts.map((field) => (
                <fieldset key={field} className="meal-review-choice">
                  <legend>{mealFieldLabels[field]}</legend>
                  {(["mine", "saved"] as const)
                    .filter(
                      (choice) => field !== "deleted" || choice === "mine",
                    )
                    .map((choice) => (
                      <label className="pick-row" key={choice}>
                        <input
                          type="radio"
                          className="pick-input"
                          name={`${formId}-review-${field}`}
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
                        <span className="pick-text">
                          <b>{choice === "mine" ? "My draft" : "Saved meal"}</b>{" "}
                          <small>
                            {reviewValue(
                              choice === "saved" && review.saved
                                ? review.saved
                                : review.merged,
                              field,
                            )}
                          </small>
                        </span>
                        <span className="pick-mark" aria-hidden="true" />
                      </label>
                    ))}
                  {field === "deleted" && (
                    <p className="meal-sheet-hint">
                      This meal was deleted. Saving recreates it. Close to keep
                      the draft without recreating it.
                    </p>
                  )}
                </fieldset>
              ))}
            </section>
          ) : (
            <>
              <fieldset className="meal-days">
                <legend className="pantry-visually-hidden">Day</legend>
                {days.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="meal-day-chip"
                    aria-pressed={draft.date === value}
                    aria-label={`${weekday(value)} ${shortDate(value)}`}
                    onClick={() => set({ date: value })}
                  >
                    {weekday(value, "short")}
                    <b className="meal-day-num">{dayOfMonth(value)}</b>
                  </button>
                ))}
              </fieldset>
              <label className="pick-search">
                <Search size={20} aria-hidden="true" />
                <input
                  ref={searchInput}
                  value={query}
                  maxLength={200}
                  aria-label="Search recipes or type a note"
                  placeholder="Search recipes or type a note"
                  onChange={(event) => {
                    const text = event.target.value;
                    setQuery(text);
                    // Typing something new is a note until a dish is picked.
                    if (
                      draft.kind === "out" ||
                      (draft.kind === "recipe" && !draft.recipeId)
                    )
                      set({ kind: "out", description: text.trim() });
                  }}
                />
              </label>
              {!!collections.data?.length && (
                <ChipRow
                  className="pick-chips"
                  role="group"
                  aria-label="Collection"
                >
                  <Chip
                    pressed={collection === "all"}
                    onClick={() => setCollection("all")}
                  >
                    All recipes
                  </Chip>
                  {collections.data.map((item) => (
                    <Chip
                      key={item.id}
                      pressed={collection === item.id}
                      onClick={() => setCollection(item.id)}
                    >
                      {item.name}
                    </Chip>
                  ))}
                </ChipRow>
              )}
              <div
                className="pick-list"
                role="radiogroup"
                aria-label="Dish"
                aria-busy={recipes.isFetching}
              >
                {(query.trim() ||
                  (draft.kind === "out" && editing && !query.trim())) && (
                  <label className="pick-row pick-note">
                    <input
                      type="radio"
                      className="pick-input"
                      name={radioName}
                      checked={draft.kind === "out"}
                      onChange={() => chooseNote(query.trim())}
                    />
                    <span className="pick-icon" aria-hidden="true">
                      <NotebookPen size={20} />
                    </span>
                    <span className="pick-text">
                      <b>
                        {query.trim()
                          ? `Save “${query.trim()}” as a note`
                          : "Note"}
                      </b>{" "}
                      <small>No ingredients added</small>
                    </span>
                    <span className="pick-mark" aria-hidden="true" />
                  </label>
                )}
                {sources.map((entry) => (
                  <label className="pick-row" key={entry.id}>
                    <input
                      type="radio"
                      className="pick-input"
                      name={radioName}
                      checked={
                        draft.kind === "leftovers" &&
                        draft.sourceId === entry.id
                      }
                      onChange={() =>
                        set({
                          kind: "leftovers",
                          sourceId: entry.id,
                          portions: String(
                            Math.max(
                              1,
                              Math.min(
                                Number(draft.portions) || 2,
                                entry.cook - entry.eat || 1,
                              ),
                            ),
                          ),
                        })
                      }
                    />
                    <span className="pick-icon" aria-hidden="true">
                      <RotateCcw size={20} />
                    </span>
                    <span className="pick-text">
                      <b>{entry.title} leftovers</b>{" "}
                      <small>
                        From {weekday(entry.date, "short")}{" "}
                        {shortDate(entry.date)} · {entry.cook - entry.eat} spare
                      </small>
                    </span>
                    <span className="pick-mark" aria-hidden="true" />
                  </label>
                ))}
                <LoadingState
                  pending={recipes.isPending}
                  label="Finding recipes..."
                >
                  {shown.map((entry) => (
                    <label className="pick-row" key={entry.id}>
                      <input
                        type="radio"
                        className="pick-input"
                        name={radioName}
                        checked={
                          draft.kind === "recipe" && draft.recipeId === entry.id
                        }
                        onChange={() =>
                          set({
                            kind: "recipe",
                            recipeId: entry.id,
                            baseServings:
                              draft.recipeId === entry.id
                                ? draft.baseServings
                                : "",
                          })
                        }
                      />
                      <RecipeCover
                        id={entry.id}
                        title={entry.title}
                        photo={entry.photo}
                        size="thumb"
                      />
                      <span className="pick-text">
                        <b className="pick-title">{entry.title}</b>{" "}
                        <small>
                          {entry.ownerId === session?.user.id
                            ? "Your recipe"
                            : "Shared with you"}
                          {entry.servings
                            ? ` · ${formatServings(entry.servings)}`
                            : ""}
                        </small>
                      </span>
                      <span className="pick-mark" aria-hidden="true" />
                    </label>
                  ))}
                  {recipes.isSuccess && !shown.length && (
                    <p className="pick-empty">
                      {search
                        ? "No recipes match. Save it as a note instead."
                        : "No recipes here yet."}
                    </p>
                  )}
                </LoadingState>
              </div>
              <ErrorNotice
                message={recipes.error?.message || collections.error?.message}
                retry={() => {
                  void recipes.refetch();
                  void collections.refetch();
                }}
              />
              {recipes.isSuccess && (
                <RecipePagination
                  page={page}
                  total={recipes.data.total}
                  setPage={setPage}
                  disabled={pending}
                />
              )}
              {!query.trim() && !editing && (
                <p className="note-hint">
                  <NotebookPen size={18} aria-hidden="true" />
                  <span>
                    No recipe? Type “Leftovers” or “Takeaway” and it's saved as
                    a note.
                  </span>
                </p>
              )}
              <details
                className="meal-details"
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
              >
                <summary>
                  <span>Review details</span>
                  <small className="meal-details-summary">
                    {[
                      draft.slot || "Any time",
                      draft.kind === "recipe"
                        ? `cook ${draft.cook || "?"}, eat ${draft.eat || "?"}`
                        : draft.kind === "leftovers"
                          ? `${draft.portions || "?"} portions`
                          : "no ingredients",
                    ].join(" · ")}
                  </small>
                </summary>
                <div className="meal-details-body">
                  <label className="pick-field">
                    <span>Date</span>
                    <input
                      type="date"
                      required
                      min="2000-01-01"
                      max="2100-12-31"
                      value={draft.date}
                      onChange={(event) => set({ date: event.target.value })}
                    />
                  </label>
                  <Segmented
                    label="Meal time"
                    className="meal-slots"
                    options={slots}
                    value={draft.slot}
                    onChange={(value) => {
                      const slot = mealDraftSchema.shape.slot.safeParse(value);
                      if (slot.success) set({ slot: slot.data });
                    }}
                  />
                  {draft.kind === "recipe" && (
                    <>
                      {recipeTitle && (
                        <p className="meal-sheet-hint">
                          <b>{recipeTitle}</b>{" "}
                          {selectedRecipe?.servings
                            ? ` · recipe says “${selectedRecipe.servings}”`
                            : ""}
                        </p>
                      )}
                      <ErrorNotice
                        message={selected.error?.message}
                        retry={() => void selected.refetch()}
                      />
                      <div className="meal-portions">
                        <label className="pick-field">
                          <span>Original servings</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="100"
                            required
                            value={draft.baseServings}
                            onChange={(event) =>
                              set({ baseServings: event.target.value })
                            }
                          />
                        </label>
                        <label className="pick-field">
                          <span>Cook</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="100"
                            required
                            value={draft.cook}
                            onChange={(event) =>
                              set({ cook: event.target.value })
                            }
                          />
                        </label>
                        <label className="pick-field">
                          <span>Eat now</span>
                          <input
                            type="number"
                            inputMode="numeric"
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
                      <p className="meal-sheet-hint">
                        Ingredients scale from the original servings.
                        {Number(draft.cook) > Number(draft.eat)
                          ? ` Saves ${Number(draft.cook) - Number(draft.eat)} portions for leftovers.`
                          : ""}
                      </p>
                    </>
                  )}
                  {draft.kind === "leftovers" && (
                    <>
                      <p className="meal-sheet-hint">
                        <b>
                          {source?.kind === "recipe"
                            ? `${source.title} leftovers`
                            : "Leftovers"}
                        </b>{" "}
                        add no shopping ingredients.
                      </p>
                      <label className="pick-field">
                        <span>Portions to use</span>
                        <input
                          type="number"
                          inputMode="numeric"
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
                  {draft.kind === "out" && (
                    <label className="pick-field">
                      <span>Note</span>
                      <input
                        value={draft.description}
                        maxLength={200}
                        placeholder="Takeaway, dinner with friends…"
                        onChange={(event) => {
                          set({ description: event.target.value });
                          setQuery(event.target.value);
                        }}
                      />
                    </label>
                  )}
                </div>
              </details>
            </>
          )}
          <ErrorNotice
            message={error || save.error?.message || planner.error?.message}
          />
          {storageFailed && (
            <p role="status" className="meal-sheet-hint">
              Draft could not be saved in this browser. Keep this page open
              until you save your meal.
            </p>
          )}
        </fieldset>
      </form>
    </Sheet>
  );
}
