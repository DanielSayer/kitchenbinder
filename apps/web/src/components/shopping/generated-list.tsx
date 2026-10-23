import {
  combinedQuantity,
  shoppingCategories,
} from "@prep-sheet/db/shopping-plan";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  RefreshCw,
  Route as RouteIcon,
} from "lucide-react";
import { useState } from "react";
import { useHouseholdScope } from "@/components/households/household-context";
import { EmptyState, LargeTitle } from "@/components/pantry";
import { PageBar } from "@/components/shell/page-bar";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { PlanShop } from "../planner/plan-shop";
import { AisleHeading, ShopProgress } from "./aisles";

type Mode = "generate" | "update" | "open";

function GenerateListButton({
  disabled = false,
  mode = "generate",
  appearance = "button",
  onDone,
}: {
  disabled?: boolean;
  mode?: Mode;
  appearance?: "button" | "row";
  onDone?: () => void;
}) {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const navigate = useNavigate();
  const planner = useQuery(trpc.planner.get.queryOptions({ householdId }));
  const [review, setReview] = useState(false);
  const generate = useMutation(
    trpc.shopping.generate.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
        onDone?.();
        await navigate({ to: "/shopping/generated" });
      },
    }),
  );
  const stale = planner.data?.stale;
  const label = stale
    ? "Review list"
    : generate.isPending
      ? mode === "update"
        ? "Updating..."
        : "Preparing trip..."
      : mode === "open"
        ? "Combined trip"
        : mode === "update"
          ? "Update combined trip"
          : "Prepare combined trip";
  const busy =
    (disabled && !stale) ||
    generate.isPending ||
    planner.isPending ||
    planner.isError;
  const run = () => {
    if (stale) setReview(true);
    else if (mode === "open") {
      onDone?.();
      void navigate({ to: "/shopping/generated" });
    } else generate.mutate({ householdId });
  };
  return (
    <>
      {review && planner.data?.trip && (
        <PlanShop
          initial={planner.data.trip}
          onClose={() => setReview(false)}
        />
      )}
      {appearance === "row" ? (
        <button
          type="button"
          className="pantry-row"
          disabled={busy}
          onClick={run}
        >
          <span className="pantry-row-icon" aria-hidden="true">
            {mode === "update" || stale ? (
              <RefreshCw size={20} />
            ) : (
              <RouteIcon size={20} />
            )}
          </span>
          <span className="pantry-row-text">
            {label}
            <small className="shop-row-note">
              Grouped by aisle, matching quantities combined
            </small>
          </span>
          <ChevronRight
            size={18}
            className="pantry-row-go"
            aria-hidden="true"
          />
        </button>
      ) : (
        <button
          type="button"
          className="button button-small button-outline"
          disabled={busy}
          onClick={run}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {label}
        </button>
      )}
      <ErrorNotice
        message={generate.error?.message}
        retry={() => generate.mutate({ householdId })}
      />
      <ErrorNotice
        message={planner.error?.message}
        retry={() => void planner.refetch()}
      />
    </>
  );
}

/** Opens, prepares or updates the combined trip; a row in the Shop "More" sheet. */
export function ShoppingListAction({
  hasNeeded,
  disabled,
  onDone,
}: {
  hasNeeded: boolean;
  disabled: boolean;
  onDone?: () => void;
}) {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const plan = useQuery(trpc.shopping.generated.queryOptions({ householdId }));
  if (plan.isPending || plan.isError)
    return (
      <>
        <button type="button" className="pantry-row" disabled>
          <span className="pantry-row-icon" aria-hidden="true">
            <RouteIcon size={20} />
          </span>
          <span className="pantry-row-text">
            {plan.isPending
              ? "Loading combined trip..."
              : "Combined trip unavailable"}
          </span>
        </button>
        <ErrorNotice
          message={plan.error?.message}
          retry={() => void plan.refetch()}
        />
      </>
    );
  const mode: Mode = !plan.data
    ? "generate"
    : plan.data.stale
      ? "update"
      : "open";
  return (
    <GenerateListButton
      mode={mode}
      appearance="row"
      onDone={onDone}
      disabled={disabled || (mode !== "open" && !hasNeeded)}
    />
  );
}

