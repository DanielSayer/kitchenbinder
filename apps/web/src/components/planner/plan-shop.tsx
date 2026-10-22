import {
  type Coverage,
  coverageInput,
  type Meal,
} from "@prep-sheet/db/meal-planner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ShoppingBasket } from "lucide-react";
import { useId, useState } from "react";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import {
  planningRefresh,
  usePlanningScope,
} from "../households/planning-context";
import { OrganiseDialog } from "../recipes/organise-dialog";
import { addDays, dateLabel, localDate, weekStart } from "./dates";

export function mealTitle(meal: Meal, meals: Meal[]) {
  if (meal.kind === "recipe") return meal.title;
  if (meal.kind === "out") return meal.description || "Eating out";
  const source = meals.find((entry) => entry.id === meal.sourceId);
  return source?.kind === "recipe" ? `${source.title} leftovers` : "Leftovers";
}

export function MealListNotice() {
  const { scope } = usePlanningScope();
  const trpc = useTRPC();
  const query = useQuery(
    trpc.planner.get.queryOptions(scope, planningRefresh(scope)),
  );
  const [review, setReview] = useState(false);
  const trip = query.data?.trip;
  if (query.isError)
    return (
      <ErrorNotice
        message={query.error.message}
        retry={() => void query.refetch()}
      />
    );
  if (!trip || !query.data?.stale) return null;
  return (
    <>
      <div className="meal-list-notice" role="status">
        <p>Your meals changed.</p>
        <button
          className="button button-small button-outline"
          type="button"
          onClick={() => setReview(true)}
        >
          Review list
        </button>
      </div>
      {review && <PlanShop initial={trip} onClose={() => setReview(false)} />}
    </>
  );
}

