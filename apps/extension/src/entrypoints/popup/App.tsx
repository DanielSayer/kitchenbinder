import {
  type Connection,
  connectionSchema,
} from "@prep-sheet/auth/extension-contract";
import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { z } from "zod";
import { prepSheetOrigin } from "../../lib/config";
import { Capture } from "./Capture";

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), state: connectionSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export function App() {
  const [connection, setConnection] = useState<Connection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = useCallback(
    async (kind: "status" | "connect" | "disconnect") => {
      setBusy(true);
      setError("");
      try {
        const response = responseSchema.parse(
          await browser.runtime.sendMessage({ kind }),
        );
        if (!response.ok) throw new Error(response.error);
        setConnection(response.state);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't connect. Please try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    void send("status");
  }, [send]);
  useEffect(() => {
    if (connection?.kind !== "connecting") return;
    const timer = setTimeout(() => void send("status"), 1500);
    return () => clearTimeout(timer);
  }, [connection, send]);
  return (
    <main>
      <p className="brand">
        <img
          src="/branding/icon-192.png"
          alt=""
          className="brand-icon"
          width={40}
          height={40}
        />
        <span className="brand-wordmark">kitchenbinder</span>
      </p>
      {connection?.kind === "connected" ? (
        <>
          <Capture
            key={connection.account.id}
            accountId={connection.account.id}
            onReconnect={() => void send("connect")}
          />
          <footer>
            <p className="account">{connection.account.email}</p>
            <a
              className="secondary"
              href={prepSheetOrigin}
              target="_blank"
              rel="noreferrer"
            >
              Kitchenbinder <span aria-hidden="true">↗</span>
            </a>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void send("disconnect")}
              type="button"
            >
              Disconnect
            </button>
          </footer>
        </>
      ) : connection?.kind === "connecting" ? (
        <p role="status">
          Finish connecting in the Kitchenbinder window. You can close this
          popup and reopen it afterwards.
        </p>
      ) : !connection && !error ? (
        <p role="status">Checking your account...</p>
      ) : (
        <>
          <h1>Save recipes from your browser</h1>
          <p>
            Connect your Kitchenbinder account to save a recipe to your
            collection.
          </p>
          {connection?.kind === "disconnected" && connection.message && (
            <p role="status">{connection.message}</p>
          )}
          <button
            disabled={busy || !connection}
            onClick={() => void send("connect")}
            type="button"
          >
            {busy ? "Checking connection..." : "Connect to Kitchenbinder"}
          </button>
        </>
      )}
      {connection?.kind === "disconnected" && <Capture />}
      {error && (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => void send("status")}
          >
            Try again
          </button>
        </>
      )}
    </main>
  );
}
