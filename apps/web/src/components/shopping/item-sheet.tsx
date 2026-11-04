import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useHouseholdScope } from "@/components/households/household-context";
import { Sheet } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice } from "../feedback";
import type { Item, Status } from "./shopping-groups";

function useDraft(key: string, initial: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const update = (text: string) => {
    setValue(text);
    try {
      if (text === initial) localStorage.removeItem(key);
      else localStorage.setItem(key, text);
    } catch {
      /* Keep input in memory when storage is unavailable. */
    }
  };
  return [value, update] as const;
}

export function ItemSheet({
  item,
  userId,
  open,
  onClose,
  onStatus,
  onRemove,
}: {
  item: Item;
  userId: string;
  open: boolean;
  onClose: () => void;
  onStatus: (status: Status) => void;
  onRemove: () => void;
}) {
  const trpc = useTRPC();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const draftKey = `shopping:${userId}:${item.id}`;
  const [draft, setDraft] = useDraft(draftKey, item.text);
  const update = useMutation(
    trpc.shopping.updateItem.mutationOptions({
      onSuccess: async () => {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* Optional draft storage. */
        }
        await client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
        onClose();
      },
    }),
  );
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !update.isPending) onClose();
      }}
      title="Edit item"
      footer={
        <>
          <button
            type="submit"
            form={`shop-edit-${item.id}`}
            className="button button-primary button-block"
            disabled={update.isPending || !draft.trim()}
          >
            {update.isPending ? "Saving..." : "Save"}
          </button>
          <div className="shop-sheet-secondary">
            <button
              type="button"
              className="button button-ghost"
              disabled={update.isPending}
              onClick={() =>
                onStatus(item.status === "needed" ? "owned" : "needed")
              }
            >
              {item.status === "needed" ? "Have it" : "Need this"}
            </button>
            <button
              type="button"
              className="button button-ghost shop-remove"
              disabled={update.isPending}
              onClick={onRemove}
            >
              <Trash2 size={16} aria-hidden="true" />
              Remove
            </button>
          </div>
        </>
      }
    >
      <form
        id={`shop-edit-${item.id}`}
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            householdId,
            kind: "text",
            id: item.id,
            text: draft,
          });
        }}
      >
        <label className="pick-field">
          <span>Item</span>
          <input
            value={draft}
            maxLength={2000}
            disabled={update.isPending}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {item.recipeTitle && (
          <p className="meal-sheet-hint shop-sheet-from">
            From {item.recipeTitle}
          </p>
        )}
        <ErrorNotice message={update.error?.message} />
      </form>
    </Sheet>
  );
}
