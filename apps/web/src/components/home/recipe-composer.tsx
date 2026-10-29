import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { useHousehold } from "@/components/households/household-context";
import { undoToast } from "@/components/pantry";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice } from "../feedback";
import { readRecipeDraft, recipeDraftKey } from "../recipes/recipe-draft";
import { ComposerForm } from "./composer-form";
import { IdeaChips } from "./idea-chips";
import {
  importDraftKey,
  type PendingImport,
  readImportQueue,
  writeImportQueue,
} from "./import-draft";
import { ImportQueueCard } from "./import-queue-card";
import { ImportReadySheet } from "./import-ready";
import { ManualRecipe } from "./manual-recipe";

export function RecipeComposer() {
  const { data: session, isPending } = authClient.useSession();
  return (
    <AccountComposer
      key={session?.user.id ?? "guest"}
      userId={session?.user.id}
      sessionPending={isPending}
    />
  );
}

function AccountComposer({
  userId,
  sessionPending,
}: {
  userId?: string;
  sessionPending: boolean;
}) {
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState("");
  const [queue, setQueue] = useState<PendingImport[]>([]);
  const queueRef = useRef(queue);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string>();
  const { householdId, available, households, selectHousehold } =
    useHousehold();
  const navigate = useNavigate();
  const key = importDraftKey(userId ?? "guest");
  const trpc = useTRPC();
  const client = useQueryClient();
  const [ready, setReady] = useState<{
    id: string;
    recipeId: string;
    recipeIds: string[];
  } | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const deleteRecipe = useMutation(
    trpc.recipes.delete.mutationOptions({
      onSettled: () =>
        client.invalidateQueries({ queryKey: trpc.recipes.list.queryKey() }),
    }),
  );

  useEffect(() => {
    const restored = userId ? readImportQueue(key) : [];
    queueRef.current = restored;
    setQueue(restored);
    try {
      const guestKey = `${importDraftKey("guest")}:text`;
      // The submitted input belongs to its card, not the next recipe draft.
      const legacy = sessionStorage.getItem(key) !== null;
      const storedText = sessionStorage.getItem(`${key}:text`);
      const text =
        (legacy && storedText === restored[0]?.input ? "" : storedText) ??
        (userId ? sessionStorage.getItem(guestKey) : null) ??
        "";
      setInput(text);
      sessionStorage.setItem(`${key}:text`, text);
      if (legacy && restored.length > 0) writeImportQueue(key, restored);
      if (userId && text) sessionStorage.removeItem(guestKey);
    } catch {
      /* Editing still works without storage. */
    }
    setManual(!!userId && !!readRecipeDraft(recipeDraftKey(userId)));
    setLoaded(true);
  }, [key, userId]);

  function change(value: string) {
    setInput(value);
    try {
      sessionStorage.setItem(`${key}:text`, value);
    } catch {
      /* Submission checks durable storage separately. */
    }
  }

  function persist(next: PendingImport[]) {
    if (!writeImportQueue(key, next)) {
      setStorageError(
        "Couldn't save the recipe queue in this browser. Try again.",
      );
      return false;
    }
    queueRef.current = next;
    setQueue(next);
    setStorageError(undefined);
    return true;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const value = inputRef.current?.value.trim() ?? input.trim();
    if (!loaded || sessionPending || value.length < 3) return;
    if (!userId) {
      void navigate({ to: "/login" });
      return;
    }
    // Share with the selected household on save; the ready sheet can change it.
    const next = {
      id: crypto.randomUUID(),
      input: value,
      // A household the user has left falls back to "Just me".
      householdId: households.data && !available ? null : householdId,
    };
    if (!persist([...queueRef.current, next])) return;
    change("");
    // Clear immediately as well, so a second submit cannot reuse the old text.
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.focus();
  }

  function remove(id: string, restoreInput?: string) {
    if (
      restoreInput !== undefined &&
      (!inputRef.current || inputRef.current.value.trim())
    )
      return false;
    const original = queueRef.current.find((item) => item.id === id);
    if (restoreInput !== undefined) {
      try {
        // Keep the original card recoverable until its input draft is stored.
        sessionStorage.setItem(`${key}:text`, restoreInput);
      } catch {
        setStorageError(
          "Couldn't restore this input in your browser. Try again.",
        );
        return false;
      }
    }
    if (!persist(queueRef.current.filter((item) => item.id !== id)))
      return false;
    if (restoreInput !== undefined) {
      if (original) selectHousehold(original.householdId);
      setInput(restoreInput);
      inputRef.current?.focus();
    }
    return true;
  }

  // Mark the open recipe handled; the card goes once all its recipes are.
  function withoutReady(current: NonNullable<typeof ready>) {
    return queueRef.current.flatMap((item) => {
      if (item.id !== current.id) return [item];
      const done = [...(item.done ?? []), current.recipeId];
      return current.recipeIds.every((id) => done.includes(id))
        ? []
        : [{ ...item, done }];
    });
  }

  function finishReady() {
    if (!ready) return;
    setReadyOpen(false);
    persist(withoutReady(ready));
  }

  // Undo, not "are you sure?": hide the recipe now, delete when the toast goes.
  function discardReady() {
    if (!ready) return;
    const index = queueRef.current.findIndex((item) => item.id === ready.id);
    const original = queueRef.current[index];
    if (!original) return;
    const recipeId = ready.recipeId;
    setReadyOpen(false);
    if (!persist(withoutReady(ready))) return;
    undoToast("Recipe discarded", {
      onUndo: () => {
        const next = queueRef.current.filter((item) => item.id !== original.id);
        next.splice(Math.min(index, next.length), 0, original);
        persist(next);
      },
      onCommit: () => deleteRecipe.mutate({ id: recipeId }),
    });
  }

  return (
    <section className="add-composer-section" aria-label="Add a recipe">
      {manual ? (
        <ManualRecipe
          onCancel={() => setManual(false)}
          onReopen={() => setManual(true)}
        />
      ) : (
        <>
          <ComposerForm
            input={input}
            inputRef={inputRef}
            disabled={!loaded || sessionPending || input.trim().length < 3}
            onChange={change}
            onSubmit={submit}
            manualDisabled={sessionPending}
            onManual={() => {
              if (!userId) {
                void navigate({ to: "/login" });
                return;
              }
              setManual(true);
            }}
          />
          <IdeaChips disabled={!loaded || sessionPending} onSelect={change} />
        </>
      )}
      <ErrorNotice message={storageError} />
      {userId && queue.length > 0 && (
        <section className="add-queue" aria-labelledby="add-queue-title">
          <div className="add-queue-heading">
            <h2 id="add-queue-title">In the oven</h2>
            <span>
              {queue.length} {queue.length === 1 ? "recipe" : "recipes"}
            </span>
          </div>
          <ul className="add-queue-list">
            {queue.map((item) => (
              <li key={item.id}>
                <ImportQueueCard
                  request={item}
                  collectionName={
                    item.householdId
                      ? (households.data?.find(
                          (household) => household.id === item.householdId,
                        )?.name ?? "Original household")
                      : "Just me"
                  }
                  canEdit={!manual && !input.trim()}
                  onRemove={remove}
                  onOpen={(recipeId, recipeIds) => {
                    setReady({ id: item.id, recipeId, recipeIds });
                    setReadyOpen(true);
                  }}
                />
              </li>
            ))}
          </ul>
          <p className="add-queue-foot">
            You can add another recipe while these finish.{" "}
            <Link to="/recipes/imports">Recent imports</Link>
          </p>
        </section>
      )}
      {ready && (
        <ImportReadySheet
          key={ready.recipeId}
          recipeId={ready.recipeId}
          open={readyOpen}
          onOpenChange={setReadyOpen}
          onSaved={finishReady}
          onDiscard={discardReady}
        />
      )}
    </section>
  );
}