/** Generated trip: needed items grouped by aisle, quantities combined. */
export function GeneratedShoppingList() {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const query = useQuery(trpc.shopping.generated.queryOptions({ householdId }));
  const planner = useQuery(trpc.planner.get.queryOptions({ householdId }));
  const check = useMutation(
    trpc.shopping.checkGroup.mutationOptions({
      onSuccess: () =>
        client.invalidateQueries({ queryKey: trpc.shopping.pathKey() }),
    }),
  );
  const plan = query.data;
  const current = new Map(plan?.items.map((item) => [item.id, item]));
  const rows =
    plan?.content.groups
      .map((group, index) => {
        const items = group.itemIds.flatMap((id) => {
          const item = current.get(id);
          return item && item.status !== "owned" ? [item] : [];
        });
        const needed = items.filter((item) => item.status === "needed");
        const bought = items.length > 0 && !needed.length;
        const quantity = combinedQuantity(
          (bought ? items : needed).map((item) => item.text),
        );
        return { ...group, index, items, bought, quantity };
      })
      .filter((row) => row.items.length) ?? [];
  const remaining = rows.filter((row) => !row.bought).length;
  const boughtRows = rows.filter((row) => row.bought);
  const locked =
    plan?.stale ||
    planner.data?.stale ||
    planner.isPending ||
    planner.isError ||
    check.isPending;
  const renderRow = (row: (typeof rows)[number]) => (
    <li className="shop-item" key={row.index}>
      <div className="shop-row" data-done={row.bought || undefined}>
        <label className="shop-tick">
          <input
            type="checkbox"
            className="pantry-visually-hidden"
            checked={row.bought}
            disabled={locked}
            onChange={() => {
              if (plan)
                check.mutate({
                  householdId,
                  planId: plan.id,
                  groupIndex: row.index,
                  bought: !row.bought,
                });
            }}
            aria-label={`${row.bought ? "Mark needed" : "Mark bought"}: ${row.name}`}
          />
          <span className="shop-check" aria-hidden="true">
            <Check size={16} />
          </span>
          <span className="shop-text">
            <b className="shop-name">{row.name}</b>{" "}
            {row.items.length > 1 && (
              <small>
                {row.items.length} lines
                {row.items.some((item) => item.recipeTitle)
                  ? ` · ${[
                      ...new Set(
                        row.items.flatMap((item) =>
                          item.recipeTitle ? [item.recipeTitle] : [],
                        ),
                      ),
                    ].join(", ")}`
                  : ""}
              </small>
            )}
          </span>
          {row.quantity && <span className="shop-qty">{row.quantity}</span>}
        </label>
      </div>
    </li>
  );
  return (
    <>
      <PageBar />
      <main id="main-content" className="shop-page page-width">
        <LargeTitle
          accent="trip"
          sub="Grouped by aisle, matching quantities combined"
          actions={
            plan ? (
              <Link
                to="/shopping"
                className="button button-small button-outline"
                aria-label="Edit shopping list"
              >
                <Pencil size={16} aria-hidden="true" />
                Edit list
              </Link>
            ) : undefined
          }
        >
          Shopping
        </LargeTitle>
        <LoadingState
          pending={query.isPending}
          label="Loading your shopping trip..."
        >
          <ErrorNotice
            message={query.error?.message}
            retry={() => void query.refetch()}
          />
          {query.isSuccess && !plan && (
            <EmptyState
              title="No combined trip yet"
              description="Choose recipes and groceries, then prepare a combined trip from the list."
              covers={["Basket", "Market"]}
            >
              <Link className="button button-primary" to="/shopping">
                Go to the list
              </Link>
            </EmptyState>
          )}
          {plan && (
            <>
              <ShopProgress left={remaining} total={rows.length} />
              {(plan.stale || planner.data?.stale) && (
                <div className="list-notice" role="status">
                  <RefreshCw size={18} aria-hidden="true" />
                  <p>
                    {planner.data?.stale
                      ? "Your meal plan changed."
                      : "Your ingredients changed."}{" "}
                    Update before ticking items off.
                  </p>
                  <GenerateListButton
                    mode="update"
                    disabled={
                      !plan.items.some((item) => item.status === "needed")
                    }
                  />
                </div>
              )}
              <ErrorNotice
                message={check.error?.message}
                retry={() => {
                  if (check.variables) check.mutate(check.variables);
                }}
              />
              {shoppingCategories.map((category) => {
                const categoryRows = rows.filter(
                  (row) => row.category === category && !row.bought,
                );
                return categoryRows.length ? (
                  <section
                    className="shop-group"
                    key={category}
                    aria-labelledby={`trip-${category}`}
                  >
                    <AisleHeading
                      id={`trip-${category}`}
                      title={category}
                      category={category}
                      count={categoryRows.length}
                    />
                    <ul className="shop-list">{categoryRows.map(renderRow)}</ul>
                  </section>
                ) : null;
              })}
              {!remaining && !plan.stale && (
                <EmptyState
                  title="All done"
                  description="Nice shop. Everything on this trip is bought."
                  covers={["Done", "Home"]}
                  headingLevel={2}
                />
              )}
              {boughtRows.length > 0 && (
                <details className="shop-done">
                  <summary>
                    <ChevronDown size={18} aria-hidden="true" />
                    Bought ({boughtRows.length})
                  </summary>
                  <ul className="shop-list">{boughtRows.map(renderRow)}</ul>
                </details>
              )}
            </>
          )}
        </LoadingState>
      </main>
    </>
  );
}
