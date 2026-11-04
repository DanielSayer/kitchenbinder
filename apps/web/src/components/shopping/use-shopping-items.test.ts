// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Item } from "./shopping-groups";
import { useShoppingItems } from "./use-shopping-items";

const { addItem, updateItem, undo } = vi.hoisted(() => ({
  addItem: vi.fn<(input: { id: string; text: string }) => Promise<void>>(),
  updateItem: vi.fn<() => Promise<void>>(),
  undo: vi.fn(),
}));
vi.mock("@/components/households/household-context", () => ({
  useHouseholdScope: () => undefined,
}));
vi.mock("@/components/pantry", () => ({ undoToast: undo }));
vi.mock("@/utils/trpc", () => ({
  useTRPCClient: () => ({}),
  useTRPC: () => ({
    planner: { pathKey: () => ["planner"] },
    shopping: {
      pathKey: () => ["shopping"],
      list: {
        queryKey: () => ["shopping", "list"],
        queryOptions: () => ({
          queryKey: ["shopping", "list"],
          queryFn: async (): Promise<Item[]> => [],
          staleTime: Number.POSITIVE_INFINITY,
        }),
      },
      addItem: {
        mutationOptions: (options: object) => ({
          mutationFn: addItem,
          ...options,
        }),
      },
      updateItem: { mutationOptions: () => ({ mutationFn: updateItem }) },
    },
  }),
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const hook = renderHook(() => useShoppingItems("user-a"), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  return { ...hook, client };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

it("restores failed quick entry with the original retry ID", async () => {
  addItem.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce();
  const { result } = mount();
  act(() => result.current.setText("Milk"));
  act(() => result.current.submit());
  expect(result.current.text).toBe("");
  await waitFor(() => expect(result.current.text).toBe("Milk"));
  expect(localStorage.getItem("shopping:user-a:new")).toBe("Milk");
  const first = addItem.mock.calls[0]?.[0];
  await waitFor(() => expect(result.current.add.isPending).toBe(false));
  act(() => result.current.submit());
  await waitFor(() => expect(addItem).toHaveBeenCalledTimes(2));
  expect(addItem.mock.calls[1]?.[0]).toEqual(first);
  await waitFor(() => expect(result.current.add.isPending).toBe(false));
  expect(result.current.text).toBe("");
  expect(localStorage.getItem("shopping:user-a:new")).toBeNull();
});

it.each(["success", "failure"])(
  "keeps newer text when an earlier add ends in %s",
  async (outcome) => {
    let resolve = () => {};
    let reject = (_error: Error) => {};
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    addItem.mockReturnValueOnce(promise);
    const { result } = mount();
    act(() => result.current.setText("Milk"));
    act(() => result.current.submit());
    await waitFor(() => expect(addItem).toHaveBeenCalledOnce());
    act(() => result.current.setText("Bread"));
    await act(async () => {
      if (outcome === "success") resolve();
      else reject(new Error("Offline"));
    });
    await waitFor(() => expect(result.current.add.isPending).toBe(false));
    expect(result.current.text).toBe("Bread");
    expect(localStorage.getItem("shopping:user-a:new")).toBe("Bread");
  },
);
