import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ErrorNotice } from "@/components/feedback";
import { Sheet } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { HouseholdShareList } from "./household-share-list";
import {
  type CollectionSummary,
  useInvalidateCollections,
} from "./use-collections";

/**
 * Create a collection (no `collection`), or manage one: rename, describe,
 * share with households and delete. Others' collections are read-only.
 */
export function CollectionSheet({
  open,
  onOpenChange,
  collection,
  onCreated,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection?: CollectionSummary;
  onCreated?: (id: string) => void;
  /** Parent hides it and offers Undo before committing. */
  onDelete?: (collection: CollectionSummary) => void;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidateCollections();
  const formId = useId();
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  useEffect(() => {
    if (!open) return;
    setName(collection?.name ?? "");
    setDescription(collection?.description ?? "");
  }, [open, collection?.name, collection?.description]);

  const create = useMutation(
    trpc.collections.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidate();
        onOpenChange(false);
        onCreated?.(created.id);
        toast.success(`Created ${created.name}.`);
      },
    }),
  );
  const update = useMutation(
    trpc.collections.update.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const share = useMutation(
    trpc.collections.share.mutationOptions({ onSettled: invalidate }),
  );
  const unshare = useMutation(
    trpc.collections.unshare.mutationOptions({ onSettled: invalidate }),
  );

  const editing = !!collection;
  const readOnly = editing && !collection.isOwner;
  const pending = create.isPending || update.isPending;
  const sharedIds = collection
    ? collection.sharedWith
        .map((item) => item.id)
        .filter(
          (id) => !(unshare.isPending && unshare.variables.householdId === id),
        )
        .concat(
          share.isPending &&
            !collection.sharedWith.some(
              (item) => item.id === share.variables.householdId,
            )
            ? [share.variables.householdId]
            : [],
        )
    : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!collection) {
      create.mutate({
        id: crypto.randomUUID(),
        name: trimmed,
        description: description.trim(),
      });
    } else if (
      trimmed === collection.name &&
      description.trim() === collection.description
    ) {
      onOpenChange(false);
    } else {
      update.mutate({
        collectionId: collection.id,
        name: trimmed,
        description: description.trim(),
      });
    }
  };

  if (readOnly)
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={collection.name}
        description={`Shared by ${collection.owner.name}`}
      >
        {collection.description ? (
          <p className="sheet-copy">{collection.description}</p>
        ) : null}
        <p className="sheet-hint">
          {collection.recipeCount}{" "}
          {collection.recipeCount === 1 ? "recipe" : "recipes"}
          {collection.sharedWith.length
            ? ` · shared with ${collection.sharedWith.map((item) => item.name).join(", ")}`
            : ""}
          . Only {collection.owner.name} can change it.
        </p>
      </Sheet>
    );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit collection" : "New collection"}
      description={
        editing
          ? undefined
          : "Group recipes by why you keep them: weeknights, Christmas, Nan's."
      }
      footer={
        <button
          type="submit"
          form={formId}
          className="button button-primary button-block"
          disabled={pending || !name.trim()}
        >
          {pending ? "Saving…" : editing ? "Save changes" : "Create collection"}
        </button>
      }
    >
      <form id={formId} className="sheet-form" onSubmit={submit}>
        <label className="sheet-field">
          <span>Name</span>
          <input
            value={name}
            maxLength={60}
            required
            autoComplete="off"
            placeholder="Weeknight dinners"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="sheet-field">
          <span>Description (optional)</span>
          <textarea
            value={description}
            maxLength={500}
            rows={2}
            placeholder="What's this collection for?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <ErrorNotice message={create.error?.message ?? update.error?.message} />
      </form>
      {collection ? (
        <>
          <HouseholdShareList
            sharedIds={sharedIds}
            disabled={share.isPending || unshare.isPending}
            onToggle={(householdId, next) =>
              (next ? share : unshare).mutate({
                collectionId: collection.id,
                householdId,
              })
            }
          />
          <p className="sheet-hint">
            Members see the recipes you own in this collection.
          </p>
          <ErrorNotice
            message={share.error?.message ?? unshare.error?.message}
          />
          {onDelete ? (
            <div className="pantry-list sheet-group">
              <button
                type="button"
                className="pantry-row sheet-danger-row"
                onClick={() => {
                  onOpenChange(false);
                  onDelete(collection);
                }}
              >
                <span className="pantry-row-icon">
                  <Trash2 size={20} aria-hidden="true" />
                </span>
                <span className="pantry-row-text">
                  <b>Delete collection</b>
                  <small>Recipes stay in All. You can undo this.</small>
                </span>
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
