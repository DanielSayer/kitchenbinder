import type { Coverage, Meal } from "@prep-sheet/db/meal-planner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CookingPot,
  MoreHorizontal,
  Plus,
  RotateCcw,
  ShoppingBasket,
  Utensils,
} from "lucide-react";
import { useState } from "react";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { OrganiseDialog } from "../recipes/organise-dialog";
import { addDays, dateLabel, localDate, weekStart } from "./dates";
import { MealEditor } from "./meal-editor";
import { MealListNotice, mealTitle, PlanShop } from "./plan-shop";

type Editor = {
  date: string;
  meal?: Meal;
  duplicate?: boolean;
  recipeId?: string;
};
export function MealPlanner({ recipeId }: { recipeId?: string }) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const query = useQuery(trpc.planner.get.queryOptions());
  const today = localDate();
  const [week, setWeek] = useState(weekStart(today));
  const [editor, setEditor] = useState<Editor | null>(
    recipeId ? { date: today, recipeId } : null,
  );
  const [shop, setShop] = useState<Coverage | null>(null);
  const [removing, setRemoving] = useState<Meal | null>(null);
  const remove = useMutation(
    trpc.planner.remove.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
          client.invalidateQueries({ queryKey: trpc.shopping.pathKey() }),
        ]);
        setRemoving(null);
      },
    }),
  );
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const meals = query.data?.meals ?? [];
  const trip = query.data?.trip;
  const listedMeals = new Set(trip?.demands.map((demand) => demand.mealId));
  return (
    <main id="main-content" className="planner-page page-width">
      <div className="page-heading">
        <div>
          <h1>
            <span className="desktop-screen-title">Meal planner</span>
            <span className="mobile-screen-title">Planner</span>
            <span className="title-dot">.</span>
          </h1>
          <p>Your private weekly plan.</p>
        </div>
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
          <ShoppingBasket size={18} />
          Make shopping list
        </button>
      </div>
      {query.isSuccess && <MealListNotice />}
      <div className="meal-week-toolbar">
        <h2>
          {dateLabel(week)} to {dateLabel(addDays(week, 6))}
        </h2>
        <div>
          <button
            type="button"
            className="icon-button"
            aria-label="Previous week"
            onClick={() => setWeek(addDays(week, -7))}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="button button-small button-outline"
            onClick={() => setWeek(weekStart(today))}
          >
            Today
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next week"
            onClick={() => setWeek(addDays(week, 7))}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      <LoadingState pending={query.isPending} label="Loading your meal plan...">
        <ErrorNotice
          message={query.error?.message}
          retry={() => void query.refetch()}
        />
        {query.isSuccess && (
          <div className="meal-week">
            {days.map((day) => (
              <section
                className={`meal-day ${day === today ? "meal-today" : ""}`}
                key={day}
                aria-label={dateLabel(day)}
              >
                <div className="meal-day-heading">
                  <h3>
                    {new Date(`${day}T12:00:00`).toLocaleDateString("en-AU", {
                      weekday: "short",
                    })}
                    <span>{new Date(`${day}T12:00:00`).getDate()}</span>
                  </h3>
                </div>
                <div className="meal-day-entries">
                  {meals
                    .filter((meal) => meal.date === day)
                    .sort(
                      (a, b) =>
                        ["Breakfast", "Lunch", "Dinner", ""].indexOf(a.slot) -
                        ["Breakfast", "Lunch", "Dinner", ""].indexOf(b.slot),
                    )
                    .map((meal) => (
                      <article
                        className={`meal-card meal-card-${meal.kind}`}
                        key={meal.id}
                      >
                        <div className="meal-card-top">
                          <span>
                            {meal.kind === "recipe" ? (
                              <CookingPot size={16} />
                            ) : meal.kind === "leftovers" ? (
                              <RotateCcw size={16} />
                            ) : (
                              <Utensils size={16} />
                            )}
                            {meal.slot ||
                              (meal.kind === "recipe"
                                ? "Cook"
                                : meal.kind === "leftovers"
                                  ? "Leftovers"
                                  : "Eating out")}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="icon-button"
                              aria-label={`Actions for ${mealTitle(meal, meals)}`}
                            >
                              <MoreHorizontal size={18} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              className="collection-select-menu"
                              align="end"
                            >
                              <DropdownMenuItem
                                className="collection-select-manage"
                                onClick={() =>
                                  setEditor({ date: meal.date, meal })
                                }
                              >
                                Edit or move
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="collection-select-manage"
                                onClick={() =>
                                  setEditor({
                                    date: addDays(meal.date, 1),
                                    meal,
                                    duplicate: true,
                                  })
                                }
                              >
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="collection-select-manage"
                                onClick={() => {
                                  remove.reset();
                                  setRemoving(meal);
                                }}
                              >
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {meal.kind === "recipe" ? (
                          <Link
                            className="meal-card-title"
                            to="/recipes/$recipeId"
                            params={{ recipeId: meal.recipeId }}
                          >
                            {meal.title}
                          </Link>
                        ) : (
                          <strong className="meal-card-title">
                            {mealTitle(meal, meals)}
                          </strong>
                        )}
                        <p>
                          {meal.kind === "recipe"
                            ? `Cook ${meal.cook} · Eat ${meal.eat}`
                            : meal.kind === "leftovers"
                              ? `${meal.portions} portions`
                              : "No ingredients needed"}
                        </p>
                        {listedMeals.has(meal.id) && (
                          <span className="meal-on-list">
                            <Check size={13} />
                            On list
                          </span>
                        )}
                        {meal.kind === "recipe" && meal.cook > meal.eat && (
                          <small>Save {meal.cook - meal.eat} portions</small>
                        )}
                        {query.data.issues
                          .filter((issue) => issue.id === meal.id)
                          .map((issue) => (
                            <p className="meal-warning" key={issue.message}>
                              {issue.message}
                            </p>
                          ))}
                      </article>
                    ))}
                </div>
                <button
                  type="button"
                  className="meal-add"
                  aria-label={`Add meal for ${dateLabel(day)}`}
                  onClick={() => setEditor({ date: day })}
                >
                  <Plus size={17} />
                  Add meal
                </button>
              </section>
            ))}
          </div>
        )}
      </LoadingState>
      {editor && <MealEditor {...editor} onClose={() => setEditor(null)} />}
      {shop && <PlanShop initial={shop} onClose={() => setShop(null)} />}
      {removing && (
        <OrganiseDialog
          title="Remove meal?"
          onClose={() => {
            if (!remove.isPending) setRemoving(null);
          }}
        >
          <div className="meal-form">
            <p>
              Remove {mealTitle(removing, meals)} from{" "}
              {dateLabel(removing.date)}?
            </p>
            {meals.some(
              (meal) =>
                meal.kind === "leftovers" && meal.sourceId === removing.id,
            ) && (
              <p className="meal-warning">
                Linked leftovers will need another cooking session.
              </p>
            )}
            <ErrorNotice message={remove.error?.message} />
            <div className="organise-dialog-footer">
              <button
                className="button button-outline"
                type="button"
                disabled={remove.isPending}
                onClick={() => setRemoving(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (query.data)
                    remove.mutate({
                      id: removing.id,
                      revision: query.data.revision,
                    });
                }}
              >
                {remove.isPending ? "Removing..." : "Remove meal"}
              </button>
            </div>
          </div>
        </OrganiseDialog>
      )}
    </main>
  );
}
