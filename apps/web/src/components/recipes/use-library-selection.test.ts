// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CollectionSummary } from "@/components/collections/use-collections";
import { useLibrarySelection } from "./use-library-selection";

const collection: CollectionSummary = {
  id: "collection-a",
  name: "Weeknights",
  description: "",
  position: 0,
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
  owner: { id: "user-a", name: "Cook" },
  isOwner: true,
  recipeCount: 0,
  sharedWith: [],
};
afterEach(cleanup);

it("clears selected recipes when changing collections", () => {
  const { result, rerender } = renderHook((key) => useLibrarySelection(key), {
    initialProps: "all",
  });
  act(() => result.current.startSelection());
  act(() => result.current.toggleSelected("recipe-a"));
  expect(result.current.selectedIds).toEqual(["recipe-a"]);
  rerender(collection.id);
  expect(result.current.selectedIds).toEqual([]);
  expect(result.current.bulkMode).toBe(false);
});

it("keeps the target while picking on All and clears it when selection ends", () => {
  const { result, rerender } = renderHook((key) => useLibrarySelection(key), {
    initialProps: collection.id,
  });
  act(() => result.current.chooseForCollection(collection));
  rerender("all");
  expect(result.current.bulkMode).toBe(true);
  expect(result.current.pickTarget).toEqual(collection);
  act(() => result.current.toggleSelected("recipe-a"));
  act(() => result.current.toggleSelected("recipe-b"));
  act(() => result.current.toggleSelected("recipe-a"));
  expect(result.current.selectedIds).toEqual(["recipe-b"]);
  act(() => result.current.endSelection());
  expect(result.current.bulkMode).toBe(false);
  expect(result.current.selectedIds).toEqual([]);
  expect(result.current.pickTarget).toBeNull();
});

it("cancels picking when navigating to another collection", () => {
  const { result, rerender } = renderHook((key) => useLibrarySelection(key), {
    initialProps: collection.id,
  });
  act(() => result.current.chooseForCollection(collection));
  rerender("all");
  act(() => result.current.toggleSelected("recipe-a"));
  rerender("collection-b");
  expect(result.current.bulkMode).toBe(false);
  expect(result.current.selectedIds).toEqual([]);
  expect(result.current.pickTarget).toBeNull();
});
