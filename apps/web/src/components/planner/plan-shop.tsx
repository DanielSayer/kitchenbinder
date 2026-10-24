import {
  type Coverage,
  coverageInput,
  type Meal,
} from "@prep-sheet/db/meal-planner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, ShoppingBasket } from "lucide-react";
import { useId, useState } from "react";
import { useHouseholdScope } from "@/components/households/household-context";
import { Sheet } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { addDays, localDate, shortDate, weekday, weekStart } from "./dates";

export function mealTitle(meal: Meal, meals: Meal[]) {
  if (meal.kind === "recipe") return meal.title;
  if (meal.kind === "out") return meal.description || "Eating out";
  const source = meals.find((entry) => entry.id === meal.sourceId);
  return source?.kind === "recipe" ? `${source.title} leftovers` : "Leftovers";
}

/** Shown on Plan and Shop when meals changed since the list was made. */
export function MealListNotice() {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const query = useQuery(trpc.planner.get.queryOptions({ householdId }));
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
      <div className="list-notice" role="status">
        <RefreshCw size={18} aria-hidden="true" />
        <p>Your meals changed since the list was made.</p>
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

function rangeText(coverage: Pick<Coverage, "start" | "end">) {
  return coverage.start === coverage.end
    ? `${weekday(coverage.start)} ${shortDate(coverage.start)}`
    : `${weekday(coverage.start, "short")} ${shortDate(coverage.start)} – ${weekday(coverage.end, "short")} ${shortDate(coverage.end)}`;
}

const changeLabels = {
  keep: "Keep",
  add: "Add",
  remove: "Remove",
  change: "Change",
} as const;

/** Plan → shop: preview the ingredients for a date range, then save the list. */
export function PlanShop({
  initial,
  onClose,
}: {
  initial?: Coverage;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const navigate = useNavigate();
  const planner = useQuery(trpc.planner.get.queryOptions({ householdId }));
  const datesId = useId();
  const [coverage, setCoverage] = useState<Coverage>(
    initial ?? {
      shoppingDate: weekStart(localDate()),
      start: weekStart(localDate()),
      end: addDays(weekStart(localDate()), 6),
    },
  );
  const [changeDates, setChangeDates] = useState(false);
  const parsed = coverageInput.safeParse(coverage);
  const reviewed = parsed.success ? parsed.data : null;
  const preview = useQuery(
    trpc.planner.preview.queryOptions(
      { householdId, coverage: reviewed ?? coverage, replace: false },
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
    apply.reset();
  };
  const data = preview.data && !preview.isError ? preview.data : null;
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next && !apply.isPending) onClose();
      }}
      title="Shop for these meals"
      className="plan-shop-sheet"
      footer={
        <>
          <button
            type="button"
            className="button button-primary button-block"
            disabled={
              !reviewed ||
              !data ||
              apply.isPending ||
              preview.isFetching ||
              data.issues.length > 0
            }
            onClick={() => {
              if (reviewed && data)
                apply.mutate({
                  householdId,
                  coverage: reviewed,
                  replace: false,
                  token: data.token,
                });
            }}
          >
            <ShoppingBasket size={20} aria-hidden="true" />
            {apply.isPending ? "Saving..." : "Save shopping list"}
          </button>
          <button
            type="button"
            className="button button-ghost"
            disabled={apply.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="plan-shop">
        <div className="plan-shop-dates">
          <div>
            <small>Meals from</small>
            <b>{rangeText(coverage)}</b>
          </div>
          <button
            type="button"
            className="button button-small button-outline"
            aria-expanded={changeDates}
            aria-controls={datesId}
            onClick={() => setChangeDates((current) => !current)}
          >
            {changeDates ? "Done" : "Change dates"}
          </button>
        </div>
        <div id={datesId} className="plan-shop-range" hidden={!changeDates}>
          <label className="pick-field">
            <span>From</span>
            <input
              type="date"
              required
              min="2000-01-01"
              max="2100-12-31"
              value={coverage.start}
              onChange={(event) => set({ start: event.target.value })}
            />
          </label>
          <label className="pick-field">
            <span>Through</span>
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
        {!parsed.success && (
          <ErrorNotice
            message={parsed.error.issues[0]?.message ?? "Check the dates."}
          />
        )}
        <ErrorNotice
          message={planner.error?.message}
          retry={() => void planner.refetch()}
        />
        {reviewed && (
          <LoadingState
            pending={preview.isPending}
            label="Reviewing meals and ingredients..."
          >
            <ErrorNotice
              message={preview.error?.message}
              retry={() => void preview.refetch()}
            />
            {data && (
              <>
                <section className="plan-shop-section">
                  <h3>Meals</h3>
                  {!data.meals.length && (
                    <p className="meal-sheet-hint">
                      No meals planned. You can still shop for groceries.
                    </p>
                  )}
                  <ul className="plan-shop-meals">
                    {data.meals.map((meal) => (
                      <li key={meal.id}>
                        <span>
                          {weekday(meal.date, "short")} {shortDate(meal.date)}
                          {meal.slot ? ` · ${meal.slot}` : ""}
                        </span>
                        <b>{mealTitle(meal, planner.data?.meals ?? [])}</b>
                        <small>
                          {meal.kind === "recipe"
                            ? `Cook ${meal.cook}`
                            : "No ingredients"}
                        </small>
                      </li>
                    ))}
                  </ul>
                </section>
                {data.issues.map((issue) => (
                  <p
                    key={issue.id + issue.message}
                    className="meal-warning"
                    role="alert"
                  >
                    {issue.message}
                  </p>
                ))}
                <section className="plan-shop-section">
                  <h3>Ingredient changes</h3>
                  <p className="meal-sheet-hint">
                    Keeps other groceries and anything already bought or at
                    home.
                  </p>
                  {!data.changes.length && (
                    <p className="meal-sheet-hint">
                      No ingredient changes needed.
                    </p>
                  )}
                  <ul className="plan-shop-changes">
                    {data.changes.map((change, index) => (
                      <li key={`${index}:${change.title}`}>
                        <span className="plan-change" data-kind={change.kind}>
                          {changeLabels[change.kind]}
                        </span>
                        <div>
                          <b>{change.title}</b>
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
                {!!data.warnings.length && (
                  <div className="meal-warning">
                    <b>Check these quantities</b>
                    <ul>
                      {data.warnings.map((warning) => (
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
              </>
            )}
          </LoadingState>
        )}
      </div>
    </Sheet>
  );
}
