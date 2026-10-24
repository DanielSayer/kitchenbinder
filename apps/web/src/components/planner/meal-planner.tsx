import type { Coverage, Meal } from "@prep-sheet/db/meal-planner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  NotebookPen,
  Play,
  Plus,
  RotateCcw,
  ShoppingBasket,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useHouseholdScope } from "@/components/households/household-context";
import {
  LargeTitle,
  RecipeCover,
  StickyCta,
  undoToast,
} from "@/components/pantry";
import { PageBar } from "@/components/shell/page-bar";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import {
  addDays,
  dayOfMonth,
  localDate,
  shortDate,
  weekDays,
  weekday,
  weekRangeLabel,
  weekStart,
  weeksBetween,
} from "./dates";
import { MealEditor } from "./meal-editor";
import { MealListNotice, mealTitle, PlanShop } from "./plan-shop";

type Editor = {
  key: number;
  date: string;
  meal?: Meal;
  duplicate?: boolean;
  recipeId?: string;
};
const slotOrder = ["Breakfast", "Lunch", "Dinner", ""];

function weekTitle(offset: number, start: string) {
  if (offset === 0) return "This week";
  if (offset === 1) return "Next week";
  if (offset === -1) return "Last week";
  return `Week of ${shortDate(start)}`;
}

