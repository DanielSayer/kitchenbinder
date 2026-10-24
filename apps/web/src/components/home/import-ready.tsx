import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";
import { type Destination, useSavedMessage } from "./destination";
import { ReadySheet } from "./ready-sheet";

/**
 * Imports save on the server as soon as they finish, so "Save" here confirms
 * where the recipe goes: it reconciles shares and the collection, then clears
 * the card. Discard deletes it after the undo window.
 */
export function ImportReadySheet({
  recipeId,
  open,
  onOpenChange,
  onSaved,
  onDiscard,
}: {
  recipeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDiscard: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const navigate = useNavigate();
  const savedMessage = useSavedMessage();
  const recipe = useQuery(
    trpc.recipes.get.queryOptions(
      { id: recipeId ?? "" },
      { enabled: !!recipeId },
    ),
  );
  const saved = recipe.data;
  const initial: Destination | null = saved
    ? {
        collectionId: saved.collectionIds[0] ?? null,
        householdIds: saved.sharedWith
          .filter((item) => !item.personal)
          .map((item) => item.id),
      }
    : null;
  const [destination, setDestination] = useState<Destination | null>(null);
  // Start from where the recipe already is, once per opened recipe.
  const initialKey = initial ? JSON.stringify(initial) : "";
  useEffect(() => {
    if (initialKey) setDestination(JSON.parse(initialKey) as Destination);
  }, [initialKey]);

  const share = useMutation(trpc.recipes.share.mutationOptions());
  const unshare = useMutation(trpc.recipes.unshare.mutationOptions());
  const add = useMutation(trpc.collections.addRecipes.mutationOptions());
  const remove = useMutation(trpc.collections.removeRecipes.mutationOptions());
  const place = useMutation({
    mutationFn: async (target: Destination) => {
      if (!saved || !initial) return;
      const id = saved.id;
      await Promise.all([
        ...target.householdIds
          .filter((item) => !initial.householdIds.includes(item))
          .map((householdId) => share.mutateAsync({ id, householdId })),
        ...initial.householdIds
          .filter((item) => !target.householdIds.includes(item))
          .map((householdId) => unshare.mutateAsync({ id, householdId })),
      ]);
      if (initial.collectionId && initial.collectionId !== target.collectionId)
        await remove.mutateAsync({
          collectionId: initial.collectionId,
          recipeIds: [id],
        });
      if (target.collectionId && target.collectionId !== initial.collectionId)
        await add.mutateAsync({
          collectionId: target.collectionId,
          recipeIds: [id],
        });
    },
    onSettled: () => client.invalidateQueries(),
  });

  async function save(review = false) {
    if (!destination || !saved) return;
    try {
      await place.mutateAsync(destination);
    } catch {
      return;
    }
    toast.success(savedMessage(destination));
    onSaved();
    if (review)
      void navigate({
        to: "/recipes/$recipeId",
        params: { recipeId: saved.id },
      });
  }

  return (
    <ReadySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) place.reset();
        onOpenChange(next);
      }}
      recipe={
        saved
          ? {
              id: saved.id,
              content: saved.content,
              sourceUrl: saved.sourceUrl,
              photo: saved.photo,
              tags: saved.tags,
            }
          : null
      }
      destination={
        destination ?? initial ?? { collectionId: null, householdIds: [] }
      }
      onDestinationChange={setDestination}
      onSave={() => void save()}
      saving={place.isPending}
      error={
        place.error?.message ??
        (recipe.isError ? "Couldn't load this recipe. Try again." : undefined)
      }
      secondary={
        <>
          <button
            type="button"
            className="button button-ghost"
            disabled={place.isPending || !saved}
            onClick={() => void save(true)}
          >
            Review details first
          </button>
          <button
            type="button"
            className="button button-ghost ready-discard"
            disabled={place.isPending || !saved}
            onClick={onDiscard}
          >
            Discard
          </button>
        </>
      }
    />
  );
}
