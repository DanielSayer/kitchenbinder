import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import { type RecipeDraft, recipeFields } from "./recipe-draft";

export type SavedRecipe = { content: RecipeContent; revision: number };
export type RecipeReview = {
  saved: SavedRecipe;
  merged: RecipeDraft;
  conflicts: (keyof RecipeDraft)[];
  choices: Partial<Record<keyof RecipeDraft, "mine" | "saved">>;
};

type ReviewScreen =
  | { kind: "editing" }
  | { kind: "choices" | "preview"; review: RecipeReview };

type EditorState = {
  initial: RecipeDraft;
  base: RecipeDraft | null;
  baseRevision: number | null;
  fields: RecipeDraft;
  revision: number;
  screen: ReviewScreen;
  busy: boolean;
  validation: string;
  storageFailed: boolean;
};

type Action =
  | {
      type: "restore" | "rebase";
      fields: RecipeDraft;
      base: RecipeDraft | null;
      baseRevision: number | null;
    }
  | { type: "change"; fields: RecipeDraft }
  | { type: "discard" }
  | { type: "saving" }
  | { type: "settled" }
  | { type: "validation"; message: string }
  | { type: "storage"; failed: boolean }
  | { type: "review"; review: RecipeReview }
  | { type: "choose"; field: keyof RecipeDraft; choice: "mine" | "saved" }
  | { type: "preview"; show: boolean }
  | { type: "edit" };

export function initialRecipeEditor({
  content,
  savedRevision,
}: {
  content: RecipeContent;
  savedRevision?: number;
}): EditorState {
  const initial = recipeFields(content);
  return {
    initial,
    base: initial,
    baseRevision: savedRevision ?? null,
    fields: initial,
    revision: 0,
    screen: { kind: "editing" },
    busy: false,
    validation: "",
    storageFailed: false,
  };
}

export function recipeEditorReducer(
  state: EditorState,
  action: Action,
): EditorState {
  switch (action.type) {
    case "restore":
    case "rebase":
      return {
        ...state,
        fields: action.fields,
        base: action.base,
        baseRevision: action.baseRevision,
        revision: state.revision + 1,
        screen: action.type === "rebase" ? { kind: "editing" } : state.screen,
      };
    case "change":
      return { ...state, fields: action.fields };
    case "discard":
      return {
        ...state,
        fields: state.base ?? state.initial,
        revision: state.revision + 1,
        validation: "",
        storageFailed: false,
      };
    case "saving":
      return { ...state, busy: true, validation: "" };
    case "settled":
      return { ...state, busy: false };
    case "validation":
      return { ...state, validation: action.message };
    case "storage":
      return { ...state, storageFailed: action.failed };
    case "review":
      return { ...state, screen: { kind: "choices", review: action.review } };
    case "choose":
      if (state.screen.kind === "editing") return state;
      return {
        ...state,
        screen: {
          ...state.screen,
          review: {
            ...state.screen.review,
            choices: {
              ...state.screen.review.choices,
              [action.field]: action.choice,
            },
          },
        },
      };
    case "preview":
      if (state.screen.kind === "editing") return state;
      return {
        ...state,
        screen: { ...state.screen, kind: action.show ? "preview" : "choices" },
      };
    case "edit":
      return { ...state, screen: { kind: "editing" }, validation: "" };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