export function MealPlanner({ recipeId }: { recipeId?: string }) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const query = useQuery(trpc.planner.get.queryOptions({ householdId }));
  const today = localDate();
  const thisWeek = weekStart(today);
  const [week, setWeek] = useState(thisWeek);
  const [editor, setEditor] = useState<Editor | null>(
    recipeId ? { key: 0, date: today, recipeId } : null,
  );
  const [editorOpen, setEditorOpen] = useState(Boolean(recipeId));
  const [shop, setShop] = useState<Coverage | null>(null);
  // Meals removed but still inside their undo window.
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const openEditor = (next: Omit<Editor, "key">) => {
    setEditor((current) => ({ ...next, key: (current?.key ?? 0) + 1 }));
    setEditorOpen(true);
  };
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
      client.invalidateQueries({ queryKey: trpc.shopping.pathKey() }),
    ]);
  const unhide = (id: string) =>
    setRemoving((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  const remove = (meal: Meal, meals: Meal[]) => {
    setEditorOpen(false);
    setRemoving((current) => new Set(current).add(meal.id));
    const linked = meals.some(
      (entry) => entry.kind === "leftovers" && entry.sourceId === meal.id,
    );
    undoToast(
      `Removed ${mealTitle(meal, meals)}${linked ? ". Its leftovers need another cook." : ""}`,
      {
        onUndo: () => unhide(meal.id),
        onCommit: async () => {
          try {
            // Remove against the latest revision; the undo window may be long.
            const fresh = await client.fetchQuery({
              ...trpc.planner.get.queryOptions({ householdId }),
              staleTime: 0,
            });
            if (fresh.meals.some((entry) => entry.id === meal.id))
              await trpcClient.planner.remove.mutate({
                householdId,
                id: meal.id,
                revision: fresh.revision,
              });
            await refresh();
          } catch (cause) {
            toast.error(
              cause instanceof Error
                ? cause.message
                : "Couldn't remove that meal.",
            );
          } finally {
            unhide(meal.id);
          }
        },
      },
    );
  };
  const offset = weeksBetween(thisWeek, week);
  const days = weekDays(week);
  const meals = (query.data?.meals ?? []).filter(
    (meal) => !removing.has(meal.id),
  );
  const mealsOn = (day: string) =>
    meals
      .filter((meal) => meal.date === day)
      .sort((a, b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot));
  const trip = query.data?.trip;
  const listed = new Set(trip?.demands.map((demand) => demand.mealId));
  const planned = days.filter((day) => mealsOn(day).length).length;
  const currentWeek = offset === 0;
  const upcoming = currentWeek ? days.filter((day) => day >= today) : days;
  const earlier = currentWeek
    ? days.filter((day) => day < today && mealsOn(day).length)
    : [];
  const title = weekTitle(offset, week);
  const issuesFor = (id: string) =>
    query.data?.issues.filter((issue) => issue.id === id) ?? [];

  const mealCard = (meal: Meal, day: string, compact = false) => {
    const isToday = day === today;
    const past = day < today;
    const title = mealTitle(meal, meals);
    const detail =
      meal.kind === "recipe"
        ? `Cook ${meal.cook} · eat ${meal.eat}${meal.cook > meal.eat ? ` · ${meal.cook - meal.eat} spare` : ""}`
        : meal.kind === "leftovers"
          ? `Leftovers · ${meal.portions} portions`
          : "Note";
    return (
      <li key={meal.id}>
        <div
          className="plan-meal"
          data-today={(isToday && !compact) || undefined}
          data-past={past || undefined}
          data-kind={meal.kind}
        >
          <button
            type="button"
            className="plan-meal-main"
            onClick={() => openEditor({ date: meal.date, meal })}
          >
            {meal.kind === "recipe" ? (
              <RecipeCover
                id={meal.recipeId}
                title={meal.title}
                size={compact ? "thumb" : "list"}
              />
            ) : (
              <span className="plan-meal-icon" aria-hidden="true">
                {meal.kind === "leftovers" ? (
                  <RotateCcw size={20} />
                ) : (
                  <NotebookPen size={20} />
                )}
              </span>
            )}
            <span className="plan-meal-text">
              <b>{title}</b>{" "}
              <small>
                {listed.has(meal.id) && (
                  <span className="plan-pill" data-tone="olive">
                    On list
                  </span>
                )}
                {compact
                  ? `${weekday(day, "short")} · ${meal.kind === "out" ? "note" : meal.kind === "leftovers" ? "leftovers" : "cooked"}`
                  : [meal.slot, detail].filter(Boolean).join(" · ")}
              </small>
            </span>
          </button>
          {isToday && meal.kind === "recipe" && !compact && (
            <Link
              className="plan-cook"
              to="/recipes/$recipeId"
              params={{ recipeId: meal.recipeId }}
              aria-label={`Open ${meal.title}`}
            >
              <Play size={18} aria-hidden="true" />
            </Link>
          )}
        </div>
        {issuesFor(meal.id).map((issue) => (
          <p className="meal-warning" key={issue.message}>
            {issue.message}
          </p>
        ))}
      </li>
    );
  };

  const agendaDay = (day: string) => {
    const entries = mealsOn(day);
    const isToday = day === today;
    const past = day < today;
    return (
      <section
        key={day}
        id={`plan-day-${day}`}
        className="plan-day"
        data-past={past || undefined}
        aria-labelledby={`plan-day-${day}-title`}
      >
        <h2 id={`plan-day-${day}-title`} className="plan-day-title">
          {weekday(day)}
          {isToday ? (
            <span className="plan-tonight">Today</span>
          ) : (
            <small>{shortDate(day)}</small>
          )}
          {entries.length > 0 && (
            <button
              type="button"
              className="icon-button plan-day-add"
              aria-label={`Add another meal on ${weekday(day)} ${shortDate(day)}`}
              onClick={() => openEditor({ date: day })}
            >
              <Plus size={18} />
            </button>
          )}
        </h2>
        {entries.length ? (
          <ul className="plan-meals">
            {entries.map((meal) => mealCard(meal, day))}
          </ul>
        ) : (
          <button
            type="button"
            className="plan-add"
            aria-label={`Add a meal on ${weekday(day)} ${shortDate(day)}`}
            onClick={() => openEditor({ date: day })}
          >
            <span aria-hidden="true">
              <Plus size={16} />
            </span>
            Add a meal
          </button>
        )}
      </section>
    );
  };

  return (
    <>
      <PageBar />
      <main id="main-content" className="plan-page page-width">
        <div className="plan-week-nav">
          <button
            type="button"
            className="icon-button plan-nav-button"
            aria-label="Previous week"
            onClick={() => setWeek(addDays(week, -7))}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="plan-range" aria-live="polite">
            {weekRangeLabel(week)}
          </span>
          <span className="plan-week-nav-end">
            {!currentWeek && (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => setWeek(thisWeek)}
              >
                Today
              </button>
            )}
            <button
              type="button"
              className="icon-button plan-nav-button"
              aria-label="Next week"
              onClick={() => setWeek(addDays(week, 7))}
            >
              <ChevronRight size={18} />
            </button>
          </span>
        </div>
        <LargeTitle>{title}</LargeTitle>
        <ol className="plan-strip" aria-label="Days this week">
          {days.map((day) => (
            <li key={day}>
              <a
                className="plan-strip-day"
                href={`#plan-day-${day}`}
                aria-current={day === today ? "date" : undefined}
                data-past={day < today || undefined}
                aria-label={`${weekday(day)} ${shortDate(day)}, ${mealsOn(day).length ? `${mealsOn(day).length} planned` : "nothing planned"}`}
                onClick={(event) => {
                  const target = document.getElementById(`plan-day-${day}`);
                  event.preventDefault();
                  if (target)
                    target.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  else openEditor({ date: day });
                }}
              >
                <small>{weekday(day, "short")}</small>
                <b className="plan-strip-num">{dayOfMonth(day)}</b>
                <i data-empty={!mealsOn(day).length || undefined} />
              </a>
            </li>
          ))}
        </ol>
        {query.isSuccess && (
          <div className="plan-progress">
            <span>
              <b>{planned} of 7</b> days planned
            </span>
            <span className="plan-progress-bar" aria-hidden="true">
              <i style={{ width: `${(planned / 7) * 100}%` }} />
            </span>
          </div>
        )}
        {query.isSuccess && <MealListNotice />}
        <LoadingState
          pending={query.isPending}
          label="Loading your meal plan..."
        >
          <ErrorNotice
            message={query.error?.message}
            retry={() => void query.refetch()}
          />
          {query.isSuccess && (
            <div className="plan-agenda">
              {upcoming.map(agendaDay)}
              {earlier.length > 0 && (
                <section
                  className="plan-day plan-earlier"
                  aria-labelledby="plan-earlier"
                >
                  <h2 id="plan-earlier" className="plan-day-title">
                    Earlier this week
                  </h2>
                  <ul className="plan-meals">
                    {earlier.flatMap((day) =>
                      mealsOn(day).map((meal) => mealCard(meal, day, true)),
                    )}
                  </ul>
                </section>
              )}
            </div>
          )}
        </LoadingState>
        <StickyCta>
          <button
            type="button"
            className="button button-primary"
            disabled={!query.isSuccess}
            onClick={() =>
              setShop({
                shoppingDate: week < today ? week : today,
                start: week,
                end: addDays(week, 6),
              })
            }
          >
            <ShoppingBasket size={20} aria-hidden="true" />
            {offset === 0
              ? "Shop for this week"
              : offset === 1
                ? "Shop for next week"
                : "Shop for this week's meals"}
          </button>
        </StickyCta>
        {editor && (
          <MealEditor
            key={editor.key}
            date={editor.date}
            meal={editor.meal}
            duplicate={editor.duplicate}
            recipeId={editor.recipeId}
            open={editorOpen}
            onClose={() => setEditorOpen(false)}
            onDuplicate={(meal) =>
              openEditor({
                date: addDays(meal.date, 1),
                meal,
                duplicate: true,
              })
            }
            onRemove={(meal) => remove(meal, query.data?.meals ?? [])}
          />
        )}
        {shop && <PlanShop initial={shop} onClose={() => setShop(null)} />}
      </main>
    </>
  );
}
