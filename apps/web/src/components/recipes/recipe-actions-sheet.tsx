import type { AppRouter } from "@prep-sheet/api/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  CalendarDays,
  ChevronRight,
  Copy,
  FileText,
  FolderPlus,
  Pencil,
  Tags as TagsIcon,
  Trash2,
  Users,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { HouseholdShareList } from "@/components/collections/household-share-list";
import {
  householdTone,
  useShareableHouseholds,
} from "@/components/collections/use-collections";
import { ErrorNotice } from "@/components/feedback";
import { Sheet, toneColor } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { RatingControl } from "./rating-control";
import { TagChoices } from "./tag-choices";

type Recipe = inferRouterOutputs<AppRouter>["recipes"]["get"];
type View = "main" | "share" | "tags" | "copy";

function ActionRow({
  icon,
  label,
  hint,
  onClick,
  danger,
  go,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
  danger?: boolean;
  go?: boolean;
}) {
  return (
    <button
      type="button"
      className={["pantry-row", danger && "sheet-danger-row"]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
    >
      <span className="pantry-row-icon">{icon}</span>
      <span className="pantry-row-text">
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
      {go ? (
        <ChevronRight size={18} className="pantry-row-go" aria-hidden="true" />
      ) : null}
    </button>
  );
}

const pdfName = (title: string) =>
  `${title.replace(/[^a-z0-9 -]/gi, "").slice(0, 80) || "recipe"}.pdf`;

/** The recipe's ••• sheet. Owner-only actions are hidden for others. */
export function RecipeActionsSheet({
  open,
  onOpenChange,
  recipe,
  onEdit,
  onDelete,
  onAddToCollection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: Recipe;
  onEdit: () => void;
  onDelete: () => void;
  onAddToCollection: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("main");
  const owner = recipe.isOwner;
  const households = useShareableHouseholds();
  const tags = useQuery(
    trpc.tags.list.queryOptions(undefined, { enabled: owner && open }),
  );
  const refresh = () =>
    client.invalidateQueries({ queryKey: trpc.recipes.pathKey() });

  const setTag = useMutation(
    trpc.recipes.setTag.mutationOptions({ onSettled: refresh }),
  );
  const share = useMutation(
    trpc.recipes.share.mutationOptions({ onSettled: refresh }),
  );
  const unshare = useMutation(
    trpc.recipes.unshare.mutationOptions({ onSettled: refresh }),
  );
  const copy = useMutation(
    trpc.recipes.copy.mutationOptions({
      onSuccess: async (saved) => {
        await Promise.all([
          refresh(),
          client.invalidateQueries({ queryKey: trpc.tags.list.queryKey() }),
        ]);
        close();
        toast.success("Copied. Your copy can be edited separately.");
        await navigate({
          to: "/recipes/$recipeId",
          params: { recipeId: saved.id },
        });
      },
    }),
  );

  const close = () => onOpenChange(false);
  const sharedIds = recipe.sharedWith
    .filter((item) => !item.personal)
    .map((item) => item.id)
    .filter(
      (id) => !(unshare.isPending && unshare.variables.householdId === id),
    )
    .concat(
      share.isPending &&
        !recipe.sharedWith.some(
          (item) => item.id === share.variables.householdId,
        )
        ? [share.variables.householdId]
        : [],
    );
  const tagIds = setTag.isPending
    ? setTag.variables.selected
      ? [...recipe.tagIds, setTag.variables.tagId]
      : recipe.tagIds.filter((id) => id !== setTag.variables.tagId)
    : recipe.tagIds;

  const titles: Record<View, string> = {
    main: "Recipe actions",
    share: "Share with households",
    tags: "Tags",
    copy: "Make a copy",
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) window.setTimeout(() => setView("main"), 300);
      }}
      title={titles[view]}
      hideTitle={view === "main"}
      description={
        view === "share"
          ? "Members can cook, plan and shop with it. Only you can edit it."
          : view === "copy"
            ? "Save your own editable copy of this recipe."
            : undefined
      }
      footer={
        view === "main" ? undefined : (
          <button
            type="button"
            className="button button-ghost button-block"
            onClick={() => setView("main")}
          >
            Back
          </button>
        )
      }
    >
      {view === "main" ? (
        <>
          <div className="sheet-rating">
            <span>
              <b>Your rating</b>
              <small>Only you see this</small>
            </span>
            <RatingControl
              id={recipe.id}
              title={recipe.title}
              rating={recipe.rating}
              compact
            />
          </div>
          <div className="pantry-list">
            <Link
              className="pantry-row"
              to="/planner"
              search={{ recipeId: recipe.id }}
            >
              <span className="pantry-row-icon">
                <CalendarDays size={20} aria-hidden="true" />
              </span>
              <span className="pantry-row-text">
                <b>Add to plan</b>
              </span>
            </Link>
            <ActionRow
              icon={<FolderPlus size={20} aria-hidden="true" />}
              label="Add to collection"
              onClick={() => {
                close();
                onAddToCollection();
              }}
            />
            {owner ? (
              <ActionRow
                icon={<Users size={20} aria-hidden="true" />}
                label="Share with households"
                hint={
                  sharedIds.length
                    ? `Shared with ${recipe.sharedWith
                        .filter((item) => !item.personal)
                        .map((item) => item.name)
                        .join(", ")}`
                    : "Just you"
                }
                go
                onClick={() => setView("share")}
              />
            ) : null}
            {owner ? (
              <ActionRow
                icon={<TagsIcon size={20} aria-hidden="true" />}
                label="Tags"
                hint={
                  recipe.tags.length
                    ? recipe.tags.map((tag) => tag.name).join(", ")
                    : undefined
                }
                go
                onClick={() => setView("tags")}
              />
            ) : null}
            <ActionRow
              icon={<Copy size={20} aria-hidden="true" />}
              label={owner ? "Duplicate" : "Copy to my recipes"}
              go
              onClick={() => setView("copy")}
            />
            <a
              className="pantry-row"
              href={`/api/recipes/${recipe.id}/pdf`}
              download={pdfName(recipe.title)}
            >
              <span className="pantry-row-icon">
                <FileText size={20} aria-hidden="true" />
              </span>
              <span className="pantry-row-text">
                <b>Printable PDF</b>
              </span>
            </a>
            {owner ? (
              <ActionRow
                icon={<Pencil size={20} aria-hidden="true" />}
                label="Edit recipe"
                onClick={() => {
                  close();
                  onEdit();
                }}
              />
            ) : null}
          </div>
          {owner ? (
            <div className="pantry-list sheet-group">
              <ActionRow
                danger
                icon={<Trash2 size={20} aria-hidden="true" />}
                label="Delete"
                hint="You can undo this"
                onClick={() => {
                  close();
                  onDelete();
                }}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {view === "share" ? (
        <>
          <HouseholdShareList
            label="Households"
            sharedIds={sharedIds}
            disabled={share.isPending || unshare.isPending}
            onToggle={(householdId, next) =>
              (next ? share : unshare).mutate({ id: recipe.id, householdId })
            }
          />
          <ErrorNotice
            message={share.error?.message ?? unshare.error?.message}
          />
        </>
      ) : null}

      {view === "tags" ? (
        <>
          <ErrorNotice
            message={tags.error?.message}
            retry={() => void tags.refetch()}
          />
          {tags.isPending ? (
            <p className="sheet-hint" role="status">
              Loading tags…
            </p>
          ) : null}
          <TagChoices
            tags={tags.data ?? []}
            selected={tagIds}
            disabled={setTag.isPending}
            toggle={(tagId) =>
              setTag.mutate({
                id: recipe.id,
                tagId,
                selected: !tagIds.includes(tagId),
              })
            }
          />
          <ErrorNotice message={setTag.error?.message} />
          <p className="sheet-hint">
            <Link to="/settings" className="text-button">
              Manage your tags
            </Link>
          </p>
        </>
      ) : null}

      {view === "copy" ? (
        <>
          <div className="pantry-list">
            {[
              { id: null, name: "Just me", color: "sage" },
              ...households.shareable,
            ].map((household) => (
              <button
                key={household.id ?? "personal"}
                type="button"
                className="pantry-row pick-row"
                disabled={copy.isPending}
                style={
                  {
                    "--hc": toneColor(householdTone(household.color)),
                  } as CSSProperties
                }
                onClick={() =>
                  copy.mutate({
                    id: recipe.id,
                    newId: crypto.randomUUID(),
                    householdId: household.id,
                  })
                }
              >
                <span className="hmark" aria-hidden="true" />
                <span className="pantry-row-text">
                  <b>
                    {household.id
                      ? `Copy and share with ${household.name}`
                      : "Copy to my recipes"}
                  </b>
                  <small>
                    {household.id ? "Your copy, shared" : "Only you"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {copy.isPending ? (
            <p className="sheet-hint" role="status">
              Copying…
            </p>
          ) : null}
          <ErrorNotice message={copy.error?.message} />
        </>
      ) : null}
    </Sheet>
  );
}
