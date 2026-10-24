// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("wxt/browser", () => ({
  browser: { runtime: { sendMessage: fake.send } },
}));
vi.mock("../../lib/config", () => ({
  prepSheetOrigin: "http://localhost:3001",
}));

import { Capture } from "./Capture";
import { Import } from "./Import";

const id = "11111111-1111-4111-8111-111111111111";
const content = "Soup ingredients and instructions. ".repeat(5);
const pending = {
  id,
  content,
  sourceUrl: "https://recipes.test/soup",
  householdId: id,
  title: "Soup",
  collectionName: "Family",
};
let root: Root;
let container: HTMLDivElement;
const reconnect = vi.fn();
const render = async () => {
  await act(async () => {
    root.render(
      createElement(Import, {
        accountId: "test",
        content,
        title: "Soup",
        sourceUrl: pending.sourceUrl,
        onLocked: () => {},
        onBusy: () => {},
        onReconnect: reconnect,
      }),
    );
  });
};
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.send.mockReset();
  reconnect.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("keeps collection errors visible and reloads them without resetting an import", async () => {
  let broken = true;
  fake.send.mockImplementation(async ({ kind }) => {
    if (kind === "destinations")
      return broken
        ? { ok: false, error: "Collections unavailable" }
        : {
            ok: true,
            data: {
              collections: [{ id: null, name: "My recipes" }],
              householdId: null,
              changed: false,
            },
          };
    return { ok: true, data: null };
  });
  await render();
  expect(container.textContent).toContain("Collections unavailable");
  expect(container.textContent).not.toContain("Save recipe");
  broken = false;
  await click("Reload collections");
  expect(container.textContent).toContain("Save recipe");
  expect(
    fake.send.mock.calls.every(([command]) => command.accountId === "test"),
  ).toBe(true);
  expect(
    fake.send.mock.calls.some(([command]) => command.kind === "reset-import"),
  ).toBe(false);
});
it("preserves pending context and offers reconnect when status access expires", async () => {
  fake.send.mockImplementation(async ({ kind }) =>
    kind === "pending-import"
      ? { ok: true, data: pending }
      : { ok: false, reconnect: true, error: "Access expired" },
  );
  await render();
  expect(container.textContent).toContain("Soup");
  expect(container.textContent).toContain("Family");
  expect(container.querySelectorAll('input[name="collection"]')).toHaveLength(
    0,
  );
  await click("Reconnect account");
  expect(reconnect).toHaveBeenCalledOnce();
  expect(
    fake.send.mock.calls.some(([command]) => command.kind === "reset-import"),
  ).toBe(false);
});
it("recovers a lost submission before allowing another save", async () => {
  let submitted = false;
  fake.send.mockImplementation(async ({ kind }) => {
    if (kind === "pending-import")
      return { ok: true, data: submitted ? pending : null };
    if (kind === "recover-import")
      return {
        ok: true,
        data: submitted
          ? { kind: "saved", id, recipeId: id, title: "Soup" }
          : null,
      };
    if (kind === "destinations")
      return {
        ok: true,
        data: {
          collections: [{ id, name: "Family" }],
          householdId: id,
          changed: false,
        },
      };
    if (kind === "save-import") {
      submitted = true;
      throw new Error("Response lost");
    }
    throw new Error(`Unexpected ${kind}`);
  });
  await render();
  await click("Save recipe");
  expect(container.textContent).toContain("Response lost");
  expect(container.querySelectorAll('input[name="collection"]')).toHaveLength(
    0,
  );
  await click("Check import again");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    `http://localhost:3001/recipes/${id}`,
  );
  expect(
    fake.send.mock.calls.filter(([command]) => command.kind === "save-import"),
  ).toHaveLength(1);
});
it("does not discard pending work when reset is refused", async () => {
  fake.send.mockImplementation(async ({ kind }) => {
    if (kind === "pending-import") return { ok: true, data: pending };
    if (kind === "recover-import")
      return {
        ok: true,
        data: { kind: "failed", id, message: "Group access changed" },
      };
    return { ok: false, error: "Could not confirm discard" };
  });
  await render();
  await click("Start another import");
  expect(container.textContent).toContain("Family");
  expect(container.textContent).toContain("Could not confirm discard");
  expect(container.querySelectorAll('input[name="collection"]')).toHaveLength(
    0,
  );
});

it("restores a selected capture and keeps it when reading another page fails", async () => {
  const capture = {
    kind: "captured",
    sourceUrl: pending.sourceUrl,
    recipes: [
      { title: "Soup", content, format: "text" },
      { title: "Bread", content, format: "text" },
    ],
  };
  fake.send.mockImplementation(async ({ kind }) =>
    kind === "recover-capture"
      ? { capture, selection: { sourceUrl: pending.sourceUrl, selected: 1 } }
      : { kind: "error", code: "challenge" },
  );
  await act(async () => root.render(createElement(Capture)));
  expect(container.querySelector("h2")?.textContent).toBe("Bread");
  await click("Capture again");
  expect(container.querySelector("h2")?.textContent).toBe("Bread");
  expect(container.textContent).toContain("browser check");
});
