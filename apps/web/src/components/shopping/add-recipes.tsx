import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShoppingBasket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { useCollection } from "../groups/collection-context";
import { CollectionDropdown } from "../groups/collection-dropdown";
import { OrganiseDialog } from "../recipes/organise-dialog";
import {
  RecipePagination,
  recipePageSize,
  useRecipePage,
} from "../recipes/pagination";

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
  const client = useQueryClient();
  const list = useQuery(trpc.shopping.list.queryOptions());
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
        onClick={() => add.mutate({ recipeIds: remaining })}
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

export function RecipePicker({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const { groups } = useCollection();
  const list = useQuery(trpc.shopping.list.queryOptions());
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("all");
  const { page, setPage } = useRecipePage(JSON.stringify([search, collection]));
  const recipes = useQuery(
    trpc.shopping.recipes.queryOptions({
      search,
      collection,
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
      onSuccess: async () => {
        await client.invalidateQueries({
          queryKey: trpc.shopping.pathKey(),
        });
        onClose();
      },
    }),
  );
  return (
    <OrganiseDialog
      title="Add recipes"
      className="shopping-picker"
      onClose={() => {
        if (!add.isPending) onClose();
      }}
    >
      <div className="shopping-picker-filters">
        <label className="shopping-field">
          Search recipes
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Recipe name"
          />
        </label>
        <CollectionDropdown
          label="Collection"
          value={collection}
          onValueChange={setCollection}
          options={[
            { label: "All collections", value: "all" },
            { label: "Personal collection", value: "personal" },
            ...(groups.data?.map((group) => ({
              label: group.name,
              value: group.id,
            })) ?? []),
          ]}
        />
      </div>
      <div className="shopping-picker-results">
        <LoadingState pending={recipes.isPending || list.isPending}>
          <ErrorNotice
            message={
              recipes.error?.message ||
              list.error?.message ||
              groups.error?.message
            }
            retry={() => {
              void recipes.refetch();
              void list.refetch();
              void groups.refetch();
            }}
          />
          {recipes.isSuccess && list.isSuccess && (
            <div className="shopping-recipe-choices">
              {shown.map((recipe) => (
                <label key={recipe.id} className="shopping-recipe-choice">
                  <input
                    type="checkbox"
                    disabled={add.isPending || existing.has(recipe.id)}
                    checked={
                      existing.has(recipe.id) ||
                      validSelection.includes(recipe.id)
                    }
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(recipe.id)
                          ? current.filter((id) => id !== recipe.id)
                          : [...current, recipe.id],
                      )
                    }
                  />
                  <span>
                    <strong>{recipe.title}</strong>
                    <small>
                      {recipe.groupId
                        ? (groups.data?.find(
                            (group) => group.id === recipe.groupId,
                          )?.name ?? "Shared collection")
                        : "Personal collection"}
                    </small>
                    <small>
                      {existing.has(recipe.id)
                        ? "On your list"
                        : recipe.servings
                          ? `Original yield: ${recipe.servings}`
                          : "Original quantities"}
                    </small>
                  </span>
                </label>
              ))}
              {!shown.length && (
                <p className="muted">
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
      </div>
      <div className="organise-dialog-footer shopping-picker-footer">
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
        <button
          type="button"
          className="button button-primary"
          disabled={
            add.isPending ||
            recipes.isError ||
            list.isError ||
            !validSelection.length ||
            validSelection.length > 100
          }
          onClick={() => add.mutate({ recipeIds: validSelection })}
        >
          {add.isPending ? "Adding..." : "Add ingredients"}
        </button>
      </div>
    </OrganiseDialog>
  );
}
