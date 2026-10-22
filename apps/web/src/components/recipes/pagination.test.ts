// @vitest-environment jsdom

import type { AppRouter } from "@prep-sheet/api/routers/index";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { inferRouterInputs } from "@trpc/server";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipePicker } from "../shopping/add-recipes";
import { RecipePagination, useRecipePage } from "./pagination";

type PickerInput = Exclude<
  inferRouterInputs<AppRouter>["shopping"]["recipes"],
  void
>;
const server = vi.hoisted(() => ({
  requests: [] as PickerInput[],
  add: vi.fn(async (_input: { recipeIds: string[] }) => ({ addedRecipes: 2 })),
}));
vi.mock("../../utils/trpc", () => ({
  useTRPC: () => ({
    shopping: {
      pathKey: () => ["shopping"],
      list: {
        queryOptions: () => ({
          queryKey: ["shopping", "list"],
          queryFn: async () => [],
        }),
      },
      recipes: {
        queryOptions: (input: PickerInput) => ({
          queryKey: ["shopping", "recipes", input],
          queryFn: async () => {
            server.requests.push(input);
            const recipes = Array.from({ length: 50 }, (_, index) => ({
              id: `r${index + 1}`,
              title: `Dish ${index + 1}`,
              groupId: null,
              servings: "2",
            }));
            const found = recipes.filter((recipe) =>
              recipe.title.includes(input.search ?? ""),
            );
            const start = (input.page ?? 0) * (input.pageSize ?? 24);
            return {
              total: found.length,
              items: found.slice(start, start + (input.pageSize ?? 24)),
            };
          },
        }),
      },
      addRecipes: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: server.add,
        }),
      },
    },
  }),
}));
vi.mock("../groups/collection-context", () => ({
  useCollection: () => ({
    groups: { data: [], error: null, refetch: vi.fn() },
  }),
}));
vi.mock("../households/planning-context", async (original) => ({
  ...(await original<typeof import("../households/planning-context")>()),
  usePlanningScope: () => ({
    scope: { kind: "personal" },
    scopeKey: "personal",
    ready: true,
    available: true,
    household: null,
    error: undefined,
    retry: () => {},
    selectScope: () => {},
  }),
}));

beforeEach(() => {
  server.requests.length = 0;
  server.add.mockClear();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks();
});

it("resets the requested page immediately when filters/collection change, including returning to earlier filters", () => {
  const hook = renderHook(({ key }) => useRecipePage(key), {
    initialProps: { key: "personal" },
  });
  act(() => hook.result.current.setPage(2));
  expect(hook.result.current.page).toBe(2);
  hook.rerender({ key: "group-search" });
  expect(hook.result.current.page).toBe(0);
  hook.rerender({ key: "personal" });
  expect(hook.result.current.page).toBe(0);
});

it("restores a collection page supplied by navigation", () => {
  const hook = renderHook(() => useRecipePage("personal", 1));
  expect(hook.result.current.page).toBe(1);
});

it("recovers when deletions remove the last page and hides unnecessary controls", async () => {
  const setPage = vi.fn();
  const view = render(
    createElement(RecipePagination, { page: 2, total: 48, setPage }),
  );
  await waitFor(() => expect(setPage).toHaveBeenCalledWith(1));
  view.rerender(
    createElement(RecipePagination, { page: 0, total: 24, setPage }),
  );
  expect(screen.queryByRole("navigation", { name: "Recipe pages" })).toBeNull();
});

it("keeps shopping selection across pages and search, submits both IDs, and requests bounded pages", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const close = vi.fn();
  render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RecipePicker, { onClose: close }),
    ),
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /^Dish 1\s*Personal/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /^Dish 25\s*Personal/ }),
  );
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search recipes"), {
    target: { value: "Dish 50" },
  });
  await screen.findByRole("checkbox", { name: /^Dish 50\s*Personal/ });
  expect(screen.getByText("2 selected")).toBeTruthy();
  expect(server.requests.at(-1)).toMatchObject({
    search: "Dish 50",
    page: 0,
    pageSize: 24,
  });
  fireEvent.click(screen.getByRole("button", { name: "Add ingredients" }));
  await waitFor(() =>
    expect(server.add).toHaveBeenCalledWith(
      { scope: { kind: "personal" }, recipeIds: ["r1", "r25"] },
      expect.anything(),
    ),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(server.requests.every((request) => request.pageSize === 24)).toBe(
    true,
  );
  client.clear();
});
