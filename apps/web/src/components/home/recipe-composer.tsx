import { Link, useNavigate } from "@tanstack/react-router";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ErrorNotice } from "../feedback";
import { CollectionSelect, useCollection } from "../groups/collection-context";
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
  const { groupId, available, groups, selectGroup } = useCollection();
  const navigate = useNavigate();
  const key = importDraftKey(userId ?? "guest");

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
    if (!loaded || sessionPending || !available || value.length < 3) return;
    if (!userId) {
      void navigate({ to: "/login" });
      return;
    }
    const next = { id: crypto.randomUUID(), input: value, groupId };
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
      if (original) selectGroup(original.groupId);
      setInput(restoreInput);
      inputRef.current?.focus();
    }
    return true;
  }

  return (
    <section className="composer-section" aria-label="Add a recipe">
      {manual ? (
        <ManualRecipe onCancel={() => setManual(false)} />
      ) : (
        <>
          {userId && <CollectionSelect label="Save to" />}
          <ComposerForm
            input={input}
            inputRef={inputRef}
            disabled={
              !loaded || !available || sessionPending || input.trim().length < 3
            }
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
        <section className="import-queue" aria-label="Recipe queue">
          <div className="import-queue-heading">
            <h2>Your recipe requests</h2>
            <p>You can add another recipe while these finish.</p>
            <Link className="text-button" to="/recipes/imports">
              Recent imports
            </Link>
          </div>
          <ul className="import-queue-list">
            {queue.map((item) => (
              <li key={item.id}>
                <ImportQueueCard
                  request={item}
                  collectionName={
                    item.groupId
                      ? (groups.data?.find((group) => group.id === item.groupId)
                          ?.name ?? "Original group collection")
                      : "Personal collection"
                  }
                  canEdit={!manual && !input.trim()}
                  onRemove={remove}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
