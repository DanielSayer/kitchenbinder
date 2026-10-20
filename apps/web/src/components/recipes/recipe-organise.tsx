import { DropdownMenuItem } from "@prep-sheet/ui/components/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, Plus, Star } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice } from "../feedback";
import { CopyRecipe } from "../groups/copy-recipe";
import { FavouriteButton } from "./favourite-button";
import { OrganiseDialog } from "./organise-dialog";
import { RatingControl } from "./rating-control";
import { RecipeHeading } from "./recipe-heading";
import { RecipeReadingTools } from "./recipe-reading-tools";
import { TagChoices } from "./tag-choices";
export function RecipeOrganise({
  recipe,
  onEdit,
  onDelete,
}: {
  recipe: ComponentProps<typeof RecipeHeading>["recipe"] & {
    groupId: string | null;
    isFavourite: boolean;
    rating: number | null;
    tagIds: string[];
  };
  onEdit: () => void;
  onDelete: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const tags = useQuery(
    trpc.tags.list.queryOptions({ groupId: recipe.groupId }),
  );
  const [dialog, setDialog] = useState<"tags" | "copy" | "rating" | null>(null);
  const update = useMutation(
    trpc.recipes.setTag.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: trpc.recipes.pathKey() });
      },
    }),
  );
  const toggle = (tagId: string) =>
    update.mutate({
      id: recipe.id,
      tagId,
      selected: !recipe.tagIds.includes(tagId),
    });
  const chosen =
    tags.data?.filter((tag) => recipe.tagIds.includes(tag.id)) ?? [];
  return (
    <>
      <RecipeHeading
        recipe={recipe}
        editing={false}
        onEdit={onEdit}
        onDelete={onDelete}
        shoppingExtras={
          <div className="recipe-desktop-actions recipe-personal-actions">
            <RatingControl
              id={recipe.id}
              title={recipe.title}
              rating={recipe.rating}
            />
            <FavouriteButton {...recipe} showLabel />
          </div>
        }
        menuItems={
          <>
            <DropdownMenuItem
              className="collection-select-manage recipe-mobile-action"
              onClick={() => setDialog("rating")}
            >
              <Star size={17} /> Rate recipe
            </DropdownMenuItem>
            <FavouriteButton {...recipe} showLabel menuItem />
            <DropdownMenuItem
              className="collection-select-manage recipe-mobile-action"
              onClick={() => setDialog("tags")}
            >
              <Plus size={17} /> Tags
            </DropdownMenuItem>
            <DropdownMenuItem
              className="collection-select-manage recipe-mobile-action"
              onClick={() => setDialog("copy")}
            >
              <Copy size={17} /> Copy to collection
            </DropdownMenuItem>
            <DropdownMenuItem
              className="collection-select-manage recipe-mobile-action"
              render={
                <a
                  href={`/api/recipes/${recipe.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              <ExternalLink size={17} /> Open PDF
            </DropdownMenuItem>
          </>
        }
      />
      <RecipeReadingTools>
        <div className="recipe-desktop-actions">
          <button
            type="button"
            className="organise-action"
            aria-haspopup="dialog"
            onClick={() => setDialog("tags")}
          >
            <Plus size={17} />
            Tags
          </button>
          <button
            type="button"
            className="organise-action"
            aria-haspopup="dialog"
            onClick={() => setDialog("copy")}
          >
            <Copy size={16} />
            Copy
          </button>
          <a
            href={`/api/recipes/${recipe.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="organise-action"
          >
            <ExternalLink size={16} /> Open PDF
          </a>
        </div>
      </RecipeReadingTools>
      {chosen.length > 0 && (
        <div className="recipe-selected-tags recipe-desktop-actions">
          <TagChoices
            tags={chosen}
            selected={recipe.tagIds}
            toggle={toggle}
            disabled={update.isPending}
          />
        </div>
      )}
      {!dialog && (
        <ErrorNotice message={update.error?.message || tags.error?.message} />
      )}
      {dialog === "tags" && (
        <OrganiseDialog
          title="Choose your tags"
          onClose={() => setDialog(null)}
        >
          <p>
            Select tags to add or remove. Tags are shared with this collection.
          </p>
          <ErrorNotice
            message={tags.error?.message}
            retry={() => void tags.refetch()}
          />
          {tags.isPending && <p role="status">Loading tags...</p>}
          <TagChoices
            tags={tags.data ?? []}
            selected={recipe.tagIds}
            toggle={toggle}
            disabled={update.isPending}
          />
          <ErrorNotice message={update.error?.message} />
          <div className="organise-dialog-footer">
            <Link to="/settings" className="text-button">
              Manage tags
            </Link>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setDialog(null)}
            >
              Done
            </button>
          </div>
        </OrganiseDialog>
      )}
      {dialog === "rating" && (
        <OrganiseDialog title="Rate recipe" onClose={() => setDialog(null)}>
          <RatingControl
            id={recipe.id}
            title={recipe.title}
            rating={recipe.rating}
          />
        </OrganiseDialog>
      )}
      {dialog === "copy" && (
        <OrganiseDialog
          title="Copy to a collection"
          onClose={() => setDialog(null)}
        >
          <CopyRecipe id={recipe.id} sourceGroupId={recipe.groupId} />
        </OrganiseDialog>
      )}
    </>
  );
}
