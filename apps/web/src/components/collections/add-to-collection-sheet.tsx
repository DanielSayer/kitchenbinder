import { useMutation } from "@tanstack/react-query";
import { Check, FolderPlus, Plus } from "lucide-react";
import { type CSSProperties, type FormEvent, useState } from "react";
import { toast } from "sonner";
import { ErrorNotice } from "@/components/feedback";
import { Sheet, toneColor } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import {
  collectionTone,
  useCollections,
  useInvalidateCollections,
} from "./use-collections";

const plural = (count: number) =>
  `${count} ${count === 1 ? "recipe" : "recipes"}`;

/**
 * Pick the user's own collections for one recipe (toggle membership, when
 * `memberOf` is given) or for a selection (tap adds them all).
 */
export function AddToCollectionSheet({
  open,
  onOpenChange,
  recipeIds,
  memberOf,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeIds: readonly string[];
  /** The single recipe's current collections; enables toggling. */
  memberOf?: readonly string[];
  onAdded?: (collectionId: string) => void;
}) {
  const trpc = useTRPC();
  const collections = useCollections();
  const invalidate = useInvalidateCollections();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const mine = collections.data?.filter((item) => item.isOwner) ?? [];
  const toggling = memberOf !== undefined;

  const add = useMutation(
    trpc.collections.addRecipes.mutationOptions({
      onSuccess: async ({ added }, { collectionId }) => {
        await invalidate();
        const target = mine.find((item) => item.id === collectionId);
        if (!toggling) {
          toast.success(
            added
              ? `Added ${plural(added)} to ${target?.name ?? "the collection"}.`
              : `Already in ${target?.name ?? "that collection"}.`,
          );
          onOpenChange(false);
        }
        onAdded?.(collectionId);
      },
    }),
  );
  const remove = useMutation(
    trpc.collections.removeRecipes.mutationOptions({ onSettled: invalidate }),
  );
  const create = useMutation(
    trpc.collections.create.mutationOptions({
      onSuccess: async (created) => {
        setCreating(false);
        setName("");
        await invalidate();
        add.mutate({ collectionId: created.id, recipeIds: [...recipeIds] });
      },
    }),
  );
  const pending = add.isPending || remove.isPending || create.isPending;

  const isMember = (id: string) => {
    if (add.isPending && add.variables.collectionId === id) return true;
    if (remove.isPending && remove.variables.collectionId === id) return false;
    return memberOf?.includes(id) ?? false;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim())
      create.mutate({
        id: crypto.randomUUID(),
        name: name.trim(),
        description: "",
      });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setCreating(false);
        onOpenChange(next);
      }}
      title="Add to collection"
      description={
        toggling ? undefined : `${plural(recipeIds.length)} selected`
      }
      footer={
        toggling ? (
          <button
            type="button"
            className="button button-primary button-block"
            onClick={() => onOpenChange(false)}
          >
            Done
          </button>
        ) : undefined
      }
    >
      {collections.isPending ? (
        <p className="sheet-hint" role="status">
          Loading collections…
        </p>
      ) : null}
      <ErrorNotice
        message={collections.error?.message}
        retry={() => void collections.refetch()}
      />
      {mine.length ? (
        <div className="pantry-list">
          {mine.map((collection) => {
            const member = isMember(collection.id);
            return (
              <button
                key={collection.id}
                type="button"
                {...(toggling
                  ? { role: "checkbox", "aria-checked": member }
                  : {})}
                disabled={pending}
                className="pantry-row pick-row"
                style={
                  {
                    "--hc": toneColor(collectionTone(collection)),
                  } as CSSProperties
                }
                onClick={() => {
                  const input = {
                    collectionId: collection.id,
                    recipeIds: [...recipeIds],
                  };
                  if (toggling && member) remove.mutate(input);
                  else add.mutate(input);
                }}
              >
                <span className="hmark" aria-hidden="true" />
                <span className="pantry-row-text">
                  <b>{collection.name}</b>
                  <small>{plural(collection.recipeCount)}</small>
                </span>
                {toggling ? (
                  <span className="pick-check" aria-hidden="true">
                    <Check size={16} />
                  </span>
                ) : (
                  <Plus
                    size={18}
                    className="pantry-row-go"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      ) : collections.isSuccess ? (
        <p className="sheet-hint">
          You don't have any collections yet. Create one to start.
        </p>
      ) : null}
      {creating ? (
        <form className="sheet-inline-form" onSubmit={submit}>
          <label className="sheet-field">
            <span className="pantry-visually-hidden">Collection name</span>
            <input
              // biome-ignore lint/a11y/noAutofocus: opened by an explicit tap
              autoFocus
              value={name}
              maxLength={60}
              placeholder="New collection name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="button button-primary"
            disabled={!name.trim() || pending}
          >
            {create.isPending ? "Creating…" : "Create & add"}
          </button>
        </form>
      ) : (
        <div className="pantry-list sheet-group">
          <button
            type="button"
            className="pantry-row sheet-add-row"
            onClick={() => setCreating(true)}
          >
            <span className="pantry-row-icon">
              <FolderPlus size={20} aria-hidden="true" />
            </span>
            <span className="pantry-row-text">
              <b>New collection</b>
            </span>
          </button>
        </div>
      )}
      <ErrorNotice
        message={
          add.error?.message ?? remove.error?.message ?? create.error?.message
        }
      />
    </Sheet>
  );
}
