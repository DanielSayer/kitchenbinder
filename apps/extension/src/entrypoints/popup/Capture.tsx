import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { z } from "zod";
import {
  type CaptureResult,
  captureErrors,
  captureResultSchema,
} from "../../lib/capture-contract";
import { Import } from "./Import";

type State = { kind: "idle" } | { kind: "loading" } | CaptureResult;

export function Capture({
  accountId,
  onReconnect = () => {},
}: {
  accountId?: string;
  onReconnect?: () => void;
}) {
  const connected = !!accountId;
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(connected);
  const [captureError, setCaptureError] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    void browser.runtime
      .sendMessage({ kind: "recover-capture" })
      .then((value: unknown) => {
        const stored = z
          .object({
            capture: captureResultSchema.nullable(),
            selection: z
              .object({
                sourceUrl: z.string(),
                selected: z.number().int().min(0).max(9),
              })
              .nullable(),
          })
          .parse(value);
        if (stored.capture) {
          setState(stored.capture);
          if (
            stored.capture.kind === "captured" &&
            stored.selection?.sourceUrl === stored.capture.sourceUrl &&
            stored.capture.recipes[stored.selection.selected]
          )
            setSelected(stored.selection.selected);
        }
      })
      .catch(() => {});
  }, []);
  async function capture() {
    const previous = state;
    setCaptureError("");
    setState({ kind: "loading" });
    try {
      const result = captureResultSchema.parse(
        await browser.runtime.sendMessage({ kind: "capture" }),
      );
      if (result.kind === "error" && previous.kind === "captured") {
        setState(previous);
        setCaptureError(captureErrors[result.code]);
      } else {
        setState(result);
        setSelected(0);
      }
    } catch {
      setState(previous);
      setCaptureError(captureErrors.unavailable);
    }
  }
  const recipe =
    state.kind === "captured" ? state.recipes[selected] : undefined;
  return (
    <section className="capture" aria-label="Capture recipe">
      {!locked && (
        <button
          className={
            state.kind === "captured" || !connected ? "secondary" : undefined
          }
          type="button"
          disabled={busy || state.kind === "loading"}
          onClick={() => void capture()}
        >
          {state.kind === "loading"
            ? "Reading recipe..."
            : state.kind === "idle"
              ? "Capture recipe"
              : "Capture again"}
        </button>
      )}
      {captureError && (
        <p className="error" role="alert">
          {captureError}
        </p>
      )}
      {state.kind === "loading" && (
        <p role="status">Reading the page you have open.</p>
      )}
      {state.kind === "error" && (
        <p className="error" role="alert">
          {captureErrors[state.code]}
        </p>
      )}
      {state.kind === "captured" && !locked && (
        <>
          {state.recipes.length > 1 && (
            <fieldset disabled={busy}>
              <legend>Choose a recipe</legend>
              {state.recipes.map((item, index) => (
                <label className="recipe-choice" key={`${index}-${item.title}`}>
                  <input
                    type="radio"
                    name="recipe"
                    checked={selected === index}
                    onChange={() => {
                      setSelected(index);
                      void browser.runtime
                        .sendMessage({
                          kind: "select-recipe",
                          sourceUrl: state.sourceUrl,
                          selected: index,
                        })
                        .catch(() =>
                          setCaptureError(
                            "Couldn't remember this selection. Try again.",
                          ),
                        );
                    }}
                  />
                  <span>{item.title}</span>
                </label>
              ))}
            </fieldset>
          )}
          {recipe && (
            <div className="capture-preview">
              <h2>{recipe.title}</h2>
              <a
                className="source"
                href={state.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {new URL(state.sourceUrl).hostname}{" "}
                <span aria-hidden="true">↗</span>
              </a>
              <details>
                <summary>Preview captured recipe</summary>
                <pre>{recipe.content}</pre>
              </details>
            </div>
          )}
        </>
      )}
      {accountId && (
        <Import
          accountId={accountId}
          onReconnect={onReconnect}
          onLocked={setLocked}
          onBusy={setBusy}
          title={recipe?.title}
          content={recipe?.content}
          images={recipe?.images}
          sourceUrl={state.kind === "captured" ? state.sourceUrl : undefined}
        />
      )}
    </section>
  );
}
