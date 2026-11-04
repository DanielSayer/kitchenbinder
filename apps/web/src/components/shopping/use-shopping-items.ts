import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useHouseholdScope } from "@/components/households/household-context";
import { undoToast } from "@/components/pantry";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import type { Item, Status } from "./shopping-groups";

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function useShoppingItems(userId: string) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const householdId = useHouseholdScope();
  const client = useQueryClient();
  const listKey = trpc.shopping.list.queryKey({ householdId });
  const list = useQuery(trpc.shopping.list.queryOptions({ householdId }));
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const draftKey = `shopping:${userId}:new`;
  const [draft, setDraft] = useState<{ text: string; id: string }>(() => {
    let text = "";
    try {
      text = localStorage.getItem(draftKey) ?? "";
    } catch {
      /* Optional draft storage. */
    }
    return { text, id: crypto.randomUUID() };
  });
  const { text, id: newId } = draft;
  function updateDraft(next: typeof draft) {
    setDraft(next);
    try {
      if (!next.text) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, next.text);
    } catch {
      /* Keep input in memory when storage is unavailable. */
    }
  }
  const setText = (text: string) => updateDraft({ ...draft, text });
  const refresh = () =>
    client.invalidateQueries({ queryKey: trpc.shopping.pathKey() });
  const statusUpdate = useMutation(trpc.shopping.updateItem.mutationOptions());
  const changeStatus = (item: Item, status: Status, message?: string) =>
    changeStatuses([item], status, message);
  const changeStatuses = async (
    targets: readonly Item[],
    status: Status,
    message?: string,
  ) => {
    const ids = new Set(targets.map((item) => item.id));
    client.setQueryData(listKey, (old) =>
      old?.map((entry) => (ids.has(entry.id) ? { ...entry, status } : entry)),
    );
    if (message)
      undoToast(message, {
        id: "shopping-status",
        onUndo: () => {
          for (const item of targets)
            void changeStatus({ ...item, status }, item.status);
        },
      });
    try {
      await Promise.all(
        targets.map((item) =>
          statusUpdate.mutateAsync({
            householdId,
            kind: "status",
            id: item.id,
            status,
          }),
        ),
      );
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't update that item."));
    } finally {
      await refresh();
    }
  };
  const unhide = (ids: readonly string[]) =>
    setHidden((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  // Undo, not "are you sure?": hide now, delete when the toast closes.
  const removeLater = (
    ids: readonly string[],
    message: string,
    commit: () => Promise<unknown>,
  ) => {
    if (!ids.length) return;
    setHidden((current) => new Set([...current, ...ids]));
    undoToast(message, {
      onUndo: () => unhide(ids),
      onCommit: async () => {
        try {
          await commit();
          await Promise.all([
            refresh(),
            client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
          ]);
        } catch (cause) {
          toast.error(errorText(cause, "Couldn't remove those items."));
        } finally {
          unhide(ids);
        }
      },
    });
  };
  const removeItem = (item: Item) =>
    removeLater([item.id], `Removed ${item.text}`, () =>
      trpcClient.shopping.removeItem.mutate({ householdId, id: item.id }),
    );
  const add = useMutation(
    trpc.shopping.addItem.mutationOptions({
      // No toast: the new row is the confirmation, and a toast would cover
      // the input during rapid entry.
      onSuccess: async (_, input) => {
        // A retry after a failed add: clear the restored text.
        if (textRef.current === input.text) {
          updateDraft({ text: "", id: crypto.randomUUID() });
        }
        await refresh();
      },
      // Put the text (and its id, so a resubmit stays idempotent) back
      // unless the next item has been started.
      onError: (_, input) => {
        if (textRef.current) return;
        updateDraft({ text: input.text, id: input.id });
      },
    }),
  );
  const textRef = useRef(text);
  textRef.current = text;
  // Clear on submit, not on success, so the input stays editable and
  // focused (keyboard open) while the add saves.
  const submit = () => {
    if (!text.trim() || add.isPending) return;
    add.mutate({ householdId, id: newId, text });
    updateDraft({ text: "", id: crypto.randomUUID() });
  };
  const items = (list.data ?? []).filter((item) => !hidden.has(item.id));
  const needed = items.filter((item) => item.status === "needed");
  const bought = items.filter((item) => item.status === "bought");
  const owned = items.filter((item) => item.status === "owned");
  const clearBought = () =>
    removeLater(
      bought.map((item) => item.id),
      `Cleared ${bought.length} bought ${bought.length === 1 ? "item" : "items"}`,
      () => trpcClient.shopping.clear.mutate({ householdId, scope: "bought" }),
    );
  const clearAll = () =>
    removeLater(
      items.map((item) => item.id),
      "List cleared",
      () => trpcClient.shopping.clear.mutate({ householdId, scope: "all" }),
    );
  return {
    list,
    items,
    needed,
    bought,
    owned,
    add,
    text,
    setText,
    submit,
    changeStatus,
    changeStatuses,
    removeItem,
    clearBought,
    clearAll,
  };
}
