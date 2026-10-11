import type { Meal } from "@prep-sheet/db/meal-planner";
import { mealInput } from "@prep-sheet/db/meal-planner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { useCollection } from "../groups/collection-context";
import { CollectionDropdown } from "../groups/collection-dropdown";
import { OrganiseDialog } from "../recipes/organise-dialog";
import {
  RecipePagination,
  recipePageSize,
  useRecipePage,
} from "../recipes/pagination";
import { dateLabel } from "./dates";

const draftSchema = z.object({
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
type Draft = z.infer<typeof draftSchema>;
function initialDraft(date: string, meal?: Meal, recipeId?: string): Draft {
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
  const trpc = useTRPC();
  const client = useQueryClient();
  const { data: session } = authClient.useSession();
  const key = `meal-draft:${session?.user.id ?? "guest"}:${duplicate ? "copy" : "edit"}:${meal?.id ?? date}`;
  const planner = useQuery(trpc.planner.get.queryOptions());
  const { groups } = useCollection();
  const [draft, setDraft] = useState(() => {
    try {
      const stored = draftSchema.safeParse(
        JSON.parse(localStorage.getItem(key) ?? "null"),
      );
      if (stored.success) return stored.data;
    } catch {
      /* Keep the form usable without browser storage. */
    }
    const initial = initialDraft(date, meal, recipeId);
    return duplicate ? { ...initial, id: crypto.randomUUID(), date } : initial;
  });
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"choose" | "details">(
    meal || recipeId ? "details" : "choose",
  );
  const stepHeading = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Focus the heading when the visible step changes.
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);
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
      { enabled: draft.kind === "recipe" && !!draft.recipeId },
    ),
  );
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(planner.data?.revision);
  useEffect(() => {
    if (revision === undefined && planner.data)
      setRevision(planner.data.revision);
  }, [planner.data, revision]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* Keep the draft in memory. */
    }
  }, [draft, key]);
  const set = (values: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...values }));
  const selectedRecipe = selected.data;
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
  }, [selectedRecipe]);
  const discard = () => {
    try {
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
  const submit = () => {
    const common = { id: draft.id, date: draft.date, slot: draft.slot };
    const result = mealInput.safeParse(
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
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Check the meal details.");
      return;
    }
    if (revision === undefined) return;
    setError("");
    save.mutate({ revision, meal: result.data });
  };
  return (
    <OrganiseDialog
      title={duplicate ? "Duplicate meal" : meal ? "Edit meal" : "Add meal"}
      className="meal-dialog meal-editor-dialog"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectionReady) return;
          if (step === "choose") setStep("details");
          else submit();
        }}
      >
        <fieldset disabled={save.isPending} className="meal-form">
          <div className="meal-step-heading">
            <p className="muted">Step {step === "choose" ? "1" : "2"} of 2</p>
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
                  const slot = draftSchema.shape.slot.safeParse(value);
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
                ] satisfies { value: Draft["kind"]; label: string }[]
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
                      message={recipes.error?.message || groups.error?.message}
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
                          No recipes found. Try another search or collection.
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
                        onChange={(event) => set({ cook: event.target.value })}
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
                        onChange={(event) => set({ eat: event.target.value })}
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
                onChange={(event) => set({ description: event.target.value })}
              />
            </label>
          )}
          {draft.kind === "out" && step === "choose" && (
            <p className="muted">Meals out add no shopping ingredients.</p>
          )}
          <ErrorNotice
            message={error || save.error?.message || planner.error?.message}
          />
          {save.error?.data?.code === "CONFLICT" && (
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                const fresh = await planner.refetch();
                if (fresh.data) {
                  setRevision(fresh.data.revision);
                  save.reset();
                }
              }}
            >
              Refresh plan, keeping this draft
            </button>
          )}
          <div className="organise-dialog-footer">
            <button
              type="button"
              className="button button-outline"
              onClick={
                step === "choose"
                  ? discard
                  : () => {
                      setError("");
                      setStep("choose");
                    }
              }
            >
              {step === "choose" ? "Cancel" : "Back"}
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={
                save.isPending ||
                planner.isPending ||
                planner.isError ||
                !selectionReady
              }
            >
              {save.isPending
                ? "Saving..."
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
