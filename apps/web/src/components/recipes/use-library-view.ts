import { useEffect, useState } from "react";
import type { RecipeView } from "./recipe-card";

const storageKey = "prep-sheet:recipes-view";

/** List or grid, remembered per device. Grid by default on wide screens. */
export function useLibraryView() {
  const [view, setView] = useState<RecipeView>("list");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "list" || saved === "grid") {
        setView(saved);
        return;
      }
    } catch {
      /* Storage disabled: fall back to the viewport default. */
    }
    if (window.matchMedia?.("(min-width: 851px)").matches) setView("grid");
  }, []);
  const choose = (next: RecipeView) => {
    setView(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* The choice still applies for this visit. */
    }
  };
  return [view, choose] as const;
}
