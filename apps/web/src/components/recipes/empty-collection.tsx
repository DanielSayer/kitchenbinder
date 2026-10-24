import { Link } from "@tanstack/react-router";
import { FilterX } from "lucide-react";
import { EmptyState } from "@/components/pantry";

function filteredCopy({
  searching,
  favouritesOnly,
  unratedOnly,
  tagged,
  cookingFiltered,
}: {
  searching: boolean;
  favouritesOnly: boolean;
  unratedOnly: boolean;
  tagged: boolean;
  cookingFiltered: boolean;
}) {
  if (cookingFiltered)
    return [
      "No recipes match your cooking filters",
      "Try another date or clear your filters.",
    ];
  if (tagged)
    return [
      "No recipes match these tags",
      "Try fewer tags or clear your filters.",
    ];
  if (searching)
    return [
      "No recipes match that search",
      "Try another name or ingredient, or clear your filters.",
    ];
  if (favouritesOnly)
    return ["No favourites yet", "Tap the heart on a recipe to find it here."];
  if (unratedOnly)
    return [
      "Everything here is rated",
      "Clear the filter to see your rated recipes.",
    ];
  return null;
}

/** Empty library, empty collection, or nothing matching the filters. */
export function EmptyCollection({
  searching,
  favouritesOnly,
  unratedOnly = false,
  tagged = false,
  cookingFiltered = false,
  onClear,
  collection,
  onChooseRecipes,
}: {
  searching: boolean;
  favouritesOnly: boolean;
  unratedOnly?: boolean;
  tagged?: boolean;
  cookingFiltered?: boolean;
  onClear: () => void;
  /** Selected collection, when not on All. */
  collection?: { name: string; isOwner: boolean; owner: { name: string } };
  /** Owner only: pick recipes from All to add here. */
  onChooseRecipes?: () => void;
}) {
  const filtered = filteredCopy({
    searching,
    favouritesOnly,
    unratedOnly,
    tagged,
    cookingFiltered,
  });
  if (filtered)
    return (
      <EmptyState
        title={filtered[0]}
        description={filtered[1]}
        covers={["Search", "Again"]}
      >
        <button
          type="button"
          className="button button-outline button-block"
          onClick={onClear}
        >
          <FilterX size={18} aria-hidden="true" /> Clear filters
        </button>
      </EmptyState>
    );
  if (collection)
    return (
      <EmptyState
        title={`Nothing in ${collection.name} yet`}
        description={
          collection.isOwner
            ? "Pick recipes you already have, or add one from any recipe's ••• menu."
            : `${collection.owner.name} hasn't added any recipes you can see yet.`
        }
        covers={["Soup", "Pie"]}
      >
        {collection.isOwner && onChooseRecipes ? (
          <>
            <button
              type="button"
              className="button button-primary button-block"
              onClick={onChooseRecipes}
            >
              Choose recipes
            </button>
            <Link to="/" className="button button-ghost button-block">
              Add a new recipe
            </Link>
          </>
        ) : null}
      </EmptyState>
    );
  return (
    <EmptyState
      title="An empty binder"
      description="Paste a link or a recipe, or describe a dish, and we'll tidy it into your binder."
    >
      <Link to="/" className="button button-primary button-block">
        Add a recipe
      </Link>
      <Link to="/recipes/deleted" className="button button-ghost button-block">
        Recently deleted
      </Link>
    </EmptyState>
  );
}
