import type {
  MealBaseline,
  MealConflict,
  MealDraft,
  StoredMealDraft,
} from "./meal-draft";

export type MealReview = {
  base: MealBaseline;
  saved: MealDraft | null;
  savedRecipeTitle: string | null;
  merged: MealDraft;
  conflicts: MealConflict[];
  choices: Partial<Record<MealConflict, "mine" | "saved">>;
};

type EditorState = {
  stored: StoredMealDraft;
  review: MealReview | null;
  query: string;
  detailsOpen: boolean;
  busy: boolean;
  error: string;
};

type Action =
  | { type: "change"; values: Partial<MealDraft> }
  | { type: "search" | "note"; text: string }
  | { type: "servings"; servings: string; editing: boolean }
  | { type: "details"; open: boolean }
  | { type: "saving" }
  | { type: "settled" }
  | { type: "error"; message: string; showDetails?: boolean }
  | { type: "review"; review: MealReview | null }
  | { type: "choose"; field: MealConflict; choice: "mine" | "saved" }
  | { type: "rebase"; fields: MealDraft; base: MealBaseline };

export function initialMealEditor(
  stored: StoredMealDraft,
  detailsOpen: boolean,
): EditorState {
  return {
    stored,
    review: null,
    query: stored.fields.kind === "out" ? stored.fields.description : "",
    detailsOpen,
    busy: false,
    error: "",
  };
}

function withFields(
  state: EditorState,
  values: Partial<MealDraft>,
): EditorState {
  return {
    ...state,
    stored: { ...state.stored, fields: { ...state.stored.fields, ...values } },
  };
}

export function mealEditorReducer(
  state: EditorState,
  action: Action,
): EditorState {
  switch (action.type) {
    case "change":
      return withFields(state, action.values);
    case "search": {
      const draft = state.stored.fields;
      const next = { ...state, query: action.text };
      return draft.kind === "out" ||
        (draft.kind === "recipe" && !draft.recipeId)
        ? withFields(next, { kind: "out", description: action.text.trim() })
        : next;
    }
    case "note":
      return withFields(
        { ...state, query: action.text },
        { kind: "out", description: action.text },
      );
    case "servings":
      if (state.stored.fields.baseServings) return state;
      return withFields(
        state,
        action.editing
          ? { baseServings: action.servings }
          : {
              baseServings: action.servings,
              cook: action.servings,
              eat: action.servings,
            },
      );
    case "details":
      return { ...state, detailsOpen: action.open };
    case "saving":
      return { ...state, busy: true, error: "" };
    case "settled":
      return { ...state, busy: false };
    case "error":
      return {
        ...state,
        error: action.message,
        detailsOpen: action.showDetails || state.detailsOpen,
      };
    case "review":
      return { ...state, review: action.review };
    case "choose":
      return state.review
        ? {
            ...state,
            review: {
              ...state.review,
              choices: {
                ...state.review.choices,
                [action.field]: action.choice,
              },
            },
          }
        : state;
    case "rebase":
      return {
        ...state,
        stored: { ...state.stored, fields: action.fields, base: action.base },
        review: null,
      };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
