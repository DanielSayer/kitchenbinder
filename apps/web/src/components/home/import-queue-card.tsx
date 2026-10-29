import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Pencil, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RecipeCover } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice } from "../feedback";
import { OrganiseDialog } from "../recipes/organise-dialog";
import type { PendingImport } from "./import-draft";

export function ImportQueueCard({
  request,
  collectionName,
  canEdit,
  onRemove,
  onOpen,
}: {
  request: PendingImport;
  collectionName: string;
  canEdit: boolean;
  onRemove: (id: string, restoreInput?: string) => boolean;
  /** Opens the ready-to-save sheet for one recipe; recipeIds lists the rest. */
  onOpen: (recipeId: string, recipeIds: string[]) => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const submitted = useRef(false);
  const completed = useRef(false);
  const viewInput = useRef<HTMLButtonElement>(null);
  const [showInput, setShowInput] = useState(false);
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
    if (submitted.current) return;
    submitted.current = true;
    // Reuse the persisted ID, including when an admission response was lost.
    create.mutate(request);
  }, [request, create.mutate]);

  const status = useQuery(
    trpc.recipes.importStatus.queryOptions(
      { id: request.id },
      {
        enabled: create.isSuccess || (create.isError && !admissionRejected),
        retry: false,
        meta: { errorToast: false },
        refetchInterval: (query) => {
          const kind = query.state.data?.kind;
          return kind === "saved" || kind === "failed" ? false : 2000;
        },
      },
    ),
  );
  const result = status.data ?? create.data;
  const terminal = result?.kind === "saved" || result?.kind === "failed";
  const rejected = admissionRejected && !result;
  const busy = !terminal && !rejected;
  const saved = result?.kind === "saved" ? result : undefined;
  // Imports admitted before multi-recipe imports report only recipeId and title.
  const savedRecipes =
    saved?.recipes ??
    (saved ? [{ id: saved.recipeId, title: saved.title }] : []);
  const remaining = savedRecipes.filter(
    (item) => !request.done?.includes(item.id),
  );
  const single = remaining.length === 1 ? remaining[0] : undefined;
  const recipe = useQuery(
    trpc.recipes.get.queryOptions(
      { id: single?.id ?? "" },
      { enabled: !!single, meta: { errorToast: false } },
    ),
  );

  useEffect(() => {
    if (!saved || completed.current) return;
    completed.current = true;
    void client.invalidateQueries({ queryKey: trpc.recipes.list.queryKey() });
  }, [saved, client, trpc]);

  const progress =
    result?.kind === "queued"
      ? (result.queuedForMs ?? 0) >= 30_000
        ? `Still waiting to start after ${Math.floor((result.queuedForMs ?? 0) / 1000)} seconds. This is taking longer than expected. You can leave this page and check Recent imports later.`
        : "Your recipe is queued. You can leave this page and return later."
      : result?.kind === "processing" && result.stage === "fetching"
        ? "Reading the recipe page. Your progress is saved."
        : result?.kind === "processing" && result.stage === "saving"
          ? "Saving your recipe. Your progress is saved."
          : !result && create.isPending
            ? "Sending your request. You can keep adding recipes."
            : "Creating your recipe. You can refresh or return later to check progress.";
  // Rough stage position for the progress bar.
  const stage =
    result?.kind === "processing"
      ? result.stage === "fetching"
        ? 0.3
        : result.stage === "saving"
          ? 0.9
          : 0.6
      : result?.kind === "queued"
        ? 0.15
        : 0.06;
  const ingredients = recipe.data?.content.ingredients.length;
  const label = saved
    ? ingredients && single
      ? `Ready · ${ingredients} ingredients`
      : "Ready"
    : result?.kind === "failed"
      ? "Failed"
      : rejected
        ? "Not started"
        : result?.kind === "queued"
          ? "Queued"
          : result?.kind === "processing"
            ? result.stage === "fetching"
              ? "Reading recipe"
              : result.stage === "saving"
                ? "Saving recipe"
                : "Creating recipe"
            : "Sending request";
  const error =
    discard.error?.message ??
    (result?.kind === "failed" ? result.message : undefined) ??
    (!terminal ? create.error?.message : undefined) ??
    (status.error && status.error.data?.code !== "NOT_FOUND"
      ? "Couldn't check progress. Your import is still saved; reconnect to check again."
      : undefined);
  const summary = request.input.replace(/\s+/g, " ");
  const excerpt = summary.length > 110 ? `${summary.slice(0, 110)}…` : summary;
  const title = saved
    ? remaining.length > 1
      ? `${remaining.length} recipes`
      : (single?.title ?? saved.title)
    : excerpt;
  const failed = result?.kind === "failed" || rejected;

  async function editOrCancel(edit: boolean) {
    if (edit && !canEdit) return;
    try {
      // Tombstone an uncertain submission before forgetting its ID.
      await discard.mutateAsync(request);
      onRemove(request.id, edit ? request.input : undefined);
    } catch {
      /* Keep this card and its request ID recoverable. */
    }
  }

  function closeInput() {
    setShowInput(false);
    queueMicrotask(() => viewInput.current?.focus());
  }

  return (
    <article
      className="qcard"
      data-state={saved ? "ready" : failed ? "failed" : "busy"}
      aria-label={`Recipe request: ${excerpt}`}
    >
      {saved && remaining.length > 1 && (
        <h3 className="qcard-group">{title}</h3>
      )}
      {saved &&
        remaining.map((item) => (
          <div className="qcard-main" key={item.id}>
            <RecipeCover
              id={item.id}
              title={item.title}
              size="list"
              className="qcard-cover"
            />
            <div className="qcard-body">
              {remaining.length > 1 ? <h4>{item.title}</h4> : <h3>{title}</h3>}
              <p className="qcard-state" role="status">
                <span className="qcard-ready" aria-hidden="true">
                  <Check size={10} strokeWidth={3} />
                </span>
                {label}
              </p>
            </div>
            <button
              type="button"
              className="qcard-open"
              aria-label={`Open ${item.title}`}
              onClick={() =>
                onOpen(
                  item.id,
                  savedRecipes.map((recipe) => recipe.id),
                )
              }
            >
              Open
            </button>
          </div>
        ))}
      {!saved && (
        <div className="qcard-main">
          {failed ? (
            <span className="qcard-thumb qcard-thumb-failed" aria-hidden="true">
              <AlertCircle size={22} />
            </span>
          ) : (
            <span className="qcard-thumb" aria-hidden="true" />
          )}
          <div className="qcard-body">
            <h3>{title}</h3>
            <p className="qcard-state" role="status">
              {busy && <span className="qcard-pulse" aria-hidden="true" />}
              {label}
              {collectionName !== "Just me" && (
                <span className="qcard-destination">{collectionName}</span>
              )}
            </p>
            {busy && (
              <span className="qcard-bar" aria-hidden="true">
                <i style={{ width: `${Math.round(stage * 100)}%` }} />
              </span>
            )}
          </div>
        </div>
      )}
      {busy && <p className="qcard-hint">{progress}</p>}
      <ErrorNotice message={error} />
      {!saved && (
        <div className="qcard-actions">
          <button
            type="button"
            className="qcard-link"
            ref={viewInput}
            onClick={() => setShowInput(true)}
          >
            View input
          </button>
          {busy && (create.isError || status.isError) && !admissionRejected && (
            <button
              type="button"
              className="qcard-action"
              disabled={create.isPending || status.isFetching}
              onClick={() =>
                create.isError ? create.mutate(request) : void status.refetch()
              }
            >
              <RefreshCw size={15} aria-hidden="true" /> Check again
            </button>
          )}
          {failed && (
            <button
              type="button"
              className="qcard-action"
              disabled={discard.isPending || !canEdit}
              onClick={() => void editOrCancel(true)}
            >
              <Pencil size={15} aria-hidden="true" />{" "}
              {rejected ? "Edit and try again" : "Edit and retry"}
            </button>
          )}
          {(result?.kind === "failed" || create.isError) && (
            <button
              type="button"
              className="qcard-action qcard-dismiss"
              aria-label={busy ? "Cancel request" : "Dismiss"}
              title={busy ? "Cancel request" : "Dismiss request"}
              disabled={discard.isPending}
              onClick={() => void editOrCancel(false)}
            >
              <X size={15} aria-hidden="true" /> {busy && "Cancel request"}
            </button>
          )}
        </div>
      )}
      {failed && !canEdit && (
        <p className="qcard-hint">
          Clear your current input or finish manual entry to edit this request.
        </p>
      )}
      {result?.kind === "failed" && (
        <p className="qcard-hint">
          Retrying uses your AI allowance if generation starts.
        </p>
      )}
      {showInput && (
        <OrganiseDialog
          title="Submitted input"
          className="import-input-dialog"
          onClose={closeInput}
        >
          <p className="import-input-content">{request.input}</p>
          <p className="import-card-destination">Save to {collectionName}</p>
          <p className="import-card-reference">
            Import reference: {request.id}
          </p>
          <div className="organise-dialog-footer">
            <button
              type="button"
              className="button button-outline"
              onClick={closeInput}
            >
              Close
            </button>
          </div>
        </OrganiseDialog>
      )}
    </article>
  );
}
