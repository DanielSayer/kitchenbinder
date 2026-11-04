import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  ArrowUpDown,
  CheckCheck,
  Heart,
  LayoutGrid,
  List,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AddToCollectionSheet } from "@/components/collections/add-to-collection-sheet";
import { CollectionSheet } from "@/components/collections/collection-sheet";
import {
  type CollectionSummary,
  useCollections,
  useInvalidateCollections,
} from "@/components/collections/use-collections";
import { useDeleteCollection } from "@/components/collections/use-delete-collection";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import {
  Chip,
  ChipRow,
  LargeTitle,
  Segmented,
  undoToast,
} from "@/components/pantry";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import { BulkTagDialog } from "./bulk-tag-dialog";
import { EmptyCollection } from "./empty-collection";
import { CollectionMeta, LibraryBinder } from "./library-collections";
import { LibrarySelectionBar } from "./library-selection-bar";
import {
  FilterSheet,
  type LibraryFilters,
  type LibrarySort,
  SortSheet,
  sortLabels,
} from "./library-sheets";
import { RecipePagination, recipePageSize, useRecipePage } from "./pagination";
import { RecipeCard, type RecipeView } from "./recipe-card";
import { useLibrarySearch } from "./use-library-search";
import { useLibrarySelection } from "./use-library-selection";
import { useLibraryView } from "./use-library-view";

const collectionRoute = getRouteApi("/_auth/recipes/");
const allTab = "all";
const plural = (count: number) =>
  `${count} ${count === 1 ? "recipe" : "recipes"}`;

const viewOptions = [
  { value: "list", label: "List", icon: <List size={18} aria-hidden="true" /> },
  {
    value: "grid",
    label: "Grid",
    icon: <LayoutGrid size={18} aria-hidden="true" />,
  },
] as const;

