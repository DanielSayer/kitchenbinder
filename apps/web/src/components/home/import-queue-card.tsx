import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice } from "../feedback";
import { OrganiseDialog } from "../recipes/organise-dialog";
import type { PendingImport } from "./import-draft";

export function ImportQueueCard({
  request,
  collectionName,
  canEdit,
  onRemove,
}: {
  request: PendingImport;
  collectionName: string;
  canEdit: boolean;
  onRemove: (id: string, restoreInput?: string) => boolean;
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
  const label = saved
    ? "Saved"
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
      className={
        saved
          ? "import-queue-card import-queue-card-saved"
          : "import-queue-card"
      }
      aria-label={`Recipe request: ${excerpt}`}
    >
      <div className="import-card-heading">
        <h3>{saved?.title ?? excerpt}</h3>
        <span className="import-card-state" role="status">
          {saved ? (
            <Check size={15} aria-hidden="true" />
          ) : busy ? (
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
          ) : null}
          {label}
        </span>
      </div>
      {saved && <p className="import-card-source">{excerpt}</p>}
      <p className="import-card-destination">{collectionName}</p>
      {busy && (
        <div className="import-card-progress" role="status">
          <span className="progress-track" aria-hidden="true">
            <span />
          </span>
          <p>{progress}</p>
        </div>
      )}
      {saved && (
        <p className="import-card-success" role="status">
          Added to your collection!
        </p>
      )}
      <ErrorNotice message={error} />
      <div className="import-card-actions">
        <button
          type="button"
          className="import-card-action import-card-input"
          ref={viewInput}
          onClick={() => setShowInput(true)}
        >
          <FileText size={14} aria-hidden="true" /> View input
        </button>
        <div className="import-card-next-actions">
          {saved && (
            <>
              <Link
                className="import-card-action import-card-open"
                to="/recipes/$recipeId"
                params={{ recipeId: saved.recipeId }}
              >
                Open recipe <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <button
                type="button"
                className="import-card-action import-card-dismiss"
                aria-label="Dismiss"
                title="Dismiss request"
                onClick={() => onRemove(request.id)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </>
          )}
          {busy && (create.isError || status.isError) && !admissionRejected && (
            <button
              type="button"
              className="import-card-action import-card-open"
              disabled={create.isPending || status.isFetching}
              onClick={() =>
                create.isError ? create.mutate(request) : void status.refetch()
              }
            >
              <RefreshCw size={17} aria-hidden="true" /> Check again
            </button>
          )}
          {(result?.kind === "failed" || rejected) && (
            <button
              type="button"
              className="import-card-action import-card-open"
              disabled={discard.isPending || !canEdit}
              onClick={() => void editOrCancel(true)}
            >
              <Pencil size={17} aria-hidden="true" />{" "}
              {rejected ? "Edit and try again" : "Edit and retry"}
            </button>
          )}
          {(result?.kind === "failed" || create.isError) && !saved && (
            <button
              type="button"
              className={
                busy
                  ? "import-card-action"
                  : "import-card-action import-card-dismiss"
              }
              aria-label={busy ? "Cancel request" : "Dismiss"}
              title={busy ? "Cancel request" : "Dismiss request"}
              disabled={discard.isPending}
              onClick={() => void editOrCancel(false)}
            >
              <X size={17} aria-hidden="true" /> {busy && "Cancel request"}
            </button>
          )}
        </div>
      </div>
      {(result?.kind === "failed" || rejected) && !canEdit && (
        <p className="import-card-note">
          Clear your current input or finish manual entry to edit this request.
        </p>
      )}
      {result?.kind === "failed" && (
        <p className="import-card-note">
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
