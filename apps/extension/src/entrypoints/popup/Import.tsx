import {
  type ImportStatus,
  importStatusSchema,
} from "@prep-sheet/api/import-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import type { z } from "zod";
import { prepSheetOrigin } from "../../lib/config";
import {
  destinationSchema,
  PopupError,
  pendingSchema,
  responseSchema,
} from "../../lib/popup-contract";

type Destinations = z.infer<typeof destinationSchema>;
type Pending = z.infer<typeof pendingSchema>;

export function Import({
  content,
  sourceUrl,
  title,
  accountId,
  onReconnect,
  onLocked,
  onBusy,
}: {
  content?: string;
  sourceUrl?: string;
  title?: string;
  accountId: string;
  onBusy: (busy: boolean) => void;
  onReconnect: () => void;
  onLocked: (locked: boolean) => void;
}) {
  const [destinations, setDestinations] = useState<Destinations>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const inFlight = useRef(false);
  const send = useCallback(
    async (command: object) => {
      const response = responseSchema.parse(
        await browser.runtime.sendMessage({ ...command, accountId }),
      );
      if (!response.ok)
        throw new PopupError(response.error, response.reconnect);
      return response.data;
    },
    [accountId],
  );
  const fail = useCallback((cause: unknown) => {
    setError(
      cause instanceof Error
        ? cause.message
        : "Couldn't reach Kitchenbinder. Try again.",
    );
    setReconnect(cause instanceof PopupError && cause.reconnect);
  }, []);
  const recover = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const request = pendingSchema
        .nullable()
        .parse(await send({ kind: "pending-import" }));
      setPending(request);
      setStatus(
        importStatusSchema
          .nullable()
          .parse(await send({ kind: "recover-import" })),
      );
      if (!request)
        setDestinations(
          destinationSchema.parse(await send({ kind: "destinations" })),
        );
      setLoaded(true);
    } catch (cause) {
      fail(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [send, fail]);
  useEffect(() => {
    void recover();
  }, [recover]);
  useEffect(() => {
    onLocked(!loaded || pending !== null);
    onBusy(busy);
  }, [loaded, busy, pending, onLocked, onBusy]);
  useEffect(() => {
    if (
      busy ||
      error ||
      (status?.kind !== "queued" && status?.kind !== "processing")
    )
      return;
    const timer = setTimeout(() => void recover(), 3000);
    return () => clearTimeout(timer);
  }, [status, busy, error, recover]);
  async function choose(groupId: string | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setDestinations(
        destinationSchema.parse(
          await send({ kind: "select-collection", groupId }),
        ),
      );
    } catch (cause) {
      setDestinations(undefined);
      fail(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (inFlight.current || !destinations) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setStatus(
        importStatusSchema.parse(
          await send({
            kind: "save-import",
            title,
            input: { content, sourceUrl, groupId: destinations.groupId },
          }),
        ),
      );
    } catch (cause) {
      fail(cause);
    } finally {
      try {
        setPending(
          pendingSchema
            .nullable()
            .parse(await send({ kind: "pending-import" })),
        );
      } catch (cause) {
        fail(cause);
      }
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function reset() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await send({ kind: "reset-import" });
      setPending(null);
      setStatus(null);
      setLoaded(false);
      setDestinations(undefined);
      setDestinations(
        destinationSchema.parse(await send({ kind: "destinations" })),
      );
      setLoaded(true);
    } catch (cause) {
      fail(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const active = status?.kind === "queued" || status?.kind === "processing";
  return (
    <section className="import" aria-label="Save recipe" aria-busy={busy}>
      {pending && (
        <div className="pending-summary">
          <p className="eyebrow">
            {status?.kind === "saved" ? "Recipe saved" : "Current import"}
          </p>
          <h2>
            {pending.title ||
              pending.content.split("\n")[0]?.slice(0, 300) ||
              "Captured recipe"}
          </h2>
          <p className="muted">
            {pending.collectionName ||
              (pending.groupId ? "Selected group" : "My recipes")}
          </p>
        </div>
      )}
      {!loaded && !error && <p role="status">Loading your recipes...</p>}
      {content && loaded && !pending && destinations && (
        <>
          <fieldset disabled={!!error} aria-busy={busy}>
            <legend>Save to</legend>
            {destinations.collections.map((collection) => (
              <label
                className="recipe-choice"
                key={collection.id ?? "personal"}
              >
                <input
                  type="radio"
                  name="collection"
                  checked={destinations.groupId === collection.id}
                  onChange={() => void choose(collection.id)}
                />
                <span>{collection.name}</span>
              </label>
            ))}
          </fieldset>
          {destinations.changed && (
            <p className="capture-note" role="status">
              Your previous collection is no longer available. Choose where to
              save this recipe.
            </p>
          )}
          {content.trim().length < 80 && (
            <p className="error" role="alert">
              This capture does not contain enough recipe text. Open the full
              ingredients and instructions, then capture again.
            </p>
          )}
          <button
            type="button"
            disabled={
              busy ||
              !!error ||
              content.trim().length < 80 ||
              !destinations.collections.some(
                (item) => item.id === destinations.groupId,
              )
            }
            onClick={() => void save()}
          >
            {busy ? "Saving..." : "Save recipe"}
          </button>
        </>
      )}
      {active && (
        <p className="progress" role="status">
          {status.kind === "queued"
            ? "Waiting to process your recipe."
            : "Processing your recipe."}{" "}
          You can close this popup and return later.
        </p>
      )}
      {status?.kind === "saved" && (
        <a
          className="saved"
          href={`${prepSheetOrigin}/recipes/${status.recipeId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open recipe <span aria-hidden="true">↗</span>
        </a>
      )}
      {status?.kind === "failed" && (
        <p className="error" role="alert">
          {status.message} Start another import to choose a collection and try
          again.
        </p>
      )}
      {error && (
        <div className="recovery">
          <p className="error" role="alert">
            {error}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={reconnect ? onReconnect : () => void recover()}
          >
            {reconnect
              ? "Reconnect account"
              : pending
                ? "Check import again"
                : "Reload collections"}
          </button>
        </div>
      )}
      {(status?.kind === "failed" ||
        status?.kind === "saved" ||
        (error && pending && !active && !reconnect)) && (
        <button
          className={
            status?.kind === "failed" && !error ? undefined : "secondary"
          }
          type="button"
          disabled={busy}
          onClick={() => void reset()}
        >
          Start another import
        </button>
      )}
    </section>
  );
}
