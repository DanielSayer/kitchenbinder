import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import { useBlocker } from "@tanstack/react-router";
import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { ErrorNotice } from "../feedback";
import { RecipeConflictReview } from "./recipe-conflict-review";
import {
  type RecipeDraft,
  readDraftBase,
  readDraftRevision,
  readRecipeDraft,
  readRecipeFields,
  recipeFields,
  writeRecipeDraft,
} from "./recipe-draft";
import {
  initialRecipeEditor,
  recipeEditorReducer,
  type SavedRecipe,
} from "./recipe-editor-state";
import { RecipeFields } from "./recipe-fields";
import { mergeRecipeDraft, parseRecipeDraft } from "./recipe-merge";

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
  const [state, dispatch] = useReducer(
    recipeEditorReducer,
    { content, savedRevision },
    initialRecipeEditor,
  );
  const {
    initial,
    base,
    baseRevision,
    fields,
    revision,
    screen,
    busy,
    validation,
    storageFailed,
  } = state;
  const review = screen.kind === "editing" ? null : screen.review;
  const saving = useRef(false);
  const dirty = JSON.stringify(fields) !== JSON.stringify(base ?? initial);

  useEffect(() => {
    const draft = readRecipeDraft(draftKey);
    if (draft) {
      dispatch({
        type: "restore",
        fields: draft,
        base: readDraftBase(draftKey),
        baseRevision: readDraftRevision(draftKey),
      });
      onDraftChange?.(draft);
    }
  }, [draftKey, onDraftChange]);

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
    dispatch({
      type: "storage",
      failed: !writeRecipeDraft(draftKey, next, nextRevision, nextBase),
    });
  }

  function discard(close: boolean) {
    if (
      dirty &&
      !window.confirm("Discard your unsaved changes? This cannot be undone.")
    )
      return;
    if (!writeRecipeDraft(draftKey, null)) {
      dispatch({ type: "storage", failed: true });
      dispatch({
        type: "validation",
        message: "Couldn't clear the saved draft. Please try again.",
      });
      return;
    }
    dispatch({ type: "discard" });
    onDraftChange?.(base ?? initial);
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
      dispatch({
        type: "validation",
        message: `${issue?.path.join(" ")}: ${issue?.message}`,
      });
      return;
    }
    saving.current = true;
    dispatch({ type: "saving" });
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
            dispatch({
              type: "review",
              review: { ...result, saved, choices: {} },
            });
            return;
          }
          draft = result.merged;
          original = savedFields;
          expectedRevision = saved.revision;
        }
        const result = parseRecipeDraft(draft);
        if (!result.success)
          throw new Error("Check the recipe fields before saving.");
        dispatch({
          type: "rebase",
          fields: draft,
          base: original,
          baseRevision: expectedRevision,
        });
        onDraftChange?.(draft);
        persist(draft, original, expectedRevision);
        if ((await onSave(result.data, expectedRevision)) !== "conflict")
          return;
      }
      dispatch({
        type: "validation",
        message:
          "This recipe changed again. Your draft is safe. Try saving again.",
      });
    } catch (cause) {
      dispatch({
        type: "validation",
        message:
          cause instanceof Error
            ? cause.message
            : "Couldn't save. Your draft is still here. Please try again.",
      });
    } finally {
      saving.current = false;
      dispatch({ type: "settled" });
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
        dispatch({ type: "change", fields: next });
        onDraftChange?.(next);
        persist(next);
      }}
    >
      <fieldset disabled={pending || busy}>
        {review ? (
          <RecipeConflictReview
            key={screen.kind}
            review={review}
            preview={screen.kind === "preview"}
            pending={pending || busy}
            onPreview={(show) => dispatch({ type: "preview", show })}
            onChoose={(field, choice) =>
              dispatch({ type: "choose", field, choice })
            }
            onEdit={() => dispatch({ type: "edit" })}
            onSaveCopy={
              onSaveCopy
                ? () => void save(fields, base, baseRevision, true)
                : undefined
            }
          />
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