export function PlanShop({
  initial,
  onClose,
}: {
  initial?: Coverage;
  onClose: () => void;
}) {
  const { scope } = usePlanningScope();
  const trpc = useTRPC();
  const client = useQueryClient();
  const navigate = useNavigate();
  const planner = useQuery(
    trpc.planner.get.queryOptions(scope, planningRefresh(scope)),
  );
  const datesId = useId();
  const [coverage, setCoverage] = useState<Coverage>(
    initial ?? {
      shoppingDate: weekStart(localDate()),
      start: weekStart(localDate()),
      end: addDays(weekStart(localDate()), 6),
    },
  );
  const [reviewed, setReviewed] = useState<Coverage | null>(null);
  const [error, setError] = useState("");
  const [changeDates, setChangeDates] = useState(false);
  const preview = useQuery(
    trpc.planner.preview.queryOptions(
      { scope, coverage: reviewed ?? coverage, replace: false },
      { enabled: reviewed !== null, staleTime: 0 },
    ),
  );
  const apply = useMutation(
    trpc.planner.applyTrip.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
          client.invalidateQueries({ queryKey: trpc.shopping.pathKey() }),
        ]);
        onClose();
        await navigate({ to: "/shopping/generated" });
      },
    }),
  );
  const set = (patch: Partial<Pick<Coverage, "start" | "end">>) => {
    setCoverage((current) => ({
      ...current,
      ...patch,
      shoppingDate:
        patch.start && patch.start < current.shoppingDate
          ? patch.start
          : current.shoppingDate,
    }));
    setReviewed(null);
    apply.reset();
    setError("");
  };
  return (
    <OrganiseDialog
      title="Make shopping list"
      className="meal-dialog meal-shop-dialog"
      onClose={() => {
        if (!apply.isPending) onClose();
      }}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = coverageInput.safeParse(coverage);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? "Check the dates.");
            setChangeDates(true);
            return;
          }
          setError("");
          setReviewed(parsed.data);
        }}
      >
        <fieldset disabled={apply.isPending} className="meal-form">
          <div className="meal-list-dates">
            <div>
              <h3>Which days are you shopping for?</h3>
              <p>
                {dateLabel(coverage.start)} to {dateLabel(coverage.end)}
              </p>
            </div>
            <button
              type="button"
              className="text-button"
              aria-expanded={changeDates}
              aria-controls={datesId}
              onClick={() => setChangeDates((current) => !current)}
            >
              {changeDates ? "Hide dates" : "Change dates"}
            </button>
          </div>
          <div id={datesId} className="meal-form-grid" hidden={!changeDates}>
            <label className="shopping-field">
              From
              <input
                type="date"
                required
                min="2000-01-01"
                max="2100-12-31"
                value={coverage.start}
                onChange={(event) => set({ start: event.target.value })}
              />
            </label>
            <label className="shopping-field">
              Through
              <input
                type="date"
                required
                min={coverage.start}
                max="2100-12-31"
                value={coverage.end}
                onChange={(event) => set({ end: event.target.value })}
              />
            </label>
          </div>
          <ErrorNotice message={error} />
          <ErrorNotice
            message={planner.error?.message}
            retry={() => void planner.refetch()}
          />
          {!reviewed && (
            <div className="organise-dialog-footer">
              <button
                type="button"
                className="button button-outline"
                onClick={onClose}
              >
                Cancel
              </button>
              <button className="button button-primary" type="submit">
                Review ingredients
              </button>
            </div>
          )}
        </fieldset>
      </form>
      {reviewed && (
        <div className="meal-form">
          <LoadingState
            pending={preview.isPending}
            label="Reviewing meals and ingredients..."
          >
            <ErrorNotice
              message={preview.error?.message}
              retry={() => void preview.refetch()}
            />
            {preview.data && !preview.isError && (
              <>
                <section className="meal-review-section">
                  <h3>Included meals</h3>
                  {!preview.data.meals.length && (
                    <p>No meals planned. You can still shop for groceries.</p>
                  )}
                  <ul className="meal-review-meals">
                    {preview.data.meals.map((meal) => (
                      <li key={meal.id}>
                        <span>
                          {dateLabel(meal.date)}
                          {meal.slot ? ` · ${meal.slot}` : ""}
                        </span>
                        <strong>
                          {mealTitle(meal, planner.data?.meals ?? [])}
                        </strong>
                        <small>
                          {meal.kind === "recipe"
                            ? `Cook ${meal.cook} servings`
                            : "No ingredients added"}
                        </small>
                      </li>
                    ))}
                  </ul>
                </section>
                {preview.data.issues.map((issue) => (
                  <p
                    key={issue.id + issue.message}
                    className="meal-warning"
                    role="alert"
                  >
                    {issue.message}
                  </p>
                ))}
                <section className="meal-review-section">
                  <h3>Ingredient changes</h3>
                  <p className="muted">
                    Keeps other groceries and quantities already bought or at
                    home.
                  </p>
                  {!preview.data.changes.length && (
                    <p>No ingredient changes needed.</p>
                  )}
                  <ul className="meal-changes">
                    {preview.data.changes.map((change, index) => (
                      <li key={`${index}:${change.title}`}>
                        <span
                          className={`meal-change-kind meal-change-${change.kind}`}
                        >
                          {change.kind === "keep"
                            ? "Keep"
                            : change.kind === "add"
                              ? "Add"
                              : change.kind === "remove"
                                ? "Remove"
                                : "Change"}
                        </span>
                        <div>
                          <strong>{change.title}</strong>
                          {change.before && <p>{change.before}</p>}
                          {change.after && (
                            <p>
                              {change.kind === "change" ? "Now: " : ""}
                              {change.after}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                {!!preview.data.warnings.length && (
                  <div className="meal-warning">
                    <strong>Check these quantities</strong>
                    <ul>
                      {preview.data.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <ErrorNotice
                  message={apply.error?.message}
                  retry={() => {
                    apply.reset();
                    void preview.refetch();
                  }}
                />
                <div className="organise-dialog-footer">
                  <button
                    type="button"
                    disabled={apply.isPending}
                    className="button button-outline"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={
                      apply.isPending ||
                      preview.isFetching ||
                      preview.data.issues.length > 0
                    }
                    onClick={() => {
                      if (preview.data)
                        apply.mutate({
                          scope,
                          coverage: reviewed,
                          replace: false,
                          token: preview.data.token,
                        });
                    }}
                  >
                    <ShoppingBasket size={17} />
                    {apply.isPending ? "Saving..." : "Save shopping list"}
                  </button>
                </div>
              </>
            )}
          </LoadingState>
        </div>
      )}
    </OrganiseDialog>
  );
}