export function Collection() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const invalidateCollections = useInvalidateCollections();
  const filters = collectionRoute.useSearch();
  const navigate = collectionRoute.useNavigate();
  const collections = useCollections();
  const { hidden, deleteCollection } = useDeleteCollection();
  const [view, setView] = useLibraryView();

  const visibleCollections = (collections.data ?? []).filter(
    (item) => !hidden.includes(item.id),
  );
  const requested = filters.collection;
  const current = requested
    ? visibleCollections.find((item) => item.id === requested)
    : undefined;
  const collectionsSettled = collections.isSuccess || collections.isError;
  const collectionId = current?.id;
  // An unknown, deleted or inaccessible collection falls back to All.
  useEffect(() => {
    if (requested && collectionsSettled && !current)
      void navigate({
        search: (old) => ({ ...old, collection: undefined, page: undefined }),
        replace: true,
      });
  }, [requested, collectionsSettled, current, navigate]);

  const search = filters.q ?? "";
  const favouritesOnly = filters.favourites ?? false;
  const unratedOnly = filters.unrated ?? false;
  const selectedTags = filters.tags?.split(",").filter(Boolean) ?? [];
  const defaultSort: LibrarySort = collectionId ? "position" : "newest";
  const sort: LibrarySort =
    filters.sort === "position" && !collectionId
      ? "newest"
      : (filters.sort ?? defaultSort);
  const tags = useQuery(trpc.tags.list.queryOptions());
  const activeTags = selectedTags.filter((id) =>
    tags.data?.some((tag) => tag.id === id),
  );
  const listFilters = {
    collectionId,
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
  const waitingForCollection = !!requested && !collectionsSettled;
  const query = useQuery(
    trpc.recipes.list.queryOptions(
      { ...listFilters, page, pageSize: recipePageSize },
      {
        enabled: tags.isSuccess && !waitingForCollection,
        placeholderData: keepPreviousData,
      },
    ),
  );
  const filterCount =
    activeTags.length +
    Number(favouritesOnly) +
    Number(unratedOnly) +
    Number(!!filters.neverCooked) +
    Number(!!filters.cookedBefore);

  const [sheet, setSheet] = useState<
    "filters" | "sort" | "create" | "manage" | "add" | "tag" | null
  >(null);
  const [managed, setManaged] = useState<CollectionSummary>();
  const {
    selectedIds,
    bulkMode,
    pickTarget,
    startSelection,
    endSelection,
    toggleSelected,
    chooseForCollection,
  } = useLibrarySelection(collectionId ?? allTab);

  const recipes = query.isError ? [] : (query.data?.items ?? []);
  const total = query.data?.total ?? 0;

  const updateFilters = (
    next: LibraryFilters & { q?: string; sort?: LibrarySort },
  ) =>
    void navigate({
      search: (old) => ({ ...old, ...next, page: undefined }),
      replace: true,
      resetScroll: false,
    });

  const { searchText, typeSearch } = useLibrarySearch(search, (text) =>
    updateFilters({ q: text || undefined }),
  );
  const clearFilters = () =>
    updateFilters({
      favourites: undefined,
      unrated: undefined,
      neverCooked: undefined,
      cookedBefore: undefined,
      tags: undefined,
    });
  const selectCollection = (id: string) =>
    void navigate({
      search: (old) => ({
        ...old,
        collection: id === allTab ? undefined : id,
        sort: old.sort === "position" ? undefined : old.sort,
        page: undefined,
      }),
      resetScroll: false,
    });
  const openManage = (collection: CollectionSummary) => {
    setManaged(collection);
    setSheet("manage");
  };
  const toggleTag = (id: string) => {
    const next = selectedTags.includes(id)
      ? selectedTags.filter((tag) => tag !== id)
      : [...selectedTags, id];
    updateFilters({ tags: next.length ? next.join(",") : undefined });
  };

  const removeFromCollection = (collection: CollectionSummary) => {
    const ids = [...selectedIds];
    endSelection();
    void client.collections.removeRecipes
      .mutate({ collectionId: collection.id, recipeIds: ids })
      .then(async ({ removed }) => {
        await invalidateCollections();
        undoToast(`Removed ${plural(removed)} from ${collection.name}`, {
          onUndo: () =>
            void client.collections.addRecipes
              .mutate({ collectionId: collection.id, recipeIds: ids })
              .then(invalidateCollections)
              .catch((error: Error) => toast.error(error.message)),
        });
      })
      .catch((error: Error) => toast.error(error.message));
  };
  const addToTarget = (target: CollectionSummary) => {
    const ids = [...selectedIds];
    void client.collections.addRecipes
      .mutate({ collectionId: target.id, recipeIds: ids })
      .then(async () => {
        await invalidateCollections();
        endSelection();
        selectCollection(target.id);
      })
      .catch((error: Error) => toast.error(error.message));
  };

  const quickTags = (tags.data ?? []).slice(0, 6);

  return (
    <main
      id="main-content"
      className="library-page"
      data-selecting={bulkMode || undefined}
    >
      <LibraryBinder
        collections={visibleCollections}
        collectionId={collectionId}
        onManage={openManage}
        onSelect={selectCollection}
        onCreate={() => setSheet("create")}
      />

      <div id="library-panel" className="library-content page-width">
        <LargeTitle
          sub={<CollectionMeta collection={current} />}
          actions={
            <>
              {current ? (
                <button
                  type="button"
                  className="icon-button library-more"
                  aria-label={`${current.isOwner ? "Manage" : "About"} ${current.name}`}
                  aria-haspopup="dialog"
                  onClick={() => openManage(current)}
                >
                  <MoreHorizontal size={22} aria-hidden="true" />
                </button>
              ) : null}
              <Segmented
                options={viewOptions}
                value={view}
                onChange={(next: RecipeView) => setView(next)}
                label="View"
                iconOnly
              />
            </>
          }
        >
          {current?.name ?? "Recipes"}
        </LargeTitle>

        <div className="library-search">
          <label className="library-field">
            <Search size={20} aria-hidden="true" />
            <span className="pantry-visually-hidden">Search recipes</span>
            <input
              type="search"
              value={searchText}
              onChange={(event) => typeSearch(event.target.value)}
              placeholder="Search names or ingredients"
            />
          </label>
          <button
            type="button"
            className="icon-button library-filter-button"
            aria-label={`Filters${filterCount ? ` (${filterCount} on)` : ""}`}
            aria-haspopup="dialog"
            onClick={() => setSheet("filters")}
          >
            <SlidersHorizontal size={20} aria-hidden="true" />
            {filterCount ? (
              <span className="library-filter-count" aria-hidden="true">
                {filterCount}
              </span>
            ) : null}
          </button>
        </div>

        <ChipRow className="library-chips" aria-label="Quick filters">
          <Chip pressed={filterCount === 0} onClick={clearFilters}>
            All
          </Chip>
          <Chip
            pressed={favouritesOnly}
            onClick={() =>
              updateFilters({ favourites: favouritesOnly ? undefined : true })
            }
          >
            <Heart
              size={14}
              fill={favouritesOnly ? "currentColor" : "none"}
              aria-hidden="true"
            />
            Favourites
          </Chip>
          <Chip
            pressed={unratedOnly}
            onClick={() =>
              updateFilters({ unrated: unratedOnly ? undefined : true })
            }
          >
            Not rated
          </Chip>
          <Chip
            pressed={!!filters.neverCooked}
            onClick={() =>
              updateFilters({
                neverCooked: filters.neverCooked ? undefined : true,
                cookedBefore: undefined,
              })
            }
          >
            Never cooked
          </Chip>
          {quickTags.map((tag) => (
            <Chip
              key={tag.id}
              pressed={activeTags.includes(tag.id)}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </Chip>
          ))}
        </ChipRow>

        <div className="library-count">
          <span aria-live="polite">
            {query.isPending ? "Loading recipes…" : plural(total)}
          </span>
          <span className="library-count-actions">
            {!bulkMode && query.isSuccess && total > 0 ? (
              <button
                type="button"
                className="library-text-button"
                onClick={startSelection}
              >
                <CheckCheck size={14} aria-hidden="true" /> Select
              </button>
            ) : null}
            <button
              type="button"
              className="library-text-button"
              aria-haspopup="dialog"
              onClick={() => setSheet("sort")}
            >
              <ArrowUpDown size={14} aria-hidden="true" />
              <span className="pantry-visually-hidden">Sort: </span>
              {sortLabels[sort]}
            </button>
          </span>
        </div>

        <ErrorNotice
          message={tags.error?.message}
          retry={() => void tags.refetch()}
        />
        <LoadingState
          pending={
            tags.isPending ||
            waitingForCollection ||
            (tags.isSuccess && query.isPending)
          }
        >
          <ErrorNotice
            message={query.error?.message}
            retry={() => void query.refetch()}
          />
          {query.isSuccess && recipes.length === 0 ? (
            <EmptyCollection
              searching={!!search}
              favouritesOnly={favouritesOnly}
              unratedOnly={unratedOnly}
              cookingFiltered={!!filters.neverCooked || !!filters.cookedBefore}
              tagged={activeTags.length > 0}
              collection={current}
              onChooseRecipes={
                current?.isOwner
                  ? () => {
                      chooseForCollection(current);
                      selectCollection(allTab);
                    }
                  : undefined
              }
              onClear={() =>
                updateFilters({
                  q: undefined,
                  favourites: undefined,
                  unrated: undefined,
                  neverCooked: undefined,
                  cookedBefore: undefined,
                  tags: undefined,
                })
              }
            />
          ) : null}
          {recipes.length ? (
            <div
              className={view === "list" ? "library-list" : "library-grid"}
              data-view={view}
            >
              {recipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  view={view}
                  selection={
                    bulkMode
                      ? {
                          selected: selectedIds.includes(recipe.id),
                          toggle: () => toggleSelected(recipe.id),
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          ) : null}
          {query.isSuccess && (
            <RecipePagination page={page} total={total} setPage={goToPage} />
          )}
        </LoadingState>

        {bulkMode && (
          <LibrarySelectionBar
            selectedIds={selectedIds}
            pickTarget={pickTarget}
            current={current}
            hasTags={!!tags.data?.length}
            onCancel={endSelection}
            onAddToTarget={addToTarget}
            onAddToCollection={() => setSheet("add")}
            onRemove={() => current && removeFromCollection(current)}
            onTag={() => setSheet("tag")}
          />
        )}
      </div>

      <FilterSheet
        open={sheet === "filters"}
        onOpenChange={(open) => setSheet(open ? "filters" : null)}
        filters={filters}
        tags={tags.data ?? []}
        selectedTags={activeTags}
        onChange={updateFilters}
        onClear={clearFilters}
        total={query.isSuccess ? total : undefined}
      />
      <SortSheet
        open={sheet === "sort"}
        onOpenChange={(open) => setSheet(open ? "sort" : null)}
        value={sort}
        inCollection={!!collectionId}
        onChange={(next) =>
          updateFilters({ sort: next === defaultSort ? undefined : next })
        }
      />
      <CollectionSheet
        open={sheet === "create"}
        onOpenChange={(open) => setSheet(open ? "create" : null)}
        onCreated={selectCollection}
      />
      <CollectionSheet
        open={sheet === "manage"}
        onOpenChange={(open) => setSheet(open ? "manage" : null)}
        collection={
          managed
            ? (visibleCollections.find((item) => item.id === managed.id) ??
              managed)
            : undefined
        }
        onDelete={(collection) => {
          if (collection.id === collectionId) selectCollection(allTab);
          deleteCollection(collection);
        }}
      />
      <AddToCollectionSheet
        open={sheet === "add"}
        onOpenChange={(open) => setSheet(open ? "add" : null)}
        recipeIds={selectedIds}
        onAdded={endSelection}
      />
      {sheet === "tag" && (
        <BulkTagDialog
          recipeIds={selectedIds}
          tags={tags.data ?? []}
          onClose={() => setSheet(null)}
          onApplied={() => {
            setSheet(null);
            endSelection();
          }}
        />
      )}
    </main>
  );
}
