import type { AppRouter } from "@prep-sheet/api/routers/index";
import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { BookOpen, Check, Clock } from "lucide-react";
import { FavouriteButton } from "./favourite-button";
import { RatingControl } from "./rating-control";
import { recipeTimeSummary } from "./recipe-time";

export function RecipeCard({
  recipe,
  selection,
}: {
  recipe: inferRouterOutputs<AppRouter>["recipes"]["list"]["items"][number];
  selection?: { selected: boolean; toggle: () => void };
}) {
  const time = recipeTimeSummary(recipe);

  return (
    <article className="recipe-card" data-selected={selection?.selected}>
      {selection && (
        <button
          type="button"
          className="recipe-card-select"
          aria-label={`Select ${recipe.title}`}
          aria-pressed={selection.selected}
          onClick={selection.toggle}
        />
      )}
      <div className="recipe-card-top">
        {selection ? (
          <>
            <BookOpen size={26} />
            <span className="recipe-selection-mark" aria-hidden="true">
              {selection.selected && <Check size={20} />}
            </span>
          </>
        ) : (
          <>
            <BookOpen size={26} />
            <FavouriteButton
              id={recipe.id}
              title={recipe.title}
              isFavourite={recipe.isFavourite}
            />
          </>
        )}
      </div>

      <h2>
        {selection ? (
          recipe.title
        ) : (
          <Link
            to="/recipes/$recipeId"
            params={{ recipeId: recipe.id }}
            state={{ fromRecipeCollection: true }}
            className="recipe-card-link"
          >
            {recipe.title}
          </Link>
        )}
      </h2>
      <p>
        {recipe.description ||
          `${recipe.ingredientCount} ${recipe.ingredientCount === 1 ? "ingredient" : "ingredients"}`}
      </p>

      <div className="recipe-card-bottom">
        <span>
          <Clock size={15} />
          {time}
        </span>
        {!selection && (
          <RatingControl
            id={recipe.id}
            title={recipe.title}
            rating={recipe.rating}
            compact
          />
        )}
      </div>
    </article>
  );
}
