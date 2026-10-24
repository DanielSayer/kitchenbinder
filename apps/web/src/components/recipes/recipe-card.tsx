import type { AppRouter } from "@prep-sheet/api/routers/index";
import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, Star } from "lucide-react";
import { RecipeCover, toneForTags } from "@/components/pantry";
import { FavouriteButton } from "./favourite-button";
import { shortRecipeTime } from "./recipe-time";

export type RecipeListItem =
  inferRouterOutputs<AppRouter>["recipes"]["list"]["items"][number];
export type RecipeView = "list" | "grid";

function Rating({ rating }: { rating: number | null }) {
  if (!rating) return <span className="recipe-unrated">Not rated</span>;
  return (
    <span className="recipe-stars">
      <Star
        size={12}
        fill="currentColor"
        className="star-icon"
        aria-hidden="true"
      />
      <span className="pantry-visually-hidden">Rated</span>
      {rating}
      <span className="pantry-visually-hidden"> out of 5</span>
    </span>
  );
}

export function OwnerBadge({ name }: { name: string | null }) {
  return (
    <span
      className="owner-badge"
      title={`Shared by ${name ?? "a former member"}`}
    >
      {name ? `by ${name.split(" ")[0]}` : "Shared"}
    </span>
  );
}

/** One recipe in the library: a list row or a grid card, with its cover. */
export function RecipeCard({
  recipe,
  view = "grid",
  selection,
}: {
  recipe: RecipeListItem;
  view?: RecipeView;
  selection?: { selected: boolean; toggle: () => void };
}) {
  const time = shortRecipeTime(recipe);
  const firstTag = recipe.tags[0]?.name;
  const tone = toneForTags(recipe.tags.map((tag) => tag.name));
  const meta = (
    <span className="recipe-tile-meta">
      {view === "list" && firstTag ? <span>{firstTag}</span> : null}
      {time ? <span>{time}</span> : null}
      <Rating rating={recipe.rating} />
      {!recipe.isOwner ? <OwnerBadge name={recipe.ownerName} /> : null}
    </span>
  );
  const title = selection ? (
    <span className="recipe-tile-title">{recipe.title}</span>
  ) : (
    <Link
      to="/recipes/$recipeId"
      params={{ recipeId: recipe.id }}
      state={{ fromRecipeCollection: true }}
      className="recipe-tile-title recipe-tile-link"
    >
      {recipe.title}
    </Link>
  );

  return (
    <article
      className="recipe-tile"
      data-view={view}
      data-selected={selection?.selected}
    >
      <RecipeCover
        id={recipe.id}
        title={recipe.title}
        photo={recipe.photo}
        tone={tone}
        size={view === "list" ? "list" : "grid"}
      />
      <div className="recipe-tile-body">
        {view === "list" ? <b>{title}</b> : <h2>{title}</h2>}
        {meta}
      </div>
      {selection ? (
        <>
          <button
            type="button"
            className="recipe-tile-select"
            aria-label={`Select ${recipe.title}`}
            aria-pressed={selection.selected}
            onClick={selection.toggle}
          />
          <span className="recipe-tile-mark" aria-hidden="true">
            {selection.selected ? <Check size={16} /> : null}
          </span>
        </>
      ) : (
        <FavouriteButton
          id={recipe.id}
          title={recipe.title}
          isFavourite={recipe.isFavourite}
        />
      )}
    </article>
  );
}
