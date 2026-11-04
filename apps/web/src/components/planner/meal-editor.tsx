import type { Meal } from "@prep-sheet/db/meal-planner";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { NotebookPen, RotateCcw, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useHousehold } from "@/components/households/household-context";
import { Chip, ChipRow, RecipeCover, Sheet } from "@/components/pantry";
import { useWeekStartsOn } from "@/components/preferences";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import {
  RecipePagination,
  recipePageSize,
  useRecipePage,
} from "../recipes/pagination";
import { formatServings } from "../recipes/scale-ingredients";
import { useDebouncedValue } from "../use-debounced-value";
import {
  dateLabel,
  dayOfMonth,
  shortDate,
  weekDays,
  weekday,
  weekStart,
} from "./dates";
import { MealConflictReview } from "./meal-conflict-review";
import { MealDetails } from "./meal-details";
import { conflictValue, type MealConflict, type MealDraft } from "./meal-draft";
import { SuggestionRows } from "./suggestion-rows";
import { useMealDraft } from "./use-meal-draft";

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
  const weekStartsOn = useWeekStartsOn();
  const { data: session } = authClient.useSession();
  const key = `meal-draft:${session?.user.id ?? "guest"}:${duplicate ? "copy" : "edit"}:${meal?.id ?? date}`;
  const householdId = useHousehold().householdId ?? undefined;
  const collections = useQuery(trpc.collections.list.queryOptions());
  const {
    planner,
    editing,
    draft,
    review,
    query,
    detailsOpen,
    error,
    storageFailed,
    pending,
    saveError,
    set,
    selectRecipe,
    setReview,
    chooseConflict,
    setDetailsOpen,
    initialiseServings,
    typeSearch,
    changeNote,
    discard,
    close,
    submit,
  } = useMealDraft({
    date,
    meal,
    recipeId,
    duplicate,
    storageKey: key,
    householdId,
    onClose,
  });
  const search = useDebouncedValue(query.trim());
  const [collection, setCollection] = useState("all");
  const { page, setPage } = useRecipePage(JSON.stringify([search, collection]));
  const recipes = useQuery(
    trpc.shopping.recipes.queryOptions(
      {
        search,
        collectionId: collection === "all" ? undefined : collection,
        page,
        pageSize: recipePageSize,
      },
      { placeholderData: keepPreviousData },
    ),
  );
  const selected = useQuery(
    trpc.shopping.recipe.queryOptions(
      { id: draft.recipeId },
      { enabled: draft.kind === "recipe" && !!draft.recipeId },
    ),
  );
  const formId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const selectedRecipe = selected.data;
  useEffect(() => {
    if (!selectedRecipe) return;
    initialiseServings(selectedRecipe.servings);
  }, [selectedRecipe, initialiseServings]);
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
  const day = weekday(draft.date);
  const dishName =
    draft.kind === "recipe"
      ? (recipeTitle ?? "meal")
      : draft.kind === "leftovers"
        ? "leftovers"
        : "note";
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
  const days = weekDays(weekStart(draft.date, weekStartsOn));
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
            <MealConflictReview
              review={review}
              formId={formId}
              reviewValue={reviewValue}
              onChoose={chooseConflict}
            />
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
                    typeSearch(text);
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
              {!query.trim() && !editing && (
                <SuggestionRows
                  householdId={householdId}
                  weekStart={days[0] ?? draft.date}
                  collectionId={collection === "all" ? undefined : collection}
                  radioName={radioName}
                  selectedId={
                    draft.kind === "recipe" ? draft.recipeId : undefined
                  }
                  onPick={selectRecipe}
                />
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
                      onChange={() => changeNote(query.trim())}
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
                        onChange={() => selectRecipe(entry.id)}
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
              <MealDetails
                draft={draft}
                detailsOpen={detailsOpen}
                setDetailsOpen={setDetailsOpen}
                set={set}
                recipeTitle={recipeTitle}
                recipeServings={selectedRecipe?.servings}
                recipeError={selected.error?.message}
                onRetryRecipe={() => void selected.refetch()}
                sourceTitle={
                  source?.kind === "recipe" ? source.title : undefined
                }
                onNoteChange={changeNote}
              />
            </>
          )}
          <ErrorNotice message={error || saveError || planner.error?.message} />
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
