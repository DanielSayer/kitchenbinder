// @vitest-environment jsdom

import { beforeEach, expect, it } from "vitest";
import {
  readPendingShare,
  sharedRecipeInput,
  writePendingShare,
} from "./shared-recipe";

beforeEach(() => localStorage.clear());

it("prefers the shared url", () => {
  expect(
    sharedRecipeInput({
      title: "Soup",
      text: "Try https://other.example/x",
      url: "https://example.com/soup",
    }),
  ).toBe("https://example.com/soup");
});

it("finds a link inside shared text and trims trailing punctuation", () => {
  expect(
    sharedRecipeInput({
      text: "Check out this reel! https://www.instagram.com/reel/abc/?igsh=1.",
    }),
  ).toBe("https://www.instagram.com/reel/abc/?igsh=1");
});

it("ignores non-web urls and falls back to text", () => {
  expect(
    sharedRecipeInput({ url: "javascript:alert(1)", text: "nan's apple pie" }),
  ).toBe("nan's apple pie");
  expect(sharedRecipeInput({ text: " a " })).toBeNull();
  expect(sharedRecipeInput({})).toBeNull();
});

it("keeps a pending share for an hour", () => {
  writePendingShare("https://example.com/soup", 1000);
  expect(readPendingShare(1000 + 59 * 60 * 1000)).toBe(
    "https://example.com/soup",
  );
  expect(readPendingShare(1000 + 61 * 60 * 1000)).toBeNull();
  expect(readPendingShare(1000)).toBeNull();
});

it("clears a pending share", () => {
  writePendingShare("https://example.com/soup");
  writePendingShare(null);
  expect(readPendingShare()).toBeNull();
});
