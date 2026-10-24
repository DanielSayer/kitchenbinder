// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CookMode } from "./cook-mode";

const content = {
  title: "Braise",
  description: "",
  servings: "4",
  prepMinutes: 10,
  cookMinutes: 35,
  totalMinutes: 45,
  ingredients: ["800 g cherry tomatoes", "2 tins butter beans"],
  steps: [
    "Tip the tomatoes into a tin.",
    "Roast for 25 minutes until blistered.",
    "Stir through the beans.",
  ],
  notes: "",
};

beforeEach(() => {
  sessionStorage.clear();
  Reflect.deleteProperty(navigator, "wakeLock");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("steps through the method, offers timers and finishes on the last step", () => {
  const onFinish = vi.fn();
  const onClose = vi.fn();
  render(
    createElement(CookMode, {
      recipeId: "r1",
      content,
      onClose,
      onFinish,
    }),
  );
  expect(screen.getByText("Tip the tomatoes into a tin.")).toBeTruthy();
  expect(screen.getByText("cherry tomatoes")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next step" }));
  expect(screen.getByText("25 minutes").tagName).toBe("EM");
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Start 25:00 timer" }));
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByRole("button", { pressed: true }).textContent).toContain(
    "24:00",
  );
  vi.useRealTimers();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  fireEvent.click(screen.getByRole("button", { name: /Done · log this cook/ }));
  expect(onFinish).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem("prep-sheet:cook-step:r1")).toBe("2");
});
