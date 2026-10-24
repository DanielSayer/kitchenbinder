import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Search, ShoppingBasket } from "lucide-react";
import { useDeferredValue, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useHousehold,
  useHouseholdScope,
} from "@/components/households/household-context";
import { Chip, ChipRow, RecipeCover, Sheet } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import {
  RecipePagination,
  recipePageSize,
  useRecipePage,
} from "../recipes/pagination";
import { formatServings } from "../recipes/scale-ingredients";

export function AddRecipesButton({
  recipeIds,
  onAdded,
  compact = false,
}: {
  recipeIds: string[];
  onAdded?: () => void;
  compact?: boolean;
}) {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const list = useQuery(trpc.shopping.list.queryOptions({ householdId }));
  const existing = new Set(list.data?.map((item) => item.recipeId));
  const remaining = recipeIds.filter((id) => !existing.has(id));
  const add = useMutation(
    trpc.shopping.addRecipes.mutationOptions({
      onSuccess: async ({ addedRecipes }) => {
        await client.invalidateQueries({
          queryKey: trpc.shopping.pathKey(),
        });
        toast.success(
          addedRecipes
            ? `Added ingredients from ${addedRecipes} ${addedRecipes === 1 ? "recipe" : "recipes"}.`
            : "These recipes are already on your list.",
        );
        onAdded?.();
      },
    }),
  );
  return (
    <div className="shopping-add-action">
      <button
        type="button"
        className="button button-small button-outline"
        disabled={
          list.isPending ||
          list.isError ||
          add.isPending ||
          remaining.length === 0 ||
          remaining.length > 100
        }
        onClick={() => add.mutate({ householdId, recipeIds: remaining })}
      >
        <ShoppingBasket size={17} />
        {add.isPending
          ? "Adding..."
          : recipeIds.length > 0 && !remaining.length
            ? "On your list"
            : compact
              ? "Add to list"
              : "Add to shopping list"}
      </button>
      {recipeIds.length > 0 && !remaining.length && list.isSuccess && (
        <Link className="text-button" to="/shopping">
          View list
        </Link>
      )}
      <ErrorNotice
        message={list.error?.message}
        retry={() => void list.refetch()}
      />
      <ErrorNotice
        message={add.error?.message}
        retry={() => add.variables && add.mutate(add.variables)}
      />
    </div>
  );
}

/** Add-from-recipes sheet: tick any accessible recipes, add their ingredients. */
export function RecipePicker({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const householdId = useHousehold().householdId ?? undefined;
  const collections = useQuery(trpc.collections.list.queryOptions());
  const list = useQuery(trpc.shopping.list.queryOptions({ householdId }));
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const searchInput = useRef<HTMLInputElement>(null);
  const [collection, setCollection] = useState("all");
  const { page, setPage } = useRecipePage(JSON.stringify([search, collection]));
  const recipes = useQuery(
    trpc.shopping.recipes.queryOptions({
      search,
      collectionId: collection === "all" ? undefined : collection,
      page,
      pageSize: recipePageSize,
    }),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const existing = new Set(list.data?.map((item) => item.recipeId));
  const validSelection = selected.filter((id) => !existing.has(id));
  const shown = recipes.isError ? [] : (recipes.data?.items ?? []);
  const add = useMutation(
    trpc.shopping.addRecipes.mutationOptions({
      onSuccess: async ({ addedRecipes }) => {
        await client.invalidateQueries({
          queryKey: trpc.shopping.pathKey(),
        });
        toast.success(
          `Added ingredients from ${addedRecipes} ${addedRecipes === 1 ? "recipe" : "recipes"}`,
        );
        setSelected([]);
        onClose();
      },
    }),
  );
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !add.isPending) onClose();
      }}
      title="Add from recipes"
      initialFocus={searchInput}
      className="shop-picker"
      footer={
        <>
          <div className="shop-picker-status">
            <span role="status">
              {validSelection.length} selected
              {validSelection.length > 100 ? ". Choose up to 100." : ""}
            </span>
            {selected.length > 0 && (
              <button
                type="button"
                className="text-button"
                disabled={add.isPending}
                onClick={() => setSelected([])}
              >
                Clear selection
              </button>
            )}
          </div>
          <button
            type="button"
            className="button button-primary button-block"
            disabled={
              add.isPending ||
              recipes.isError ||
              list.isError ||
              !validSelection.length ||
              validSelection.length > 100
            }
            onClick={() =>
              add.mutate({ householdId, recipeIds: validSelection })
            }
          >
            {add.isPending ? "Adding..." : "Add ingredients"}
          </button>
        </>
      }
    >
      <label className="pick-search">
        <Search size={20} aria-hidden="true" />
        <input
          ref={searchInput}
          value={query}
          aria-label="Search recipes"
          placeholder="Search recipes"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {!!collections.data?.length && (
        <ChipRow className="pick-chips" role="group" aria-label="Collection">
          <Chip
            pressed={collection === "all"}
            onClick={() => setCollection("all")}
          >
            All recipes
          </Chip>
          {collections.data.map((item) => (
            <Chip
              key={item.id}
              pressed={collection === item.id}
              onClick={() => setCollection(item.id)}
            >
              {item.name}
            </Chip>
          ))}
        </ChipRow>
      )}
      <LoadingState pending={recipes.isPending || list.isPending}>
        <ErrorNotice
          message={
            recipes.error?.message ||
            list.error?.message ||
            collections.error?.message
          }
          retry={() => {
            void recipes.refetch();
            void list.refetch();
            void collections.refetch();
          }}
        />
        {recipes.isSuccess && list.isSuccess && (
          <div className="pick-list">
            {shown.map((recipe) => {
              const onList = existing.has(recipe.id);
              return (
                <label key={recipe.id} className="pick-row" data-check>
                  <input
                    type="checkbox"
                    className="pick-input"
                    disabled={add.isPending || onList}
                    checked={onList || validSelection.includes(recipe.id)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(recipe.id)
                          ? current.filter((id) => id !== recipe.id)
                          : [...current, recipe.id],
                      )
                    }
                  />
                  <RecipeCover
                    id={recipe.id}
                    title={recipe.title}
                    size="thumb"
                  />
                  <span className="pick-text">
                    <b className="pick-title">{recipe.title}</b>{" "}
                    {onList ? (
                      <small>On your list</small>
                    ) : recipe.servings ? (
                      <small>{formatServings(recipe.servings)}</small>
                    ) : null}
                  </span>
                  <span className="pick-mark" aria-hidden="true">
                    <Check size={14} />
                  </span>
                </label>
              );
            })}
            {!shown.length && (
              <p className="pick-empty">
                No recipes found. Try another collection or search.
              </p>
            )}
          </div>
        )}
        {recipes.isSuccess && (
          <RecipePagination
            page={page}
            total={recipes.data.total}
            setPage={setPage}
            disabled={add.isPending}
          />
        )}
      </LoadingState>
      <ErrorNotice
        message={add.error?.message}
        retry={() => {
          void recipes.refetch();
          void list.refetch();
        }}
      />
    </Sheet>
  );
}
