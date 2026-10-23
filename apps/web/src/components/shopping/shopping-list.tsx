import type { AppRouter } from "@prep-sheet/api/routers/index";
import {
  categoriseGrocery,
  shoppingCategories,
} from "@prep-sheet/db/shopping-plan";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  House,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  useHousehold,
  useHouseholdScope,
} from "@/components/households/household-context";
import {
  EmptyState,
  LargeTitle,
  Segmented,
  Sheet,
  undoToast,
} from "@/components/pantry";
import { PageBar } from "@/components/shell/page-bar";
import { authClient } from "@/lib/auth-client";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { MealListNotice } from "../planner/plan-shop";
import { RecipePicker } from "./add-recipes";
import { AisleHeading, ShopProgress } from "./aisles";
import { ShoppingListAction } from "./generated-list";

type Item = inferRouterOutputs<AppRouter>["shopping"]["list"][number];
type Status = Item["status"];
type Mode = "aisle" | "recipe";

const modeKey = "shopping-group-mode";
const hintKey = "shopping-swipe-hint";
const SWIPE_COMMIT_PX = 96;

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

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

/**
 * One list row. Tap to tick; swipe left (or the Have it button, shown on
 * desktop and to keyboard/screen-reader users) to mark it already at home.
 */
function ShopRow({
  item,
  note,
  swipeable,
  nudge,
  onToggle,
  onHave,
  onNeed,
  onMore,
}: {
  item: Item;
  note?: string | null;
  swipeable: boolean;
  nudge?: boolean;
  onToggle: () => void;
  onHave: () => void;
  onNeed: () => void;
  onMore: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; axis?: "x" } | null>(null);
  const offset = useRef(0);
  const swiped = useRef(false);
  const move = (value: number) => {
    offset.current = value;
    setDx(value);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!swipeable || (event.pointerType === "mouse" && event.button !== 0))
      return;
    drag.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const mx = event.clientX - current.x;
    const my = event.clientY - current.y;
    if (!current.axis) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        current.axis = "x";
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
      } else if (Math.abs(my) > 8) {
        drag.current = null;
        return;
      } else return;
    }
    move(Math.min(0, mx));
  };
  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.axis !== "x") return;
    swiped.current = true;
    setDragging(false);
    const width = row.current?.offsetWidth ?? 320;
    if (offset.current < -Math.min(SWIPE_COMMIT_PX, width * 0.3)) {
      move(-width);
      window.setTimeout(onHave, 160);
    } else move(0);
  };
  const onPointerCancel = () => {
    drag.current = null;
    setDragging(false);
    move(0);
  };
  const bought = item.status === "bought";
  return (
    <li className="shop-item" data-nudge={nudge || undefined}>
      {swipeable && (
        <div className="shop-under" aria-hidden="true">
          <House size={18} />
          Have it
        </div>
      )}
      <div
        ref={row}
        className="shop-row"
        data-done={item.status !== "needed" || undefined}
        data-dragging={dragging || undefined}
        data-swipe={swipeable || undefined}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={(event) => {
          if (!swiped.current) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <label className="shop-tick">
          <input
            type="checkbox"
            className="pantry-visually-hidden"
            checked={bought}
            aria-label={`${bought ? "Mark needed" : "Mark bought"}: ${item.text}`}
            onChange={onToggle}
          />
          <span className="shop-check" aria-hidden="true">
            <Check size={16} />
          </span>
          <span className="shop-text">
            <b className="shop-name">{item.text}</b>{" "}
            {note && <small>{note}</small>}
          </span>
        </label>
        {item.status === "needed" ? (
          <button
            type="button"
            className="shop-have"
            aria-label={`Already have it: ${item.text}`}
            onClick={onHave}
          >
            <House size={16} aria-hidden="true" />
            <span>Have it</span>
          </button>
        ) : item.status === "owned" ? (
          <button
            type="button"
            className="shop-have"
            data-visible
            aria-label={`Need this: ${item.text}`}
            onClick={onNeed}
          >
            Need this
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button shop-more"
          aria-label={`Actions for ${item.text}`}
          onClick={onMore}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </li>
  );
}

function ItemSheet({
  item,
  userId,
  open,
  onClose,
  onStatus,
  onRemove,
}: {
  item: Item;
  userId: string;
  open: boolean;
  onClose: () => void;
  onStatus: (status: Status) => void;
  onRemove: () => void;
}) {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const draftKey = `shopping:${userId}:${item.id}`;
  const [draft, setDraft] = useDraft(draftKey, item.text);
  const update = useMutation(
    trpc.shopping.updateItem.mutationOptions({
      onSuccess: async () => {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* Optional draft storage. */
        }
        await client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
        onClose();
      },
    }),
  );
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !update.isPending) onClose();
      }}
      title="Edit item"
      footer={
        <>
          <button
            type="submit"
            form={`shop-edit-${item.id}`}
            className="button button-primary button-block"
            disabled={update.isPending || !draft.trim()}
          >
            {update.isPending ? "Saving..." : "Save"}
          </button>
          <div className="shop-sheet-secondary">
            <button
              type="button"
              className="button button-ghost"
              disabled={update.isPending}
              onClick={() =>
                onStatus(item.status === "needed" ? "owned" : "needed")
              }
            >
              {item.status === "needed" ? "Have it" : "Need this"}
            </button>
            <button
              type="button"
              className="button button-ghost shop-remove"
              disabled={update.isPending}
              onClick={onRemove}
            >
              <Trash2 size={16} aria-hidden="true" />
              Remove
            </button>
          </div>
        </>
      }
    >
      <form
        id={`shop-edit-${item.id}`}
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            householdId,
            kind: "text",
            id: item.id,
            text: draft,
          });
        }}
      >
        <label className="pick-field">
          <span>Item</span>
          <input
            value={draft}
            maxLength={2000}
            disabled={update.isPending}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {item.recipeTitle && (
          <p className="meal-sheet-hint shop-sheet-from">
            From {item.recipeTitle}
          </p>
        )}
        <ErrorNotice message={update.error?.message} />
      </form>
    </Sheet>
  );
}

