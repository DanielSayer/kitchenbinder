import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import { useBlocker } from "@tanstack/react-router";
import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ErrorNotice } from "../feedback";

import {
  type RecipeDraft,
  readDraftBase,
  readDraftRevision,
  readRecipeDraft,
  readRecipeFields,
  recipeFields,
  writeRecipeDraft,
} from "./recipe-draft";
import { RecipeFields } from "./recipe-fields";
import {
  mergeRecipeDraft,
  parseRecipeDraft,
  recipeFieldNames,
} from "./recipe-merge";

type SavedRecipe = { content: RecipeContent; revision: number };
type Review = {
  saved: SavedRecipe;
  merged: RecipeDraft;
  conflicts: (keyof RecipeDraft)[];
  choices: Partial<Record<keyof RecipeDraft, "mine" | "saved">>;
};

export function RecipeEditor({
  content,
  draftKey,
  resetLabel = "Revert changes",
  pending,
  error,
  onSave,
  onCancel,
  saveLabel = "Save changes",
  savedRevision,
  loadLatest,
  onSaveCopy,
  onDraftChange,
  saveAction,
  recoveryAction,
}: {
  content: RecipeContent;
  draftKey: string;
  resetLabel?: string;
  pending: boolean;
  error?: string;
  onSave: (
    content: RecipeContent,
    expectedRevision: number | null,
    // biome-ignore lint/suspicious/noConfusingVoidType: Manual creation uses a synchronous mutation callback; edits await a revision check.
  ) => void | Promise<undefined | "conflict">;
  onCancel: () => void;
  saveLabel?: string;
  savedRevision?: number;
  loadLatest?: () => Promise<SavedRecipe>;
  onSaveCopy?: (content: RecipeContent) => Promise<void>;
  onDraftChange?: (draft: RecipeDraft) => void;
  saveAction?: ReactNode;
  recoveryAction?: ReactNode;
}) {
  const [initial] = useState(() => recipeFields(content));
  const [base, setBase] = useState<RecipeDraft | null>(initial);
  const [baseRevision, setBaseRevision] = useState<number | null>(
    savedRevision ?? null,
  );
  const [fields, setFields] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [validation, setValidation] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = JSON.stringify(fields) !== JSON.stringify(base ?? initial);

  useEffect(() => {
    const draft = readRecipeDraft(draftKey);
    if (draft) {
      setFields(draft);
      onDraftChange?.(draft);
      setBase(readDraftBase(draftKey));
      setBaseRevision(readDraftRevision(draftKey));
      setRevision((value) => value + 1);
    }
  }, [draftKey, onDraftChange]);

  const reviewScreen = review ? (preview ? "preview" : "choices") : "editing";
  useEffect(() => {
    if (reviewScreen !== "editing") heading.current?.focus();
  }, [reviewScreen]);

  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      storageFailed &&
      !window.confirm(
        "Your draft could not be saved in this browser. Leave and lose these changes?",
      ),
    enableBeforeUnload: false,
  });
  useEffect(() => {
    if (!dirty || !storageFailed) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, storageFailed]);

  function persist(
    next: RecipeDraft,
    nextBase = base,
    nextRevision = baseRevision,
  ) {
    setStorageFailed(!writeRecipeDraft(draftKey, next, nextRevision, nextBase));
  }

  function discard(close: boolean) {
    if (
      dirty &&
      !window.confirm("Discard your unsaved changes? This cannot be undone.")
    )
      return;
    if (!writeRecipeDraft(draftKey, null)) {
      setStorageFailed(true);
      setValidation("Couldn't clear the saved draft. Please try again.");
      return;
    }
    setFields(base ?? initial);
    onDraftChange?.(base ?? initial);
    setRevision((value) => value + 1);
    setValidation("");
    setStorageFailed(false);
    if (close) onCancel();
  }

  async function save(
    next: RecipeDraft,
    startingBase = base,
    startingRevision = baseRevision,
    copy = false,
  ) {
    if (saving.current || pending) return;
    const parsed = parseRecipeDraft(next);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setValidation(`${issue?.path.join(" ")}: ${issue?.message}`);
      return;
    }
    saving.current = true;
    setBusy(true);
    setValidation("");
    try {
      if (copy && onSaveCopy) {
        await onSaveCopy(parsed.data);
        return;
      }
      let draft = next;
      let original = startingBase;
      let expectedRevision = startingRevision;
      // Recheck after a racing save, but never loop indefinitely on a busy recipe.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (loadLatest) {
          const saved = await loadLatest();
          const savedFields = recipeFields(saved.content);
          const result = mergeRecipeDraft(original, draft, savedFields);
          if (result.conflicts.length) {
            setReview({ ...result, saved, choices: {} });
            setPreview(false);
            return;
          }
          draft = result.merged;
          original = savedFields;
          expectedRevision = saved.revision;
        }
        const result = parseRecipeDraft(draft);
        if (!result.success)
          throw new Error("Check the recipe fields before saving.");
        setFields(draft);
        onDraftChange?.(draft);
        setBase(original);
        setBaseRevision(expectedRevision);
        setRevision((value) => value + 1);
        persist(draft, original, expectedRevision);
        setReview(null);
        if ((await onSave(result.data, expectedRevision)) !== "conflict")
          return;
      }
      setValidation(
        "This recipe changed again. Your draft is safe. Try saving again.",
      );
    } catch (cause) {
      setValidation(
        cause instanceof Error
          ? cause.message
          : "Couldn't save. Your draft is still here. Please try again.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (review) {
      const next = { ...review.merged };
      const savedFields = recipeFields(review.saved.content);
      for (const name of review.conflicts) {
        if (!review.choices[name]) return;
        if (review.choices[name] === "saved") next[name] = savedFields[name];
      }
      void save(next, savedFields, review.saved.revision);
    } else void save(readRecipeFields(event.currentTarget));
  }

  return (
    <form
      className="recipe-editor"
      onSubmit={submit}
      onChange={(event) => {
        if (review) return;
        const next = readRecipeFields(event.currentTarget);
        setFields(next);
        onDraftChange?.(next);
        persist(next);
      }}
    >
      <fieldset disabled={pending || busy}>
        {review ? (
          <section
            className="recipe-review"
            aria-labelledby="recipe-review-title"
          >
            <h2 id="recipe-review-title" tabIndex={-1} ref={heading}>
              {preview ? "Saved recipe" : "Choose what to keep"}
            </h2>
            {preview ? (
              <>
                <p>Your draft is still here. Go back when you're ready.</p>
                <dl className="recipe-review-preview">
                  {recipeFieldNames.map(({ name, label }) => (
                    <div key={name}>
                      <dt>{label}</dt>
                      <dd>
                        {recipeFields(review.saved.content)[name] || "Empty"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setPreview(false)}
                >
                  Back to choices
                </button>
              </>
            ) : (
              <>
                <p>
                  This recipe changed while you were editing. Choose below where
                  both versions differ. Other changes are combined for you.
                </p>
                {recipeFieldNames
                  .filter((field) => review.conflicts.includes(field.name))
                  .map(({ name, label }) => (
                    <fieldset className="recipe-review-field" key={name}>
                      <legend>{label}</legend>
                      <div className="recipe-review-options">
                        {(["mine", "saved"] satisfies ("mine" | "saved")[]).map(
                          (choice) => (
                            <label
                              className="recipe-review-option"
                              key={choice}
                            >
                              <span>
                                <input
                                  type="radio"
                                  name={`choice-${name}`}
                                  value={choice}
                                  required
                                  checked={review.choices[name] === choice}
                                  onChange={() =>
                                    setReview({
                                      ...review,
                                      choices: {
                                        ...review.choices,
                                        [name]: choice,
                                      },
                                    })
                                  }
                                />
                                {choice === "mine" ? "Mine" : "Saved"}
                              </span>{" "}
                              <span className="recipe-review-value">
                                {(choice === "mine"
                                  ? review.merged[name]
                                  : recipeFields(review.saved.content)[name]) ||
                                  "Empty"}
                              </span>
                            </label>
                          ),
                        )}
                      </div>
                    </fieldset>
                  ))}
                <div className="editor-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => {
                      setReview(null);
                      setValidation("");
                    }}
                  >
                    Back to editing
                  </button>
                  <button type="submit" className="button button-primary">
                    {busy || pending ? "Saving..." : "Save recipe"}
                  </button>
                </div>
                <div className="recipe-review-alternatives">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setPreview(true)}
                  >
                    View saved recipe
                  </button>
                  {onSaveCopy && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        void save(fields, base, baseRevision, true)
                      }
                    >
                      Save my draft as a copy
                    </button>
                  )}
                </div>
                {onSaveCopy && (
                  <p className="recipe-review-hint">
                    Copies are saved to your personal collection.
                  </p>
                )}
              </>
            )}
          </section>
        ) : (
          <>
            <RecipeFields key={revision} content={fields} />
            <div className="editor-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={() => discard(true)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-outline"
                disabled={!dirty}
                onClick={() => discard(false)}
              >
                {resetLabel}
              </button>
              {saveAction ?? (
                <button type="submit" className="button button-primary">
                  {pending || busy ? "Saving..." : saveLabel}
                </button>
              )}
            </div>
          </>
        )}
        {(dirty || review) && (
          <p role="status">
            {storageFailed
              ? "Draft could not be saved in this browser. Keep this page open until you save your recipe."
              : "Draft saved in this tab. You can leave and come back."}
          </p>
        )}
        <ErrorNotice message={validation || error} />
        {recoveryAction}
      </fieldset>
    </form>
  );
}
