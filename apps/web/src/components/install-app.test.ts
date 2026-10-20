// @vitest-environment jsdom

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  InstallAppProvider,
  InstallMenuItem,
  InstallSuggestion,
} from "./install-app";

let standalone = false;
let displayMode: EventTarget;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  standalone = false;
  displayMode = new EventTarget();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      media,
      get matches() {
        return media.includes("display-mode") && standalone;
      },
      addEventListener: displayMode.addEventListener.bind(displayMode),
      removeEventListener: displayMode.removeEventListener.bind(displayMode),
    })),
  );
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android Chrome");
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    get: () => 0,
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "maxTouchPoints");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function harness({ returning = true } = {}) {
  if (returning)
    sessionStorage.setItem("kitchenbinder:install:visit", "returning");
  return render(
    createElement(InstallAppProvider, {
      children: [
        createElement(InstallSuggestion, { key: "suggestion" }),
        createElement(DropdownMenu, {
          key: "menu",
          children: [
            createElement(DropdownMenuTrigger, {
              key: "trigger",
              children: "Account",
              className: "account-trigger",
            }),
            createElement(DropdownMenuContent, {
              key: "content",
              children: createElement(InstallMenuItem),
            }),
          ],
        }),
      ],
    }),
  );
}

function nativePrompt(
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>,
) {
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    { prompt },
  );
  act(() => {
    window.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}

async function openFromMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Add to home screen" }),
  );
}

it("only offers a native prompt after a tap, consumes it once, and recovers after dismissal", async () => {
  harness();
  const prompt = vi.fn<() => Promise<{ outcome: "dismissed" }>>();
  let resolve = (_result: { outcome: "dismissed" }) => {};
  prompt.mockImplementation(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  nativePrompt(prompt);
  expect(prompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add to home screen" }));
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
  await act(async () => {
    resolve({ outcome: "dismissed" });
  });
  await openFromMenu();
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog").textContent).toContain("Android");
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the appinstalled result when it arrives before the prompt resolves", async () => {
  harness();
  let resolve = (_result: { outcome: "dismissed" }) => {};
  nativePrompt(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add to home screen" }));
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
  await act(async () => {
    resolve({ outcome: "dismissed" });
  });
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
  expect(
    screen.queryByRole("menuitem", { name: "Add to home screen" }),
  ).toBeNull();
});

it("shows manual recovery if a native prompt fails and can accept a fresh browser event", async () => {
  harness();
  nativePrompt(() => Promise.reject(new Error("Prompt expired")));
  fireEvent.click(screen.getByRole("button", { name: "Add to home screen" }));
  expect(await screen.findByRole("status")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  const prompt = vi.fn(async () => ({ outcome: "accepted" as const }));
  nativePrompt(prompt);
  await openFromMenu();
  await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["iPhone", "iPad-desktop"])(
  "offers the iOS guide for %s without an install API",
  async (device) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      device === "iPhone" ? "iPhone Safari" : "Macintosh Safari",
    );
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(
      device === "iPhone" ? 1 : 5,
    );
    harness({ returning: false });
    expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
    await openFromMenu();
    const guide = screen.getByRole("dialog");
    expect(guide.textContent).toContain("Safari on your iPhone or iPad");
    expect(guide.textContent).toContain("Open as Web App");
    fireEvent(guide, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Account" }),
    );
  },
);

it("respects suggestion dismissal across visits while keeping manual installation available", async () => {
  const view = harness();
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss home screen suggestion" }),
  );
  view.unmount();
  sessionStorage.clear();
  harness();
  expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
  await openFromMenu();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("does not suggest installation during a first visit or after a reload in that visit", () => {
  const view = harness({ returning: false });
  expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
  view.unmount();
  harness({ returning: false });
  expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
});

it("still opens the guide when storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  harness({ returning: false });
  await openFromMenu();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("hides install controls in standalone mode and when the display mode changes", () => {
  standalone = true;
  const view = harness();
  expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
  view.unmount();
  standalone = false;
  harness();
  expect(screen.getByLabelText("Home screen shortcut")).toBeTruthy();
  standalone = true;
  act(() => {
    displayMode.dispatchEvent(new Event("change"));
  });
  expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
});

it("removes browser listeners when the provider unmounts", () => {
  const view = harness();
  view.unmount();
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    {
      prompt: vi.fn(),
    },
  );
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("leaves desktop installation promotion to the browser", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows Chrome");
  harness();
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    { prompt: vi.fn() },
  );
  act(() => {
    window.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
});

it("recognises the legacy iOS standalone flag", () => {
  Object.defineProperty(navigator, "standalone", {
    configurable: true,
    value: true,
  });
  try {
    harness();
    expect(screen.queryByLabelText("Home screen shortcut")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(
      screen.queryByRole("menuitem", { name: "Add to home screen" }),
    ).toBeNull();
  } finally {
    Reflect.deleteProperty(navigator, "standalone");
  }
});
