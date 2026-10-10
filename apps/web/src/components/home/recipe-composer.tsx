import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, RefreshCw, X } from "lucide-react";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { CollectionSelect, useCollection } from "../groups/collection-context";
import { readRecipeDraft, recipeDraftKey } from "../recipes/recipe-draft";
import { ComposerFeedback } from "./composer-feedback";
import { ComposerForm } from "./composer-form";
import { IdeaChips } from "./idea-chips";
import {
  importDraftKey,
  type PendingImport,
  readPendingImport,
  writePendingImport,
} from "./import-draft";
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
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string>();
  const completed = useRef<string | null>(null);
  const { groupId, available, groups } = useCollection();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const key = importDraftKey(userId ?? "guest");
  const create = useMutation(trpc.recipes.create.mutationOptions());
  const discard = useMutation(trpc.recipes.discardImport.mutationOptions());
  const rejectionCode = create.error?.data?.code;
  const admissionRejected =
    rejectionCode === "BAD_REQUEST" ||
    rejectionCode === "UNAUTHORIZED" ||
    rejectionCode === "FORBIDDEN" ||
    rejectionCode === "NOT_FOUND" ||
    rejectionCode === "CONFLICT" ||
    rejectionCode === "PRECONDITION_FAILED" ||
    rejectionCode === "TOO_MANY_REQUESTS";

  useEffect(() => {
    const restored = userId ? readPendingImport(key) : null;
    setPending(restored);
    try {
      const guestKey = `${importDraftKey("guest")}:text`;
      const text =
        restored?.input ??
        sessionStorage.getItem(`${key}:text`) ??
        (userId ? sessionStorage.getItem(guestKey) : null) ??
        "";
      setInput(text);
      if (userId && text) {
        sessionStorage.setItem(`${key}:text`, text);
        sessionStorage.removeItem(guestKey);
      }
    } catch {
      /* Editing still works without storage. */
    }
    setManual(
      !restored && !!userId && !!readRecipeDraft(recipeDraftKey(userId)),
    );
    setLoaded(true);
  }, [key, userId]);

  // Re-submission also recovers a request whose response was lost. The ID is unchanged.
  const submitted = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || !userId || submitted.current === pending.id) return;
    submitted.current = pending.id;
    create.mutate(pending);
  }, [pending, userId, create.mutate]);

  const status = useQuery(
    trpc.recipes.importStatus.queryOptions(
      { id: pending?.id ?? "00000000-0000-4000-8000-000000000000" },
      {
        enabled:
          !!pending &&
          !!userId &&
          (create.isSuccess || (create.isError && !admissionRejected)),
        retry: false,
        // Progress errors have inline feedback, including recovery before admission.
        meta: { errorToast: false },
        refetchInterval: (query) => {
          if (admissionRejected && !query.state.data) return false;
          const kind = query.state.data?.kind;
          return kind === "saved" || kind === "failed" ? false : 2000;
        },
      },
    ),
  );
  const result =
    status.data ?? (create.data?.id === pending?.id ? create.data : undefined);
  const terminal = result?.kind === "saved" || result?.kind === "failed";
  const rejected = admissionRejected && !result;
  const busy = !!pending && !terminal && !rejected;
  useEffect(() => {
    if (result?.kind !== "saved" || completed.current === result.id) return;
    completed.current = result.id;
    void queryClient.invalidateQueries({
      queryKey: trpc.recipes.list.queryKey(),
    });
  }, [result, queryClient, trpc]);

  function change(value: string) {
    setInput(value);
    try {
      sessionStorage.setItem(`${key}:text`, value);
    } catch {
      /* Submission checks durable storage separately. */
    }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending || !available || input.trim().length < 3) return;
    if (!userId) {
      void navigate({ to: "/login" });
      return;
    }
    const next = { id: crypto.randomUUID(), input: input.trim(), groupId };
    if (!writePendingImport(key, next)) {
      setStorageError(
        "Allow browser storage before starting so your import can recover after a refresh.",
      );
      return;
    }
    setStorageError(undefined);
    setPending(next);
  }
  async function reset() {
    if (!pending) return;
    // Tombstone an uncertain submission before allowing another ID.
    try {
      await discard.mutateAsync(pending);
      if (!writePendingImport(key, null)) {
        setStorageError("Couldn't clear the saved import. Try again.");
        return;
      }
      if (result?.kind === "saved") change("");
      setPending(null);
      submitted.current = null;
      create.reset();
      discard.reset();
      setStorageError(undefined);
    } catch {
      /* Keep the pending request recoverable. */
    }
  }
  const progress =
    result?.kind === "queued"
      ? (result.queuedForMs ?? 0) >= 30_000
        ? `Still waiting to start after ${Math.floor((result.queuedForMs ?? 0) / 1000)} seconds. This is taking longer than expected. Your request is saved; check Recent imports for updates.`
        : "Your recipe is queued. You can leave this page and return later."
      : result?.kind === "processing" && result.stage === "fetching"
        ? "Reading the recipe page. Your progress is saved."
        : result?.kind === "processing" && result.stage === "saving"
          ? "Saving your recipe. Your progress is saved."
          : "Creating your recipe. You can refresh or return later to check progress.";
  const error =
    storageError ??
    discard.error?.message ??
    (result?.kind === "failed" ? result.message : undefined) ??
    (!terminal ? create.error?.message : undefined) ??
    (status.error && status.error.data?.code !== "NOT_FOUND"
      ? "Couldn't check progress. Your import is still saved; reconnect to check again."
      : undefined);

  return (
    <section className="composer-section" aria-label="Add a recipe">
      {manual ? (
        <ManualRecipe onCancel={() => setManual(false)} />
      ) : (
        <>
          {userId &&
            (pending ? (
              <p>
                Save to{" "}
                <strong>
                  {pending.groupId
                    ? (groups.data?.find(
                        (group) => group.id === pending.groupId,
                      )?.name ?? "Original group collection")
                    : "Personal collection"}
                </strong>
              </p>
            ) : (
              <CollectionSelect label="Save to" />
            ))}
          <ComposerForm
            input={input}
            pending={busy}
            locked={!!pending}
            disabled={
              !!pending ||
              !loaded ||
              !available ||
              sessionPending ||
              input.trim().length < 3
            }
            onChange={change}
            onSubmit={submit}
            manualDisabled={!!pending || sessionPending}
            onManual={() => {
              if (!userId) {
                void navigate({ to: "/login" });
                return;
              }
              setManual(true);
            }}
          />
          <ComposerFeedback
            pending={busy}
            progress={progress}
            error={error}
            saved={result?.kind === "saved" ? result : undefined}
          />
          {busy && pending && (
            <p className="composer-footnote">
              <Link to="/recipes/imports">Check import status</Link>
              <br />
              Import reference: {pending.id}
            </p>
          )}
          {pending && (
            <div className="composer-toolbar">
              {busy && create.isError && !admissionRejected && (
                <button
                  type="button"
                  className="text-button"
                  disabled={create.isPending}
                  onClick={() => create.mutate(pending)}
                >
                  <RefreshCw size={17} aria-hidden="true" /> Check again
                </button>
              )}
              {(terminal || create.isError) && (
                <button
                  type="button"
                  className="text-button"
                  disabled={discard.isPending}
                  onClick={() => void reset()}
                >
                  {result?.kind === "saved" ? (
                    <Plus size={17} aria-hidden="true" />
                  ) : terminal ? (
                    <Pencil size={17} aria-hidden="true" />
                  ) : (
                    <X size={17} aria-hidden="true" />
                  )}
                  {result?.kind === "saved"
                    ? "Add another recipe"
                    : terminal
                      ? "Edit and start a new attempt"
                      : rejected
                        ? "Edit and try again"
                        : "Cancel request"}
                </button>
              )}
            </div>
          )}
          <IdeaChips disabled={!!pending} onSelect={change} />
          {result?.kind === "failed" && (
            <p className="composer-footnote">
              Retrying uses your AI allowance if generation starts.
            </p>
          )}
        </>
      )}
    </section>
  );
}
