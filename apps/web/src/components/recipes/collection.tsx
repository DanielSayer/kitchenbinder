import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  CheckCheck,
  CookingPot,
  FilterX,
  Heart,
  History,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Tags as TagsIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { useTRPC } from "@/utils/trpc";
import { CollectionSelect, useCollection } from "../groups/collection-context";
import { AddRecipesButton } from "../shopping/add-recipes";
import { BulkTagDialog } from "./bulk-tag-dialog";
import { EmptyCollection } from "./empty-collection";
import { RecipePagination, recipePageSize, useRecipePage } from "./pagination";
import { RecipeCard } from "./recipe-card";
import type { RecipeSort } from "./recipe-list";
import { SortDropdown } from "./sort-dropdown";
import { TagChoices } from "./tag-choices";

const collectionRoute = getRouteApi("/_auth/recipes/");

export function Collection() {
  const trpc = useTRPC();
  const { groupId, name } = useCollection();
  const filters = collectionRoute.useSearch();
  const navigate = collectionRoute.useNavigate();
  const search = filters.q ?? "";
  const favouritesOnly = filters.favourites ?? false;
  const unratedOnly = filters.unrated ?? false;
  const selectedTags = filters.tags?.split(",").filter(Boolean) ?? [];
  const sort = filters.sort ?? "newest";
  const tags = useQuery(trpc.tags.list.queryOptions());
  const activeTags = selectedTags.filter((id) =>
    tags.data?.some((tag) => tag.id === id),
  );
  const listFilters = {
    groupId,
    search,
    favouritesOnly,
    unratedOnly,
    neverCooked: filters.neverCooked,
    cookedBefore: filters.cookedBefore,
    tagIds: activeTags,
    sort,
  };
  const { page, setPage } = useRecipePage(
    JSON.stringify({ ...listFilters, tagIds: selectedTags }),
    filters.page ?? 0,
  );
  const goToPage = useCallback(
    (next: number) => {
      setPage(next);
      void navigate({
        search: (old) => ({ ...old, page: next || undefined }),
        replace: true,
        resetScroll: true,
      });
    },
    [setPage, navigate],
  );
  const query = useQuery(
    trpc.recipes.list.queryOptions(
      { ...listFilters, page, pageSize: recipePageSize },
      { enabled: tags.isSuccess },
    ),
  );
  const filterCount =
    activeTags.length +
    Number(favouritesOnly) +
    Number(unratedOnly) +
    Number(!!filters.neverCooked) +
    Number(!!filters.cookedBefore);
  const [bulkMode, setBulkMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulkDialog, setBulkDialog] = useState(false);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([]);
  const priorGroup = useRef(groupId);

  useEffect(() => {
    if (priorGroup.current !== groupId) {
      priorGroup.current = groupId;
      void navigate({
        search: (old) => ({ ...old, page: undefined }),
        replace: true,
        resetScroll: false,
      });
    }
    setBulkMode(false);
    setBulkDialog(false);
    setSelectedRecipeIds([]);
  }, [groupId, navigate]);

  const recipes = query.isError ? [] : (query.data?.items ?? []);
  const total = query.data?.total ?? 0;
  const visibleIds = recipes.map((recipe) => recipe.id);
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedRecipeIds.includes(id));

  const updateFilters = (next: {
    q?: string;
    favourites?: boolean;
    unrated?: boolean;
    neverCooked?: boolean;
    cookedBefore?: string;
    tags?: string;
    sort?: RecipeSort;
  }) =>
    void navigate({
      search: (old) => ({ ...old, ...next, page: undefined }),
      replace: true,
      resetScroll: false,
    });

  return (
    <main
      id="main-content"
      className="collection-page page-width"
      data-selecting={bulkMode}
    >
      <div className="page-heading">
        <div>
          <h1>
            <span className="desktop-collection-title">{name}</span>
            <span className="mobile-screen-title">Recipes</span>
            <span className="title-dot">.</span>
          </h1>

          <p>
            {groupId
              ? "Recipes everyone in your group can cook, edit and add to."
              : "Your personal recipes stay private."}
          </p>
        </div>

        <Link
          to="/"
          className="button button-small button-outline collection-add"
        >
          <Plus size={18} /> Add a recipe
        </Link>
      </div>

      <div className="collection-navigation">
        <div className="collection-navigation-select">
          <CollectionSelect />
        </div>
        <Link to="/recipes/imports" className="text-button">
          <History size={17} aria-hidden="true" /> Recent imports
        </Link>
      </div>
      <div className="collection-toolbar">
        <div className="collection-count">
          <span>
            {query.isPending
              ? "Loading recipes..."
              : `${total} ${total === 1 ? "recipe" : "recipes"}`}
          </span>
          {!bulkMode && query.isSuccess && total > 0 && (
            <button
              type="button"
              className="button button-small button-outline"
              onClick={() => setBulkMode(true)}
            >
              <TagsIcon size={17} aria-hidden="true" /> Select recipes
            </button>
          )}
        </div>

        <div className="collection-toolbar-controls">
          <label className="search-box">
            <Search size={18} />
            <span className="sr-only">Search recipes</span>
            <input
              value={search}
              onChange={(event) =>
                updateFilters({ q: event.target.value || undefined })
              }
              placeholder="Search names or ingredients..."
            />
          </label>
          <button
            type="button"
            className="sort-trigger"
            aria-expanded={filtersOpen}
            aria-controls="collection-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} /> Filters
            {filterCount > 0 ? ` (${filterCount})` : ""}
          </button>
          <SortDropdown
            value={sort}
            onValueChange={(value) => updateFilters({ sort: value })}
          />
        </div>
      </div>

      {bulkMode && (
        <section className="bulk-tag-bar" aria-label="Selected recipes">
          <div className="selection-summary">
            <strong aria-live="polite">
              {selectedRecipeIds.length} selected
            </strong>
            <button
              type="button"
              className="text-button"
              disabled={visibleIds.length === 0}
              onClick={() =>
                setSelectedRecipeIds((current) =>
                  allVisibleSelected
                    ? current.filter((id) => !visibleIds.includes(id))
                    : [...new Set([...current, ...visibleIds])],
                )
              }
            >
              <CheckCheck size={17} aria-hidden="true" />
              {allVisibleSelected ? "Deselect page" : "Select page"}
            </button>
            <button
              type="button"
              className="bulk-tag-cancel text-button"
              aria-label="Cancel recipe selection"
              onClick={() => {
                setBulkMode(false);
                setSelectedRecipeIds([]);
              }}
            >
              <X size={17} aria-hidden="true" /> Cancel
            </button>
          </div>
          {selectedRecipeIds.length > 100 && (
            <p role="status">Choose up to 100 recipes.</p>
          )}
          <div className="recipe-selection-actions">
            <AddRecipesButton recipeIds={selectedRecipeIds} compact />
            <button
              type="button"
              className="button button-small button-outline"
              disabled={
                selectedRecipeIds.length === 0 ||
                selectedRecipeIds.length > 100 ||
                !tags.data?.length
              }
              onClick={() => setBulkDialog(true)}
            >
              <TagsIcon size={17} aria-hidden="true" /> Tag recipes
            </button>
          </div>
        </section>
      )}

      <section
        id="collection-filters"
        hidden={!filtersOpen}
        className="collection-tag-filters"
        aria-label="Recipe filters"
      >
        <button
          type="button"
          className="organise-action"
          aria-pressed={favouritesOnly}
          onClick={() =>
            updateFilters({ favourites: favouritesOnly ? undefined : true })
          }
        >
          <Heart size={17} fill={favouritesOnly ? "currentColor" : "none"} />
          Show favourites
        </button>
        <button
          type="button"
          className="organise-action"
          aria-pressed={unratedOnly}
          onClick={() =>
            updateFilters({ unrated: unratedOnly ? undefined : true })
          }
        >
          <Star size={17} />
          Show unrated
        </button>
        <button
          type="button"
          className="organise-action"
          aria-pressed={!!filters.neverCooked}
          onClick={() =>
            updateFilters({
              neverCooked: filters.neverCooked ? undefined : true,
              cookedBefore: undefined,
            })
          }
        >
          <CookingPot size={17} aria-hidden="true" /> Never cooked
        </button>
        <label className="cooking-date-filter">
          Last cooked before
          <input
            type="date"
            value={filters.cookedBefore ?? ""}
            onChange={(event) =>
              updateFilters({
                cookedBefore: event.target.value || undefined,
                neverCooked: undefined,
              })
            }
          />
        </label>
        <TagChoices
          tags={tags.data ?? []}
          selected={activeTags}
          toggle={(id) => {
            const next = selectedTags.includes(id)
              ? selectedTags.filter((tag) => tag !== id)
              : [...selectedTags, id];
            updateFilters({ tags: next.length ? next.join(",") : undefined });
          }}
        />
      </section>
      {filterCount > 0 && (
        <button
          type="button"
          className="collection-clear-filters text-button"
          onClick={() => {
            updateFilters({
              favourites: undefined,
              unrated: undefined,
              neverCooked: undefined,
              cookedBefore: undefined,
              tags: undefined,
            });
          }}
        >
          <FilterX size={17} aria-hidden="true" /> Clear filters
        </button>
      )}
      <ErrorNotice
        message={tags.error?.message}
        retry={() => void tags.refetch()}
      />
      {tags.isPending && <p role="status">Loading tags...</p>}

      <LoadingState
        pending={tags.isPending || (tags.isSuccess && query.isPending)}
      >
        <ErrorNotice
          message={query.error?.message}
          retry={() => void query.refetch()}
        />

        {query.isSuccess && recipes.length === 0 && (
          <EmptyCollection
            searching={!!search}
            favouritesOnly={favouritesOnly}
            unratedOnly={unratedOnly}
            cookingFiltered={!!filters.neverCooked || !!filters.cookedBefore}
            tagged={activeTags.length > 0}
            onClear={() => {
              updateFilters({
                q: undefined,
                favourites: undefined,
                unrated: undefined,
                neverCooked: undefined,
                cookedBefore: undefined,
                tags: undefined,
              });
            }}
          />
        )}

        <div className="recipe-grid">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              selection={
                bulkMode
                  ? {
                      selected: selectedRecipeIds.includes(recipe.id),
                      toggle: () =>
                        setSelectedRecipeIds((current) =>
                          current.includes(recipe.id)
                            ? current.filter((id) => id !== recipe.id)
                            : [...current, recipe.id],
                        ),
                    }
                  : undefined
              }
            />
          ))}
        </div>
        {query.isSuccess && (
          <RecipePagination page={page} total={total} setPage={goToPage} />
        )}
      </LoadingState>
      {bulkDialog && (
        <BulkTagDialog
          recipeIds={selectedRecipeIds}
          tags={tags.data ?? []}
          onClose={() => setBulkDialog(false)}
          onApplied={() => {
            setBulkDialog(false);
            setBulkMode(false);
            setSelectedRecipeIds([]);
          }}
        />
      )}
    </main>
  );
}
