// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AddToCollectionSheet } from "./add-to-collection-sheet";
import { HouseholdShareList } from "./household-share-list";

const server = vi.hoisted(() => ({
  add: vi.fn(async (_input: { collectionId: string; recipeIds: string[] }) => ({
    added: 1,
  })),
  remove: vi.fn(
    async (_input: { collectionId: string; recipeIds: string[] }) => ({
      removed: 1,
    }),
  ),
}));
const query = (key: string, data: unknown) => ({
  queryOptions: () => ({ queryKey: [key], queryFn: async () => data }),
});
const mutation = (fn: (input: never) => Promise<unknown>) => ({
  mutationOptions: (options: object) => ({ ...options, mutationFn: fn }),
});
vi.mock("@/utils/trpc", () => ({
  useTRPC: () => ({
    households: {
      list: query("households", [
        {
          id: "h0",
          name: "Just me",
          color: "sage",
          personal: true,
          members: [],
        },
        {
          id: "h1",
          name: "Family",
          color: "plum",
          personal: false,
          members: [{ id: "u1" }, { id: "u2" }],
        },
      ]),
    },
    collections: {
      pathKey: () => ["collections"],
      list: query("collections", [
        {
          id: "c1",
          name: "Weeknights",
          isOwner: true,
          recipeCount: 3,
          sharedWith: [],
        },
        {
          id: "c2",
          name: "Nan's",
          isOwner: false,
          recipeCount: 9,
          sharedWith: [{ id: "h1", name: "Family", color: "plum" }],
        },
        {
          id: "c3",
          name: "Christmas",
          isOwner: true,
          recipeCount: 0,
          sharedWith: [],
        },
      ]),
      addRecipes: mutation(server.add),
      removeRecipes: mutation(server.remove),
      create: mutation(async () => ({ id: "c4", name: "New" })),
    },
    recipes: {
      list: { queryKey: () => ["recipes", "list"] },
      get: { queryKey: () => ["recipes", "get"] },
    },
  }),
}));

afterEach(() => {
  cleanup();
  server.add.mockClear();
  server.remove.mockClear();
});

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

it("lists only shared households as share targets and toggles them", async () => {
  const onToggle = vi.fn();
  render(
    wrap(createElement(HouseholdShareList, { sharedIds: ["h1"], onToggle })),
  );
  const family = await screen.findByRole("switch", { name: /Family/ });
  expect(family.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByText("Just me")).toBeNull();
  fireEvent.click(family);
  expect(onToggle).toHaveBeenCalledWith("h1", false);
});

it("toggles one recipe's membership in my own collections only", async () => {
  render(
    wrap(
      createElement(AddToCollectionSheet, {
        open: true,
        onOpenChange: () => {},
        recipeIds: ["r1"],
        memberOf: ["c1"],
      }),
    ),
  );
  const weeknights = await screen.findByRole("checkbox", {
    name: /Weeknights/,
  });
  expect(weeknights.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByText("Nan's")).toBeNull();
  fireEvent.click(weeknights);
  await waitFor(() =>
    expect(server.remove).toHaveBeenCalledWith(
      { collectionId: "c1", recipeIds: ["r1"] },
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /Christmas/ }));
  await waitFor(() =>
    expect(server.add).toHaveBeenCalledWith(
      { collectionId: "c3", recipeIds: ["r1"] },
      expect.anything(),
    ),
  );
});
