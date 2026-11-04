// @vitest-environment jsdom

import type { Meal } from "@prep-sheet/db/meal-planner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { readMealDraft } from "./meal-draft";
import { useMealDraft } from "./use-meal-draft";

vi.mock("@/utils/trpc", () => ({
  useTRPC: () => ({
    planner: {
      get: {
        queryOptions: () => ({
          queryKey: ["planner"],
          queryFn: async () => ({ revision: 7, meals: [] }),
          staleTime: Number.POSITIVE_INFINITY,
        }),
      },
      save: {
        mutationOptions: (options: object) => ({
          mutationFn: async () => {},
          ...options,
        }),
      },
    },
  }),
}));

const key = "meal-draft:selection-test";
const otherRecipe = crypto.randomUUID();
const meal: Meal = {
  id: crypto.randomUUID(),
  kind: "recipe",
  date: "2026-11-04",
  slot: "Dinner",
  recipeId: crypto.randomUUID(),
  title: "Pasta",
  ingredients: [],
  baseServings: 4,
  cook: 6,
  eat: 2,
};
const clients: QueryClient[] = [];

function mount(options: { meal?: Meal; duplicate?: boolean } = {}) {
  const client = new QueryClient();
  client.setQueryData(["planner"], {
    revision: 7,
    meals: options.meal ? [options.meal] : [],
  });
  clients.push(client);
  return renderHook(
    () =>
      useMealDraft({
        date: "2026-11-04",
        meal: options.meal,
        duplicate: options.duplicate ?? false,
        storageKey: key,
        onClose: () => {},
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    },
  );
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  sessionStorage.clear();
});

it("keeps custom portions for an existing meal while rebasing servings for a different recipe", () => {
  const { result } = mount({ meal });
  act(() => result.current.selectRecipe(meal.recipeId));
  act(() => result.current.initialiseServings("Serves 10"));
  expect(result.current.draft).toMatchObject({
    baseServings: "4",
    cook: "6",
    eat: "2",
  });
  act(() => result.current.selectRecipe(otherRecipe));
  expect(result.current.draft.baseServings).toBe("");
  act(() => result.current.initialiseServings("8 people"));
  expect(readMealDraft(key)).toMatchObject({
    fields: {
      recipeId: otherRecipe,
      baseServings: "8",
      cook: "6",
      eat: "2",
    },
    base: { kind: "known", revision: 7, meal: { recipeId: meal.recipeId } },
  });
});

it.each(["new", "duplicate"])(
  "defaults portions to the selected recipe for a %s meal and keeps subsequent edits",
  (mode) => {
    const { result } = mount(
      mode === "duplicate" ? { meal, duplicate: true } : {},
    );
    act(() => result.current.selectRecipe(otherRecipe));
    act(() => result.current.initialiseServings("Serves 8"));
    expect(result.current.draft).toMatchObject({
      baseServings: "8",
      cook: "8",
      eat: "8",
    });
    act(() => result.current.set({ cook: "10", eat: "3" }));
    act(() => result.current.selectRecipe(otherRecipe));
    act(() => result.current.initialiseServings("12"));
    expect(readMealDraft(key)?.fields).toMatchObject({
      baseServings: "8",
      cook: "10",
      eat: "3",
    });
    expect(result.current.draft.id).not.toBe(meal.id);
  },
);

it("opens details for ambiguous recipe servings without changing portions", () => {
  const { result } = mount();
  act(() => result.current.selectRecipe(otherRecipe));
  act(() => result.current.initialiseServings("4–6 servings"));
  expect(result.current.detailsOpen).toBe(true);
  expect(result.current.draft).toMatchObject({
    baseServings: "",
    cook: "2",
    eat: "2",
  });
});
