import {
  combinedQuantity,
  shoppingCategories,
} from "@prep-sheet/db/shopping-plan";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil, RefreshCw, ShoppingBasket } from "lucide-react";
import { useState } from "react";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { PlanShop, TripSummary } from "../planner/plan-shop";

function GenerateListButton({
  disabled = false,
  mode = "generate",
}: {
  disabled?: boolean;
  mode?: "generate" | "update" | "open";
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const navigate = useNavigate();
  const planner = useQuery(trpc.planner.get.queryOptions());
  const [review, setReview] = useState(false);
  const generate = useMutation(
    trpc.shopping.generate.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
        await navigate({ to: "/shopping/generated" });
      },
    }),
  );
  return (
    <div className="shopping-generate-action">
      {review && planner.data?.trip && (
        <PlanShop
          initial={planner.data.trip}
          replace={false}
          onClose={() => setReview(false)}
        />
      )}
      <button
        type="button"
        className={
          mode === "update"
            ? "button button-small button-outline"
            : "button button-primary"
        }
        disabled={
          (disabled && !planner.data?.stale) ||
          generate.isPending ||
          planner.isPending ||
          planner.isError
        }
        onClick={() =>
          planner.data?.stale
            ? setReview(true)
            : mode === "open"
              ? void navigate({ to: "/shopping/generated" })
              : generate.mutate()
        }
      >
        {mode === "update" ? (
          <RefreshCw size={16} />
        ) : (
          <ShoppingBasket size={18} />
        )}
        {planner.data?.stale
          ? "Review meal changes"
          : generate.isPending
            ? mode === "update"
              ? "Updating..."
              : "Preparing trip..."
            : mode === "open"
              ? "Start shopping"
              : mode === "update"
                ? "Update list"
                : "Prepare shopping trip"}
      </button>
      <ErrorNotice
        message={generate.error?.message}
        retry={() => generate.mutate()}
      />
      <ErrorNotice
        message={planner.error?.message}
        retry={() => void planner.refetch()}
      />
    </div>
  );
}

export function ShoppingListAction({
  hasNeeded,
  disabled,
}: {
  hasNeeded: boolean;
  disabled: boolean;
}) {
  const trpc = useTRPC();
  const plan = useQuery(trpc.shopping.generated.queryOptions());
  if (plan.isPending || plan.isError)
    return (
      <div className="shopping-generate-action">
        <button type="button" className="button button-primary" disabled>
          {plan.isPending
            ? "Loading shopping trip..."
            : "Shopping trip unavailable"}
        </button>
        <ErrorNotice
          message={plan.error?.message}
          retry={() => void plan.refetch()}
        />
      </div>
    );
  const mode = !plan.data ? "generate" : plan.data.stale ? "update" : "open";
  return (
    <GenerateListButton
      mode={mode}
      disabled={disabled || (mode !== "open" && !hasNeeded)}
    />
  );
}

export function GeneratedShoppingList() {
  const trpc = useTRPC();
  const client = useQueryClient();
  const query = useQuery(trpc.shopping.generated.queryOptions());
  const planner = useQuery(trpc.planner.get.queryOptions());
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
  const renderRow = (row: (typeof rows)[number]) => (
    <li className="generated-shopping-row" key={row.index}>
      <label className="shopping-check">
        <input
          type="checkbox"
          checked={row.bought}
          disabled={
            plan?.stale ||
            planner.data?.stale ||
            planner.isPending ||
            planner.isError ||
            check.isPending
          }
          onChange={() => {
            if (plan)
              check.mutate({
                planId: plan.id,
                groupIndex: row.index,
                bought: !row.bought,
              });
          }}
          aria-label={`${row.bought ? "Mark needed" : "Mark bought"}: ${row.name}`}
        />
        <span className={row.bought ? "shopping-bought" : ""}>
          <strong>{row.name}</strong>
          {row.quantity && (
            <span className="generated-quantity">{row.quantity}</span>
          )}
        </span>
      </label>
    </li>
  );
  return (
    <main id="main-content" className="shopping-page page-width">
      <div className="page-heading">
        <div>
          <h1>
            Your shopping trip<span className="title-dot">.</span>
          </h1>
          <p>Grouped by aisle, with matching quantities combined.</p>
        </div>
        {plan && (
          <Link
            to="/shopping"
            className="button button-small button-outline"
            aria-label="Edit shopping list"
          >
            <Pencil size={16} />
            Edit
          </Link>
        )}
      </div>
      <TripSummary />
      <LoadingState
        pending={query.isPending}
        label="Loading your shopping trip..."
      >
        <ErrorNotice
          message={query.error?.message}
          retry={() => void query.refetch()}
        />
        {query.isSuccess && !plan && (
          <div className="shopping-empty">
            <ShoppingBasket size={36} />
            <h2>No shopping trip yet</h2>
            <p>
              Choose recipes and groceries, then prepare your shopping trip.
            </p>
            <Link className="button button-primary" to="/shopping">
              Choose ingredients
            </Link>
          </div>
        )}
        {plan && (
          <>
            {(plan.stale || planner.data?.stale) && (
              <div className="shopping-stale" role="status">
                <strong>
                  {planner.data?.stale
                    ? "Your meal plan has changed."
                    : "Your ingredients have changed."}
                </strong>
                <p>Review changes before ticking items off.</p>
                <GenerateListButton
                  mode="update"
                  disabled={
                    !plan.items.some((item) => item.status === "needed")
                  }
                />
              </div>
            )}
            <div className="shopping-summary">
              <strong role="status">
                {remaining} {remaining === 1 ? "item" : "items"} to buy
              </strong>
              <span className="muted">
                Check an item here to mark its ingredients bought.
              </span>
            </div>
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
                <section className="shopping-group" key={category}>
                  <div className="shopping-group-heading">
                    <h2>{category}</h2>
                  </div>
                  <ul>{categoryRows.map(renderRow)}</ul>
                </section>
              ) : null;
            })}
            {!remaining && !plan.stale && (
              <p className="shopping-empty">
                Everything on this list is bought.
              </p>
            )}
            {rows.some((row) => row.bought) && (
              <details className="shopping-completed">
                <summary>
                  Bought · {rows.filter((row) => row.bought).length}
                </summary>
                <section className="shopping-group">
                  <ul>{rows.filter((row) => row.bought).map(renderRow)}</ul>
                </section>
              </details>
            )}
          </>
        )}
      </LoadingState>
    </main>
  );
}
