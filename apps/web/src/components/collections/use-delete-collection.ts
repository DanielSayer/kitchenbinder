import { useState } from "react";
import { toast } from "sonner";
import { undoToast } from "@/components/pantry";
import { useTRPCClient } from "@/utils/trpc";
import {
  type CollectionSummary,
  useInvalidateCollections,
} from "./use-collections";

/**
 * Undo, not "are you sure": hide the collection at once and only delete it
 * when the toast closes without Undo. Uses the raw client so the commit still
 * runs if the screen unmounts first.
 */
export function useDeleteCollection() {
  const client = useTRPCClient();
  const invalidate = useInvalidateCollections();
  const [hidden, setHidden] = useState<string[]>([]);
  const show = (id: string) =>
    setHidden((current) => current.filter((item) => item !== id));

  const deleteCollection = (collection: CollectionSummary) => {
    setHidden((current) => [...current, collection.id]);
    undoToast(`Deleted ${collection.name}`, {
      onUndo: () => show(collection.id),
      onCommit: () => {
        void client.collections.delete
          .mutate({ collectionId: collection.id })
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error
                ? error.message
                : "Couldn't delete the collection.",
            );
          })
          .finally(async () => {
            await invalidate();
            show(collection.id);
          });
      },
    });
  };

  return { hidden, deleteCollection };
}
