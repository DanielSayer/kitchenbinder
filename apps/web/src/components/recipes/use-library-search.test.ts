// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLibrarySearch } from "./use-library-search";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("debounces typing and follows later URL navigation without resubmitting it", () => {
  vi.useFakeTimers();
  const search = vi.fn();
  const { result, rerender } = renderHook(
    (value) => useLibrarySearch(value, search),
    { initialProps: "Soup" },
  );
  act(() => result.current.typeSearch("Pasta"));
  expect(result.current.searchText).toBe("Pasta");
  act(() => vi.advanceTimersByTime(200));
  act(() => result.current.typeSearch("Pasta bake"));
  act(() => vi.advanceTimersByTime(249));
  expect(search).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(search).toHaveBeenCalledExactlyOnceWith("Pasta bake");
  rerender("Pasta bake");
  rerender("Soup");
  expect(result.current.searchText).toBe("Soup");
  act(() => vi.advanceTimersByTime(250));
  expect(search).toHaveBeenCalledOnce();
});

it("keeps in-flight typing across URL changes and cancels its timer on unmount", () => {
  vi.useFakeTimers();
  const search = vi.fn();
  const { result, rerender, unmount } = renderHook(
    (value) => useLibrarySearch(value, search),
    { initialProps: "Soup" },
  );
  act(() => result.current.typeSearch("Pasta"));
  rerender("Salad");
  expect(result.current.searchText).toBe("Pasta");
  unmount();
  act(() => vi.advanceTimersByTime(250));
  expect(search).not.toHaveBeenCalled();
});
