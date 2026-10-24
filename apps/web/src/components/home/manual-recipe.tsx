import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { undoToast } from "@/components/pantry";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import {
  type RecipeDraft,
  readRecipeDraft,
  recipeDraftKey,
  recipeFields,
  writeRecipeDraft,
} from "../recipes/recipe-draft";
import { RecipeEditor } from "../recipes/recipe-editor";
import { parseRecipeDraft } from "../recipes/recipe-merge";
import {
  type Destination,
  sameDestination,
  useDefaultDestination,
  useSavedMessage,
} from "./destination";
import {
  type ManualSubmission,
  readManualSubmission,
  submissionDestination,
  writeManualSubmission,
} from "./manual-submission";
import { ReadySheet } from "./ready-sheet";

type SubmissionState =
  | { kind: "ready" }
  | { kind: "pending"; request: ManualSubmission }
  | { kind: "blocked" };

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

export function ManualRecipe({
  onCancel,
  onReopen,
}: {
  onCancel: () => void;
  /** Undo of a discarded draft: show the editor again. */
  onReopen?: () => void;
}) {
  const { data: session } = authClient.useSession();
  const draftKey = recipeDraftKey(session?.user.id ?? "guest");
  const defaultDestination = useDefaultDestination();
  const savedMessage = useSavedMessage();
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
  const [ready, setReady] = useState<RecipeContent | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  // Untouched = the pending save's destination, else the default.
  const [chosen, setChosen] = useState<Destination | null>(null);
  const destination =
    chosen ??
    (submission.kind === "pending"
      ? submissionDestination(submission.request)
      : defaultDestination);
  const destinationRef = useRef(destination);
  destinationRef.current = destination;
  const [recoveredId, setRecoveredId] = useState<string | null>(null);
  const latestDraft = useRef<RecipeDraft | null>(null);
  const onDraftChange = useCallback((draft: RecipeDraft) => {
    latestDraft.current = draft;
  }, []);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const share = useMutation(trpc.recipes.share.mutationOptions());
  const save = useMutation(
    trpc.recipes.createManual.mutationOptions({
      onError: () => setReadyOpen(false),
      onSuccess: async (recipe, input) => {
        setReadyOpen(false);
        const draft = latestDraft.current;
        const current = draft && parseRecipeDraft(draft);
        const placed = submissionDestination(input as ManualSubmission);
        if (
          !sameDestination(destinationRef.current, placed) ||
          !current?.success ||
          JSON.stringify(current.data) !== JSON.stringify(input.content)
        ) {
          setRecoveredId(recipe.id);
          setNotice(
            "Your earlier recipe was saved with its original sharing. Your newer draft is still here. Review it in that recipe before applying changes.",
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
        // The save shares with the first household; add the rest after.
        const extra = placed.householdIds.filter(
          (id) => id !== (input.householdId ?? null),
        );
        const shared = await Promise.allSettled(
          extra.map((householdId) =>
            share.mutateAsync({ id: recipe.id, householdId }),
          ),
        );
        if (shared.some((item) => item.status === "rejected"))
          toast.error(
            "Saved, but couldn't share with every household. Share it from the recipe.",
          );
        else toast.success(savedMessage(placed));
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
    if (save.isPending) return;
    const fail = (message: string) => {
      setReadyOpen(false);
      setNotice(message);
    };
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }
    let state = submission;
    if (state.kind === "blocked") {
      try {
        const request = readManualSubmission(submissionKey);
        state = request ? { kind: "pending", request } : { kind: "ready" };
        setSubmission(state);
      } catch {
        setReadyOpen(false);
        return;
      }
    }
    if (
      state.kind === "pending" &&
      (!sameDestination(destination, submissionDestination(state.request)) ||
        JSON.stringify(content) !== JSON.stringify(state.request.content))
    ) {
      fail(
        "An earlier save may have completed. Recover it before saving these changes. Your draft is still here.",
      );
      return;
    }
    const request: ManualSubmission =
      state.kind === "pending"
        ? state.request
        : {
            id: crypto.randomUUID(),
            householdId: destination.householdIds[0] ?? null,
            collectionId: destination.collectionId,
            householdIds: destination.householdIds,
            content,
          };
    try {
      writeManualSubmission(submissionKey, request);
    } catch {
      fail(
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

  // Undo, not "are you sure?": drop the draft now, offer it back.
  function discard() {
    const draft = latestDraft.current;
    setReadyOpen(false);
    if (!writeRecipeDraft(draftKey, null)) return;
    onCancel();
    undoToast("Draft discarded", {
      onUndo: () => {
        if (draft) writeRecipeDraft(draftKey, draft);
        onReopen?.();
      },
    });
  }

  return (
    <>
      <RecipeEditor
        key={draftKey}
        draftKey={draftKey}
        resetLabel="Clear form"
        content={emptyRecipe}
        pending={save.isPending}
        error={
          submission.kind === "blocked"
            ? "The earlier save ID could not be read. Keep this draft open and restore browser storage before saving."
            : notice || save.error?.message
        }
        saveLabel="Continue"
        onSave={(content) => {
          setNotice("");
          setReady(content);
          setReadyOpen(true);
        }}
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
      <ReadySheet
        open={readyOpen}
        onOpenChange={setReadyOpen}
        recipe={ready ? { content: ready } : null}
        destination={destination}
        onDestinationChange={setChosen}
        onSave={() => {
          if (ready) submit(ready);
        }}
        saving={save.isPending}
        secondary={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setReadyOpen(false)}
            >
              Back to editing
            </button>
            <button
              type="button"
              className="button button-ghost ready-discard"
              disabled={save.isPending || submission.kind !== "ready"}
              onClick={discard}
            >
              Discard
            </button>
          </>
        }
      />
    </>
  );
}
