import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { useDebouncedValue } from "../use-debounced-value";
import { OrganiseDialog } from "./organise-dialog";
import { RecipePagination, recipePageSize, useRecipePage } from "./pagination";
import { TagChoices } from "./tag-choices";

type TagOption = ComponentProps<typeof TagChoices>["tags"][number];

export function BulkTagDialog({
  recipeIds,
  tags,
  onClose,
  onApplied,
}: {
  recipeIds: string[];
  tags: TagOption[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const [tagIds, setTagIds] = useState<string[]>([]);
  const update = useMutation(
    trpc.recipes.setTags.mutationOptions({
      onSuccess: async ({ recipeCount, tagCount }, { operation }) => {
        await client.invalidateQueries({ queryKey: trpc.recipes.pathKey() });
        toast.success(
          `${operation === "add" ? "Added" : "Removed"} ${tagCount === 1 ? "tag" : "tags"} ${operation === "add" ? "to" : "from"} ${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}.`,
        );
        onApplied();
      },
    }),
  );
  const toggle = (id: string) =>
    setTagIds((current) =>
      current.includes(id)
        ? current.filter((tagId) => tagId !== id)
        : [...current, id],
    );
  const pendingOperation = update.isPending
    ? update.variables?.operation
    : null;

  return (
    <OrganiseDialog title="Tag selected recipes" onClose={onClose}>
      <p>
        Choose tags, then add or remove them from {recipeIds.length}{" "}
        {recipeIds.length === 1 ? "recipe" : "recipes"}.
      </p>
      <TagChoices
        tags={tags}
        selected={tagIds}
        toggle={toggle}
        disabled={update.isPending}
      />
      {tags.length === 0 && <p className="muted">No tags available.</p>}
      <ErrorNotice message={update.error?.message} />
      <div className="organise-dialog-footer bulk-tag-actions">
        <button
          type="button"
          className="button button-outline"
          disabled={update.isPending || tagIds.length === 0}
          onClick={() =>
            update.mutate({ recipeIds, tagIds, operation: "remove" })
          }
        >
          {pendingOperation === "remove" ? "Removing..." : "Remove tags"}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={update.isPending || tagIds.length === 0}
          onClick={() => update.mutate({ recipeIds, tagIds, operation: "add" })}
        >
          {pendingOperation === "add" ? "Adding..." : "Add tags"}
        </button>
      </div>
    </OrganiseDialog>
  );
}

export function ApplyTagDialog({
  tag,
  onClose,
  onApplied,
}: {
  tag: TagOption;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query);
  const { page, setPage } = useRecipePage(JSON.stringify([search, tag.id]));
  const recipes = useQuery(
    trpc.recipes.taggingList.queryOptions(
      {
        search,
        excludeTagId: tag.id,
        page,
        pageSize: recipePageSize,
      },
      { placeholderData: keepPreviousData },
    ),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const shown = recipes.isError ? [] : (recipes.data?.items ?? []);
  const update = useMutation(
    trpc.recipes.setTags.mutationOptions({
      onSuccess: async ({ recipeCount }) => {
        await client.invalidateQueries({ queryKey: trpc.recipes.pathKey() });
        toast.success(
          `${tag.name} added to ${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}.`,
        );
        onApplied?.();
        onClose();
      },
    }),
  );

  return (
    <OrganiseDialog title={`Add ${tag.name} to recipes`} onClose={onClose}>
      <p>Choose up to 100 recipes. Recipes with this tag are hidden.</p>
      <label className="search-box bulk-recipe-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search recipes</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search recipes..."
        />
      </label>
      <LoadingState pending={recipes.isPending} label="Loading recipes...">
        <ErrorNotice
          message={recipes.error?.message}
          retry={() => void recipes.refetch()}
        />
        {recipes.isSuccess && shown.length > 0 && (
          <>
            <div className="bulk-recipe-controls">
              <span>
                {selected.length} {selected.length === 1 ? "recipe" : "recipes"}{" "}
                selected
              </span>
              {selected.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  disabled={update.isPending}
                  onClick={() => setSelected([])}
                >
                  Clear selection
                </button>
              )}
            </div>
            <ul className="bulk-recipe-list">
              {shown.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    className="bulk-recipe-choice"
                    disabled={update.isPending}
                    aria-pressed={selected.includes(recipe.id)}
                    onClick={() =>
                      setSelected((current) =>
                        current.includes(recipe.id)
                          ? current.filter((id) => id !== recipe.id)
                          : [...current, recipe.id],
                      )
                    }
                  >
                    <span>
                      <strong>{recipe.title}</strong>
                    </span>
                    <span className="recipe-selection-mark" aria-hidden="true">
                      {selected.includes(recipe.id) && <Check size={18} />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {shown.length === 0 && (
              <p className="muted">No recipes match that search.</p>
            )}
          </>
        )}
        {recipes.isSuccess && shown.length === 0 && (
          <p className="muted">
            {search
              ? "No recipes match that search."
              : "No recipes without this tag."}
          </p>
        )}
        {recipes.isSuccess && (
          <RecipePagination
            page={page}
            total={recipes.data.total}
            setPage={setPage}
            disabled={update.isPending}
          />
        )}
      </LoadingState>
      <ErrorNotice message={update.error?.message} />
      {selected.length > 100 && (
        <p role="alert">Choose no more than 100 recipes at a time.</p>
      )}
      <div className="organise-dialog-footer">
        <button type="button" className="text-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={
            update.isPending || selected.length === 0 || selected.length > 100
          }
          onClick={() =>
            update.mutate({
              recipeIds: selected,
              tagIds: [tag.id],
              operation: "add",
            })
          }
        >
          {update.isPending ? "Adding..." : "Add to recipes"}
        </button>
      </div>
    </OrganiseDialog>
  );
}
