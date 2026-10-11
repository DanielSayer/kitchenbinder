// @vitest-environment jsdom

import { beforeEach, expect, it, vi } from "vitest";
import {
  importDraftKey,
  readImportQueue,
  writeImportQueue,
  writePendingImport,
} from "./import-draft";

const first = {
  id: "00000000-0000-4000-8000-000000000001",
  input: "Make lemon pasta",
  groupId: null,
};
const second = {
  id: "00000000-0000-4000-8000-000000000002",
  input: "https://example.com/soup",
  groupId: "00000000-0000-4000-8000-000000000003",
};

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

it("recovers a legacy request and migrates without losing its ID or destination", () => {
  const key = importDraftKey("viewer");
  writePendingImport(key, second);
  expect(readImportQueue(key)).toEqual([second]);
  expect(writeImportQueue(key, [second, first])).toBe(true);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(readImportQueue(key)).toEqual([second, first]);
});

it("keeps every request separate from other accounts and the next input draft", () => {
  const key = importDraftKey("viewer");
  sessionStorage.setItem(`${key}:text`, "An unfinished third recipe");
  writeImportQueue(key, [first, second]);
  expect(readImportQueue(key)).toEqual([first, second]);
  expect(readImportQueue(importDraftKey("other"))).toEqual([]);
  writeImportQueue(key, [second]);
  expect(readImportQueue(key)).toEqual([second]);
  expect(sessionStorage.getItem(`${key}:text`)).toBe(
    "An unfinished third recipe",
  );
});

it("does not retire a recoverable legacy request if queue storage fails", () => {
  const key = importDraftKey("viewer");
  writePendingImport(key, first);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage full");
  });
  expect(writeImportQueue(key, [first, second])).toBe(false);
  expect(readImportQueue(key)).toEqual([first]);
});

it("rejects invalid or duplicate requests in browser storage", () => {
  const key = importDraftKey("viewer");
  sessionStorage.setItem(`${key}:queue`, JSON.stringify([first, first]));
  expect(readImportQueue(key)).toEqual([]);
  sessionStorage.setItem(`${key}:queue`, "not JSON");
  expect(readImportQueue(key)).toEqual([]);
});