export function ShoppingList() {
  const { data: session } = authClient.useSession();
  return session ? (
    <ListScreen key={session.user.id} userId={session.user.id} />
  ) : null;
}

function ListScreen({ userId }: { userId: string }) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const householdId = useHouseholdScope();
  const household = useHousehold();
  const client = useQueryClient();
  const listKey = trpc.shopping.list.queryKey({ householdId });
  const list = useQuery(trpc.shopping.list.queryOptions({ householdId }));
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem(modeKey) === "recipe" ? "recipe" : "aisle";
    } catch {
      return "aisle";
    }
  });
  const setMode = (next: Mode) => {
    setModeState(next);
    try {
      localStorage.setItem(modeKey, next);
    } catch {
      /* Optional preference. */
    }
  };
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingOpen, setEditingOpen] = useState(false);
  const [text, setText] = useDraft(`shopping:${userId}:new`, "");
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(hintKey)) return;
      localStorage.setItem(hintKey, "1");
      setNudge(true);
    } catch {
      /* The hint is optional. */
    }
  }, []);
  const refresh = () =>
    client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
  const statusUpdate = useMutation(trpc.shopping.updateItem.mutationOptions());
  const changeStatus = async (item: Item, status: Status, message?: string) => {
    const previous = item.status;
    client.setQueryData(listKey, (old) =>
      old?.map((entry) =>
        entry.id === item.id ? { ...entry, status } : entry,
      ),
    );
    if (message)
      undoToast(message, {
        id: "shopping-status",
        onUndo: () => void changeStatus({ ...item, status }, previous),
      });
    try {
      await statusUpdate.mutateAsync({
        householdId,
        kind: "status",
        id: item.id,
        status,
      });
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't update that item."));
    } finally {
      await refresh();
    }
  };
  const unhide = (ids: readonly string[]) =>
    setHidden((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  // Undo, not "are you sure?": hide now, delete when the toast closes.
  const removeLater = (
    ids: readonly string[],
    message: string,
    commit: () => Promise<unknown>,
  ) => {
    if (!ids.length) return;
    setHidden((current) => new Set([...current, ...ids]));
    undoToast(message, {
      onUndo: () => unhide(ids),
      onCommit: async () => {
        try {
          await commit();
          await Promise.all([
            refresh(),
            client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
          ]);
        } catch (cause) {
          toast.error(errorText(cause, "Couldn't remove those items."));
        } finally {
          unhide(ids);
        }
      },
    });
  };
  const removeItem = (item: Item) =>
    removeLater([item.id], `Removed ${item.text}`, () =>
      trpcClient.shopping.removeItem.mutate({ householdId, id: item.id }),
    );
  const add = useMutation(
    trpc.shopping.addItem.mutationOptions({
      onSuccess: async (_, input) => {
        setText("");
        setNewId(crypto.randomUUID());
        await refresh();
        undoToast(`Added ${input.text.trim()}`, {
          onUndo: () =>
            void trpcClient.shopping.removeItem
              .mutate({ householdId, id: input.id })
              .then(refresh, (cause) =>
                toast.error(errorText(cause, "Couldn't undo.")),
              ),
        });
      },
    }),
  );
  const items = (list.data ?? []).filter((item) => !hidden.has(item.id));
  const needed = items.filter((item) => item.status === "needed");
  const bought = items.filter((item) => item.status === "bought");
  const owned = items.filter((item) => item.status === "owned");
  const recipeCount = new Set(
    items.flatMap((item) => (item.recipeId ? [item.recipeId] : [])),
  ).size;
  const extras = items.filter((item) => !item.recipeId).length;
  const members =
    household.households.data?.find((entry) => entry.id === householdId)
      ?.members ?? [];
  const addedBy = (item: Item) => {
    if (!householdId || item.recipeId) return null;
    if (!item.addedBy || item.addedBy === userId) return "Added by you";
    const name = members.find((member) => member.id === item.addedBy)?.name;
    return `Added by ${name?.split(" ")[0] || "a member"}`;
  };
  const noteFor = (item: Item) =>
    mode === "aisle" ? (item.recipeTitle ?? addedBy(item)) : addedBy(item);
  const firstNeeded = needed[0]?.id;
  const row = (item: Item) => (
    <ShopRow
      key={item.id}
      item={item}
      note={noteFor(item)}
      swipeable={item.status === "needed"}
      nudge={nudge && item.id === firstNeeded}
      onToggle={() =>
        void changeStatus(
          item,
          item.status === "bought" ? "needed" : "bought",
          item.status === "bought"
            ? `${item.text} back on the list`
            : `Ticked ${item.text}`,
        )
      }
      onHave={() =>
        void changeStatus(item, "owned", `${item.text} · already have it`)
      }
      onNeed={() =>
        void changeStatus(item, "needed", `${item.text} back on the list`)
      }
      onMore={() => {
        setEditing(item);
        setEditingOpen(true);
      }}
    />
  );
  const groups =
    mode === "aisle"
      ? shoppingCategories.flatMap((category) => {
          const entries = needed.filter(
            (item) => categoriseGrocery(item.text) === category,
          );
          return entries.length
            ? [{ key: category, title: category, category, entries }]
            : [];
        })
      : [
          ...needed
            .reduce((map, item) => {
              const key = item.plannedMealId ?? item.recipeId ?? "other";
              map.set(key, [...(map.get(key) ?? []), item]);
              return map;
            }, new Map<string, Item[]>())
            .entries(),
        ].map(([key, entries]) => ({
          key,
          title: entries[0]?.recipeTitle ?? "Other groceries",
          category: undefined,
          entries,
        }));
  const openPicker = () => {
    setPickerKey((current) => current + 1);
    setPicker(true);
  };
  const clearBought = () =>
    removeLater(
      bought.map((item) => item.id),
      `Cleared ${bought.length} bought ${bought.length === 1 ? "item" : "items"}`,
      () => trpcClient.shopping.clear.mutate({ householdId, scope: "bought" }),
    );
  const clearAll = () =>
    removeLater(
      items.map((item) => item.id),
      "List cleared",
      () => trpcClient.shopping.clear.mutate({ householdId, scope: "all" }),
    );
  const editingItem = editing
    ? (items.find((item) => item.id === editing.id) ?? editing)
    : null;
  const sub = items.length
    ? [
        recipeCount
          ? `From ${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}`
          : null,
        extras ? `${extras} ${extras === 1 ? "extra" : "extras"}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  return (
    <>
      <PageBar />
      <main id="main-content" className="shop-page page-width">
        <LargeTitle
          sub={sub}
          actions={
            <>
              <button
                type="button"
                className="button button-small button-outline"
                onClick={openPicker}
              >
                <Plus size={16} aria-hidden="true" />
                <span>Recipes</span>
                <span className="pantry-visually-hidden"> to the list</span>
              </button>
              <button
                type="button"
                className="icon-button shop-options"
                aria-label="List options"
                onClick={() => setMore(true)}
              >
                <MoreHorizontal size={20} />
              </button>
            </>
          }
        >
          Shopping
        </LargeTitle>
        <MealListNotice />
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
              {items.length > 0 && (
                <>
                  <ShopProgress
                    left={needed.length}
                    total={needed.length + bought.length}
                  />
                  <Segmented
                    label="Group items"
                    className="shop-seg"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "aisle", label: "By aisle" },
                      { value: "recipe", label: "By recipe" },
                    ]}
                  />
                </>
              )}
              {!items.length ? (
                <EmptyState
                  title="Nothing on the list"
                  description="Add an item below, or pull in ingredients from your recipes."
                  covers={["Lemons", "Bread"]}
                >
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={openPicker}
                  >
                    <BookOpen size={18} aria-hidden="true" />
                    Add from recipes
                  </button>
                </EmptyState>
              ) : (
                !needed.length && (
                  <EmptyState
                    title="All done"
                    description="Nice shop. Everything is bought or already at home."
                    covers={["Done", "Home"]}
                  />
                )
              )}
              {groups.map((group) => (
                <section
                  className="shop-group"
                  key={group.key}
                  aria-labelledby={`shop-${group.key}`}
                >
                  <AisleHeading
                    id={`shop-${group.key}`}
                    title={group.title}
                    category={group.category}
                    kind={group.key === "other" ? "manual" : "recipe"}
                    count={group.entries.length}
                  />
                  <ul className="shop-list">{group.entries.map(row)}</ul>
                </section>
              ))}
              {owned.length > 0 && (
                <details className="shop-done">
                  <summary>
                    <ChevronDown size={18} aria-hidden="true" />
                    Have it ({owned.length})
                  </summary>
                  <ul className="shop-list">{owned.map(row)}</ul>
                </details>
              )}
              {bought.length > 0 && (
                <details className="shop-done">
                  <summary>
                    <ChevronDown size={18} aria-hidden="true" />
                    Bought ({bought.length})
                  </summary>
                  <ul className="shop-list">{bought.map(row)}</ul>
                  <button
                    type="button"
                    className="button button-small button-ghost shop-clear"
                    onClick={clearBought}
                  >
                    <Eraser size={16} aria-hidden="true" />
                    Clear bought items
                  </button>
                </details>
              )}
            </>
          )}
        </LoadingState>
        <form
          className="shop-quick"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) add.mutate({ householdId, id: newId, text });
          }}
        >
          <ErrorNotice
            message={add.error?.message}
            retry={() => add.variables && add.mutate(add.variables)}
          />
          <div className="shop-quick-bar">
            <input
              placeholder="Add an item… e.g. 2 L milk"
              aria-label="Add an item"
              value={text}
              maxLength={2000}
              enterKeyHint="done"
              disabled={add.isPending}
              onChange={(event) => setText(event.target.value)}
            />
            <button
              type="submit"
              aria-label="Add"
              disabled={add.isPending || !text.trim()}
            >
              <Plus size={20} />
            </button>
          </div>
        </form>
        <Sheet open={more} onOpenChange={setMore} title="List options">
          <div className="pantry-list">
            <button
              type="button"
              className="pantry-row"
              onClick={() => {
                setMore(false);
                openPicker();
              }}
            >
              <span className="pantry-row-icon" aria-hidden="true">
                <BookOpen size={20} />
              </span>
              <span className="pantry-row-text">
                Add from recipes
                <small className="shop-row-note">
                  Any recipe you can open, from any collection
                </small>
              </span>
              <ChevronRight
                size={18}
                className="pantry-row-go"
                aria-hidden="true"
              />
            </button>
            {list.isSuccess && (
              <ShoppingListAction
                hasNeeded={needed.length > 0}
                disabled={add.isPending}
                onDone={() => setMore(false)}
              />
            )}
            <button
              type="button"
              className="pantry-row"
              disabled={!bought.length}
              onClick={() => {
                setMore(false);
                clearBought();
              }}
            >
              <span className="pantry-row-icon" aria-hidden="true">
                <Eraser size={20} />
              </span>
              <span className="pantry-row-text">
                Clear bought items
                <small className="shop-row-note">
                  {bought.length
                    ? `${bought.length} ticked off`
                    : "Nothing ticked off yet"}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="pantry-row shop-danger-row"
              disabled={!items.length}
              onClick={() => {
                setMore(false);
                clearAll();
              }}
            >
              <span className="pantry-row-icon" aria-hidden="true">
                <Trash2 size={20} />
              </span>
              <span className="pantry-row-text">
                Clear the whole list
                <small className="shop-row-note">
                  Removes everything, including bought and at-home items
                </small>
              </span>
            </button>
          </div>
        </Sheet>
        {pickerKey > 0 && (
          <RecipePicker
            key={pickerKey}
            open={picker}
            onClose={() => setPicker(false)}
          />
        )}
        {editingItem && (
          <ItemSheet
            key={editingItem.id}
            item={editingItem}
            userId={userId}
            open={editingOpen}
            onClose={() => setEditingOpen(false)}
            onStatus={(status) => {
              setEditingOpen(false);
              void changeStatus(
                editingItem,
                status,
                status === "owned"
                  ? `${editingItem.text} · already have it`
                  : `${editingItem.text} back on the list`,
              );
            }}
            onRemove={() => {
              setEditingOpen(false);
              removeItem(editingItem);
            }}
          />
        )}
      </main>
    </>
  );
}
