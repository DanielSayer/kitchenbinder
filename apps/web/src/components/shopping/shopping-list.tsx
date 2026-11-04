import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Eraser,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import {
  useHousehold,
  useHouseholdScope,
} from "@/components/households/household-context";
import { EmptyState, LargeTitle, Segmented, Sheet } from "@/components/pantry";
import { useMeasurePreferences } from "@/components/preferences";
import { PageBar } from "@/components/shell/page-bar";
import { authClient } from "@/lib/auth-client";
import { ErrorNotice, LoadingState } from "../feedback";
import { MealListNotice } from "../planner/plan-shop";
import { RecipePicker } from "./add-recipes";
import { AisleHeading, ShopProgress } from "./aisles";
import { ShoppingListAction } from "./generated-list";
import { ItemSheet } from "./item-sheet";
import { ShopRow } from "./shop-row";
import {
  type Entry,
  type Item,
  type Mode,
  shoppingGroups,
} from "./shopping-groups";
import { useShoppingItems } from "./use-shopping-items";

const modeKey = "shopping-group-mode";
const hintKey = "shopping-swipe-hint";

export function ShoppingList() {
  const { data: session } = authClient.useSession();
  return session ? (
    <ListScreen key={session.user.id} userId={session.user.id} />
  ) : null;
}

function ListScreen({ userId }: { userId: string }) {
  const householdId = useHouseholdScope();
  const household = useHousehold();
  const {
    list,
    items,
    needed,
    bought,
    owned,
    add,
    text,
    setText,
    submit,
    changeStatus,
    changeStatuses,
    removeItem,
    clearBought,
    clearAll,
  } = useShoppingItems(userId);
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
  const [picker, setPicker] = useState({ open: false, key: 0 });
  const [more, setMore] = useState(false);
  const [editor, setEditor] = useState<{ item: Item; open: boolean } | null>(
    null,
  );
  const editing = editor?.item;
  const setEditingOpen = (open: boolean) =>
    setEditor((current) => current && { ...current, open });
  const [nudge, setNudge] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const measures = useMeasurePreferences();
  useEffect(() => {
    try {
      if (localStorage.getItem(hintKey)) return;
      localStorage.setItem(hintKey, "1");
      setNudge(true);
    } catch {
      /* The hint is optional. */
    }
  }, []);
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
        setEditor({ item, open: true });
      }}
    />
  );
  // By aisle, lines of one item that add up share a row with their total.
  const groups = shoppingGroups(needed, mode, measures);
  const entryRow = (entry: Entry) => {
    if ("item" in entry) return row(entry.item);
    const [first] = entry.items;
    if (!first) return null;
    const open = expanded.has(entry.key);
    const recipes = [
      ...new Set(entry.items.flatMap((item) => item.recipeTitle ?? [])),
    ];
    return (
      <Fragment key={entry.key}>
        <ShopRow
          item={first}
          label={entry.name}
          quantity={entry.quantity}
          expanded={open}
          note={
            recipes.length ? recipes.join(", ") : `${entry.items.length} lines`
          }
          swipeable
          onToggle={() =>
            void changeStatuses(entry.items, "bought", `Ticked ${entry.name}`)
          }
          onHave={() =>
            void changeStatuses(
              entry.items,
              "owned",
              `${entry.name} · already have it`,
            )
          }
          onNeed={() => void changeStatuses(entry.items, "needed")}
          onMore={() =>
            setExpanded((current) => {
              const next = new Set(current);
              if (open) next.delete(entry.key);
              else next.add(entry.key);
              return next;
            })
          }
        />
        {open && (
          <li className="shop-lines">
            <ul className="shop-list">{entry.items.map(row)}</ul>
          </li>
        )}
      </Fragment>
    );
  };
  const openPicker = () => {
    setPicker((current) => ({ key: current.key + 1, open: true }));
  };
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
                  <ul className="shop-list">{group.entries.map(entryRow)}</ul>
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
            submit();
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
              // Never disabled/readOnly while saving: that blurs the input and
              // closes the mobile keyboard. "enter", not "done": Android
              // keyboards close themselves on Done.
              enterKeyHint="enter"
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
        {picker.key > 0 && (
          <RecipePicker
            key={picker.key}
            open={picker.open}
            onClose={() =>
              setPicker((current) => ({ ...current, open: false }))
            }
          />
        )}
        {editingItem && (
          <ItemSheet
            key={editingItem.id}
            item={editingItem}
            userId={userId}
            open={editor?.open ?? false}
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
