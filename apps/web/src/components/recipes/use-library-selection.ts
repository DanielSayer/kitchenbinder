import { useReducer } from "react";
import type { CollectionSummary } from "@/components/collections/use-collections";

type Selection = {
  key: string;
  active: boolean;
  ids: string[];
  target: CollectionSummary | null;
};
type Action =
  | { type: "scope"; key: string }
  | { type: "start" }
  | { type: "end" }
  | { type: "toggle"; id: string }
  | { type: "pick"; target: CollectionSummary };

function selectionReducer(state: Selection, action: Action): Selection {
  switch (action.type) {
    case "scope": {
      const picking = !!state.target && action.key === "all";
      return {
        key: action.key,
        active: picking,
        ids: [],
        target: picking ? state.target : null,
      };
    }
    case "start":
      return { ...state, active: true };
    case "end":
      return { ...state, active: false, ids: [], target: null };
    case "toggle":
      return {
        ...state,
        ids: state.ids.includes(action.id)
          ? state.ids.filter((id) => id !== action.id)
          : [...state.ids, action.id],
      };
    case "pick":
      return { ...state, target: action.target };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function useLibrarySelection(key: string) {
  const [selection, dispatch] = useReducer(selectionReducer, {
    key,
    active: false,
    ids: [],
    target: null,
  });
  // Resolve a changed collection before rendering its recipe cards.
  if (selection.key !== key) dispatch({ type: "scope", key });
  return {
    selectedIds: selection.ids,
    bulkMode: selection.active,
    pickTarget: selection.target,
    startSelection: () => dispatch({ type: "start" }),
    endSelection: () => dispatch({ type: "end" }),
    toggleSelected: (id: string) => dispatch({ type: "toggle", id }),
    chooseForCollection: (target: CollectionSummary) =>
      dispatch({ type: "pick", target }),
  };
}
