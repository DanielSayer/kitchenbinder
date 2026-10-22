import type { AppRouter } from "@prep-sheet/api/routers/index";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  MoreHorizontal,
  Pencil,
  Plus,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import {
  PlanningWorkspace,
  planningRefresh,
  usePlanningScope,
} from "../households/planning-context";
import { PlanningScopeBar } from "../households/scope-bar";
import { MealListNotice } from "../planner/plan-shop";
import { OrganiseDialog } from "../recipes/organise-dialog";
import { RecipePicker } from "./add-recipes";
import { ShoppingListAction } from "./generated-list";
import {
  groceryNeedsReview,
  readShoppingDraft,
  type ShoppingDraft,
} from "./shopping-draft";

type Item = inferRouterOutputs<AppRouter>["shopping"]["list"][number];

function useDraft(key: string, initial: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const update = (text: string) => {
    setValue(text);
    try {
      if (text === initial) localStorage.removeItem(key);
      else localStorage.setItem(key, text);
    } catch {
      /* Keep input in memory when storage is unavailable. */
    }
  };
  return [value, update] as const;
}

function ShoppingRow({ item, userId }: { item: Item; userId: string }) {
  const { scope } = usePlanningScope();
  const trpc = useTRPC();
  const client = useQueryClient();
  const draftKey = `shopping:${userId}:${item.id}`;
  const [legacySource] = useState(() => {
    try {
      return localStorage.getItem(draftKey);
    } catch {
      return null;
    }
  });
  const [stored, setStored] = useState<ShoppingDraft>(() =>
    readShoppingDraft(draftKey, item.text),
  );
  const draft = stored.text;
  const needsReview = groceryNeedsReview(stored, item.text);
  const [storageError, setStorageError] = useState(false);
  const setDraft = (text: string, baseText = stored.baseText) => {
    const next = { text, baseText };
    setStored(next);
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  const clearDraft = () => {
    setStored({ text: item.text, baseText: item.text });
    try {
      sessionStorage.removeItem(draftKey);
      if (
        legacySource !== null &&
        localStorage.getItem(draftKey) === legacySource
      )
        localStorage.removeItem(draftKey);
    } catch {
      /* Optional draft storage. */
    }
  };
  const [editing, setEditing] = useState(draft !== item.text);
  const editInput = useRef<HTMLInputElement>(null);
  const actionTrigger = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) editInput.current?.focus();
    else if (wasEditing.current) actionTrigger.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const refresh = () =>
    client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
  const update = useMutation(
    trpc.shopping.updateItem.mutationOptions({
      onSuccess: async (_, input) => {
        if (input.kind === "text") {
          try {
            sessionStorage.removeItem(draftKey);
            // Remove a legacy draft only if it is still the one we restored.
            if (
              legacySource !== null &&
              localStorage.getItem(draftKey) === legacySource
            )
              localStorage.removeItem(draftKey);
          } catch {
            /* Optional draft storage. */
          }
          setEditing(false);
        }
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    trpc.shopping.removeItem.mutationOptions({ onSuccess: refresh }),
  );
  const pending = update.isPending || remove.isPending;
  return (
    <li className="shopping-row">
      {editing ? (
        <form
          className="shopping-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (needsReview) return;
            update.mutate({
              scope,
              kind: "text",
              id: item.id,
              text: draft,
              expectedText: stored.baseText ?? item.text,
            });
          }}
        >
          <label className="shopping-field">
            Edit item
            <input
              ref={editInput}
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              disabled={pending}
            />
          </label>
          {needsReview && (
            <div className="shopping-edit-review" role="alert">
              <p>
                This grocery changed. Saved item: <strong>{item.text}</strong>
              </p>
              <p>Your edit is still in the field above.</p>
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => {
                  setDraft(draft, item.text);
                  update.reset();
                }}
              >
                Keep my edit, then save
              </button>
            </div>
          )}
          {storageError && (
            <p role="alert">
              This draft could not be stored. Keep this page open until you
              save.
            </p>
          )}
          <div className="shopping-row-actions">
            <button
              type="submit"
              className="button button-small button-outline"
              disabled={pending || needsReview || !draft.trim()}
            >
              {update.isPending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => {
                clearDraft();
                update.reset();
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <label className="shopping-check">
            <input
              type="checkbox"
              checked={item.status === "bought"}
              disabled={pending}
              aria-label={`${item.status === "bought" ? "Mark needed" : "Mark bought"}: ${item.text}`}
              onChange={() =>
                update.mutate({
                  scope,
                  kind: "status",
                  id: item.id,
                  status: item.status === "bought" ? "needed" : "bought",
                })
              }
            />
            <span className={item.status === "bought" ? "shopping-bought" : ""}>
              {item.text}
            </span>
          </label>
          <button
            type="button"
            className="shopping-status-action"
            disabled={pending}
            aria-label={`${item.status === "needed" ? "Already have it" : "Need this"}: ${item.text}`}
            onClick={() =>
              update.mutate({
                kind: "status",
                id: item.id,
                status: item.status === "needed" ? "owned" : "needed",
              })
            }
          >
            {item.status === "needed" ? "Have it" : "Need this"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={actionTrigger}
              className="icon-button"
              aria-label={`Actions for ${item.text}`}
              disabled={pending}
            >
              <MoreHorizontal size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="collection-select-menu shopping-item-menu"
              align="end"
            >
              <DropdownMenuItem
                className="collection-select-manage shopping-item-action"
                onClick={() => {
                  setDraft(item.text, item.text);
                  update.reset();
                  setEditing(true);
                }}
              >
                <Pencil size={16} /> Edit item
              </DropdownMenuItem>
              <DropdownMenuSeparator className="collection-select-divider" />
              <DropdownMenuItem
                className="collection-select-manage shopping-item-action"
                variant="destructive"
                onClick={() => remove.mutate({ scope, id: item.id })}
              >
                <Trash2 size={16} /> Remove item
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <ErrorNotice
        message={update.error?.message || remove.error?.message}
        retry={() => {
          if (update.isError && update.variables) {
            void refresh();
          } else if (remove.variables) remove.mutate(remove.variables);
        }}
      />
    </li>
  );
}

function ItemGroups({ items, userId }: { items: Item[]; userId: string }) {
  const { scope } = usePlanningScope();
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.plannedMealId ?? item.recipeId ?? "other";
    const current = groups.get(key);
    if (current) current.push(item);
    else groups.set(key, [item]);
  }
  return (
    <>
      {[...groups].map(([key, group]) => {
        const first = group[0];
        if (!first) return null;
        return (
          <section className="shopping-group" key={key}>
            <div className="shopping-group-heading">
              <h2>
                {first.recipeId && scope.kind === "personal" ? (
                  <Link
                    to="/recipes/$recipeId"
                    params={{ recipeId: first.recipeId }}
                  >
                    {first.recipeTitle}
                  </Link>
                ) : (
                  (first.recipeTitle ?? "Other groceries")
                )}
              </h2>
            </div>
            <ul>
              {group.map((item) => (
                <ShoppingRow key={item.id} item={item} userId={userId} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

export function ShoppingList() {
  return (
    <PlanningWorkspace>
      <AccountList />
    </PlanningWorkspace>
  );
}
function AccountList() {
  const { scope, scopeKey } = usePlanningScope();
  const { data: session } = authClient.useSession();
  return session ? (
    <ScopedList
      key={`${session.user.id}:${scopeKey}`}
      userId={
        scope.kind === "household"
          ? `${session.user.id}:${scopeKey}`
          : session.user.id
      }
    />
  ) : null;
}

function ScopedList({ userId }: { userId: string }) {
  const { scope } = usePlanningScope();
  const trpc = useTRPC();
  const client = useQueryClient();
  const list = useQuery(
    trpc.shopping.list.queryOptions(scope, planningRefresh(scope)),
  );
  const [picker, setPicker] = useState(false);
  const [reset, setReset] = useState(false);
  const [text, setText] = useDraft(`shopping:${userId}:new`, "");
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const refresh = () =>
    client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
  const add = useMutation(
    trpc.shopping.addItem.mutationOptions({
      onSuccess: async () => {
        setText("");
        setNewId(crypto.randomUUID());
        await refresh();
      },
    }),
  );
  const clear = useMutation(
    trpc.shopping.clear.mutationOptions({
      onSuccess: async () => {
        setReset(false);
        await Promise.all([
          refresh(),
          client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
        ]);
      },
    }),
  );
  const items = list.data ?? [];
  const needed = items.filter((item) => item.status === "needed");
  const bought = items.filter((item) => item.status === "bought");
  const owned = items.filter((item) => item.status === "owned");
  return (
    <main id="main-content" className="shopping-page page-width">
      <div className="page-heading">
        <div>
          <h1>
            <span className="desktop-screen-title">Shopping list</span>
            <span className="mobile-screen-title">Shopping</span>
            <span className="title-dot">.</span>
          </h1>
          <p>
            {scope.kind === "household"
              ? "Your household list, saved as you go."
              : "Your personal list, saved as you go."}
          </p>
        </div>
        <button
          type="button"
          className="button button-small button-outline"
          onClick={() => setPicker(true)}
        >
          <Plus size={18} />
          Add recipes
        </button>
      </div>
      <PlanningScopeBar />
      <MealListNotice />
      {list.isSuccess && (
        <div className="shopping-trip-bar">
          <strong role="status">
            {needed.length} {needed.length === 1 ? "item" : "items"} to buy
          </strong>
          <ShoppingListAction
            hasNeeded={needed.length > 0}
            disabled={add.isPending || clear.isPending}
          />
        </div>
      )}
      <form
        className="shopping-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ scope, id: newId, text });
        }}
      >
        <label className="shopping-field">
          Add a grocery
          <input
            placeholder="e.g. Milk, 2 litres"
            value={text}
            maxLength={2000}
            disabled={add.isPending}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button button-outline"
          disabled={add.isPending || !text.trim()}
        >
          {add.isPending ? "Adding..." : "Add item"}
        </button>
      </form>
      <ErrorNotice
        message={add.error?.message}
        retry={() => add.variables && add.mutate(add.variables)}
      />
      <LoadingState
        pending={list.isPending}
        label="Loading your shopping list..."
      >
        <ErrorNotice
          message={list.error?.message}
          retry={() => void list.refetch()}
        />
        {list.isSuccess && (
          <>
            <div className="shopping-summary">
              <span>Ingredients by recipe</span>
              {items.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  disabled={clear.isPending}
                  onClick={() => setReset(true)}
                >
                  Reset list
                </button>
              )}
            </div>
            {!items.length ? (
              <div className="shopping-empty">
                <ShoppingBasket size={36} />
                <h2>What’s on the menu?</h2>
                <p>
                  Add recipes to get their ingredients, or start with a grocery
                  above.
                </p>
              </div>
            ) : (
              !needed.length && (
                <p className="shopping-empty">
                  Everything is bought or already at home.
                </p>
              )
            )}
            <ItemGroups items={needed} userId={userId} />
            {owned.length > 0 && (
              <details className="shopping-completed">
                <summary>Already have · {owned.length}</summary>
                <ItemGroups items={owned} userId={userId} />
              </details>
            )}
            {bought.length > 0 && (
              <details className="shopping-completed">
                <summary>Bought · {bought.length}</summary>
                <ItemGroups items={bought} userId={userId} />
                <button
                  type="button"
                  className="text-button"
                  disabled={clear.isPending}
                  onClick={() =>
                    clear.mutate({ planningScope: scope, scope: "bought" })
                  }
                >
                  Clear bought items
                </button>
              </details>
            )}
          </>
        )}
      </LoadingState>
      <ErrorNotice
        message={clear.error?.message}
        retry={() => clear.variables && clear.mutate(clear.variables)}
      />
      {picker && <RecipePicker onClose={() => setPicker(false)} />}
      {reset && (
        <OrganiseDialog
          title="Reset shopping list?"
          onClose={() => {
            if (!clear.isPending) setReset(false);
          }}
        >
          <p>Removes all items, including those bought or already at home.</p>
          <ErrorNotice message={clear.error?.message} />
          <div className="organise-dialog-footer shopping-row-actions">
            <button
              type="button"
              className="button button-outline"
              disabled={clear.isPending}
              onClick={() => setReset(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate({ planningScope: scope, scope: "all" })
              }
            >
              {clear.isPending ? "Resetting..." : "Reset list"}
            </button>
          </div>
        </OrganiseDialog>
      )}
    </main>
  );
}
