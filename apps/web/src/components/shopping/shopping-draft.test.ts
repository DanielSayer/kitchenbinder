// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { groceryNeedsReview, readShoppingDraft } from "./shopping-draft";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
it("retains the original grocery text across reloads and detects a partner edit", () => {
  sessionStorage.setItem(
    "draft",
    JSON.stringify({ text: "Full cream milk", baseText: "Milk" }),
  );
  const restored = readShoppingDraft("draft", "Oat milk");
  expect(restored.baseText).toBe("Milk");
  expect(groceryNeedsReview(restored, "Oat milk")).toBe(true);
  expect(groceryNeedsReview(restored, "Milk")).toBe(false);
});
it("requires review for older drafts with an unknown baseline", () => {
  localStorage.setItem("draft", "Full cream milk");
  const restored = readShoppingDraft("draft", "Oat milk");
  expect(restored).toEqual({ text: "Full cream milk", baseText: null });
  expect(groceryNeedsReview(restored, "Oat milk")).toBe(true);
});
it("keeps tab drafts independent of another tab's legacy draft", () => {
  localStorage.setItem("draft", "Other tab");
  sessionStorage.setItem(
    "draft",
    JSON.stringify({ text: "My edit", baseText: "Milk" }),
  );
  expect(readShoppingDraft("draft", "Milk").text).toBe("My edit");
});
