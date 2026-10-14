import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { CollectionSelect, useCollection } from "../groups/collection-context";
import {
  type RecipeDraft,
  readRecipeDraft,
  recipeDraftKey,
  recipeFields,
  writeRecipeDraft,
} from "../recipes/recipe-draft";
import { parseRecipeDraft } from "../recipes/recipe-merge";
import {
  type ManualSubmission,
  readManualSubmission,
  writeManualSubmission,
} from "./manual-submission";

type SubmissionState =
  | { kind: "ready" }
  | { kind: "pending"; request: ManualSubmission }
  | { kind: "blocked" };

import { RecipeEditor } from "../recipes/recipe-editor";

const emptyRecipe: RecipeContent = {
  title: "",
  description: "",
  servings: null,
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: null,
  ingredients: [],
  steps: [],
  notes: "",
};

export function ManualRecipe({ onCancel }: { onCancel: () => void }) {
  const { data: session } = authClient.useSession();
  const draftKey = recipeDraftKey(session?.user.id ?? "guest");
  const { groupId, available } = useCollection();
  const submissionKey = `${draftKey}:submission`;
  const [submission, setSubmission] = useState<SubmissionState>(() => {
    try {
      const request = readManualSubmission(submissionKey);
      return request ? { kind: "pending", request } : { kind: "ready" };
    } catch {
      return { kind: "blocked" };
    }
  });
  const [notice, setNotice] = useState("");
  const [recoveredId, setRecoveredId] = useState<string | null>(null);
  const latestDraft = useRef<RecipeDraft | null>(null);
  const onDraftChange = useCallback((draft: RecipeDraft) => {
    latestDraft.current = draft;
  }, []);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const save = useMutation(
    trpc.recipes.createManual.mutationOptions({
      onSuccess: (recipe, input) => {
        const draft = latestDraft.current;
        const current = draft && parseRecipeDraft(draft);
        if (
          !current?.success ||
          JSON.stringify(current.data) !== JSON.stringify(input.content)
        ) {
          setRecoveredId(recipe.id);
          setNotice(
            "Your earlier recipe was saved. Your newer draft is still here. Review it in the saved recipe before applying changes.",
          );
          return;
        }
        if (!writeRecipeDraft(draftKey, null)) {
          setNotice(
            "The recipe was saved, but this browser could not clear the draft. Recover the earlier save to try again.",
          );
          return;
        }
        try {
          sessionStorage.removeItem(submissionKey);
        } catch {
          setNotice(
            "The recipe was saved. Browser storage is unavailable; keep this page open and try recovery again.",
          );
          return;
        }
        setSubmission({ kind: "ready" });
        void queryClient.invalidateQueries({
          queryKey: trpc.recipes.list.queryKey(),
        });
        void navigate({
          to: "/recipes/$recipeId",
          params: { recipeId: recipe.id },
        });
      },
    }),
  );

  function submit(content: RecipeContent) {
    if (save.isPending || !available) return;
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }
    if (submission.kind === "blocked") return;
    const input = { groupId, content };
    if (
      submission.kind === "pending" &&
      JSON.stringify(input) !==
        JSON.stringify({
          groupId: submission.request.groupId,
          content: submission.request.content,
        })
    ) {
      setNotice(
        "An earlier save may have completed. Recover it before saving these changes. Your draft is still here.",
      );
      return;
    }
    const request =
      submission.kind === "pending"
        ? submission.request
        : { id: crypto.randomUUID(), ...input };
    try {
      writeManualSubmission(submissionKey, request);
    } catch {
      setNotice(
        "This browser could not retain the save ID. Keep this page open and enable browser storage before saving.",
      );
      return;
    }
    setNotice("");
    setSubmission({ kind: "pending", request });
    save.mutate(request);
  }

  function reviewRecovered() {
    if (submission.kind !== "pending" || !recoveredId || !session) return;
    const draft = latestDraft.current;
    const target = recipeDraftKey(session.user.id, recoveredId);
    if (!draft || readRecipeDraft(target)) {
      setNotice(
        "A draft already exists in the saved recipe, or this draft is unavailable. Keep this page open to preserve your changes.",
      );
      return;
    }
    if (
      !writeRecipeDraft(
        target,
        draft,
        1,
        recipeFields(submission.request.content),
      )
    ) {
      setNotice(
        "Couldn't transfer the draft. Your changes are still here. Keep this page open and try again.",
      );
      return;
    }
    // Keep the source until the destination draft is safely stored.
    if (!writeRecipeDraft(draftKey, null)) return;
    try {
      sessionStorage.removeItem(submissionKey);
    } catch {
      // Retain the original identity if storage becomes unavailable.
    }
    void navigate({
      to: "/recipes/$recipeId",
      params: { recipeId: recoveredId },
    });
  }

  return (
    <>
      {session && (
        <CollectionSelect label="Save to" disabled={save.isPending} />
      )}
      <RecipeEditor
        key={draftKey}
        draftKey={draftKey}
        resetLabel="Clear form"
        content={emptyRecipe}
        pending={save.isPending}
        error={
          !available
            ? "Choose an available collection to save your recipe."
            : submission.kind === "blocked"
              ? "The earlier save ID could not be read. Keep this draft open and restore browser storage before saving."
              : notice || save.error?.message
        }
        saveLabel="Save recipe"
        onSave={submit}
        onDraftChange={onDraftChange}
        onCancel={onCancel}
        saveAction={
          recoveredId ? (
            <button
              type="button"
              className="button button-primary"
              onClick={reviewRecovered}
            >
              Review draft in saved recipe
            </button>
          ) : undefined
        }
        recoveryAction={
          submission.kind === "pending" && !recoveredId ? (
            <div className="editor-actions">
              <button
                type="button"
                className="button button-outline"
                disabled={save.isPending}
                onClick={() => save.mutate(submission.request)}
              >
                Recover earlier save
              </button>
            </div>
          ) : undefined
        }
      />
    </>
  );
}
