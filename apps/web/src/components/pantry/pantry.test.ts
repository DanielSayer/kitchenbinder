// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement, useState } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialsOf, isYouPath } from "../shell/destinations";
import { BinderTabs } from "./binder-tabs";
import { coverWord, RecipeCover, toneForTags } from "./recipe-cover";
import { Segmented } from "./segmented";
import { Sheet } from "./sheet";
import { pantryTones, toneFor } from "./tones";
import { undoToast } from "./undo-toast";

vi.mock("sonner", () => ({ toast: vi.fn(() => "toast-id") }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = "";
});

function renderSheet(onOpenChange = vi.fn()) {
  render(
    createElement(
      Sheet,
      { open: true, onOpenChange, title: "Save to" },
      createElement("button", { type: "button" }, "First"),
      createElement("button", { type: "button" }, "Last"),
    ),
  );
  return onOpenChange;
}

describe("Sheet", () => {
  it("renders a labelled modal dialog and focuses its first control", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Save to" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByText("First"));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes on Escape", () => {
    const onOpenChange = renderSheet();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on backdrop tap and close button", () => {
    const onOpenChange = renderSheet();
    const scrim = document.querySelector(".pantry-sheet-scrim");
    if (!scrim) throw new Error("missing scrim");
    fireEvent.click(scrim);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("traps Tab focus inside the sheet", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    screen.getByText("Last").focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Last"));
  });

  it("unmounts after closing and restores focus", () => {
    vi.useFakeTimers();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    function Harness() {
      const [open, setOpen] = useState(true);
      return createElement(Sheet, {
        open,
        onOpenChange: setOpen,
        title: "Sort",
      });
    }
    render(createElement(Harness));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.useRealTimers();
    trigger.remove();
  });
});

describe("RecipeCover", () => {
  it("tints deterministically from the id", () => {
    expect(toneFor("recipe-1")).toBe(toneFor("recipe-1"));
    expect(pantryTones).toContain(toneFor("recipe-1"));
    const seen = new Set(
      Array.from({ length: 40 }, (_, index) => toneFor(`r${index}`)),
    );
    expect(seen.size).toBeGreaterThan(1);

    const { container, rerender } = render(
      createElement(RecipeCover, { id: "abc", title: "Red lentil dal" }),
    );
    const first = container.firstElementChild?.getAttribute("data-tone");
    rerender(createElement(RecipeCover, { id: "abc", title: "Renamed" }));
    expect(container.firstElementChild?.getAttribute("data-tone")).toBe(first);
  });

  it("shows the key word, or its initial at list size", () => {
    const { container, rerender } = render(
      createElement(RecipeCover, {
        title: "Charred tomato & butter bean braise",
      }),
    );
    expect(container.textContent).toBe("Braise");
    rerender(
      createElement(RecipeCover, { title: "Chicken & leek pie", size: "list" }),
    );
    expect(container.textContent).toBe("P");
  });

  it("uses the photo when present and honours tone overrides", () => {
    const { container } = render(
      createElement(RecipeCover, {
        title: "Pie",
        photoUrl: "https://example.com/pie.jpg",
      }),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/pie.jpg",
    );
    expect(container.firstElementChild?.hasAttribute("data-tone")).toBe(false);
    cleanup();
    const tinted = render(
      createElement(RecipeCover, { title: "Pie", tone: "plum" }),
    );
    expect(tinted.container.firstElementChild?.getAttribute("data-tone")).toBe(
      "plum",
    );
  });

  it("picks words and tag tones sensibly", () => {
    expect(coverWord("Spaghetti with meatballs")).toBe("Spaghetti");
    expect(coverWord("Mum's lemon drizzle cake")).toBe("Cake");
    expect(coverWord("   ")).toBe("Recipe");
    expect(toneForTags(["Vegetarian"])).toBe("olive");
    expect(toneForTags(["Baking"])).toBe("butter");
    expect(toneForTags(["Other"])).toBeUndefined();
  });
});

describe("Segmented", () => {
  it("is a labelled radio group", () => {
    const onChange = vi.fn();
    render(
      createElement(Segmented<"list" | "grid">, {
        label: "View",
        value: "list",
        onChange,
        iconOnly: true,
        options: [
          { value: "list", label: "List" },
          { value: "grid", label: "Grid" },
        ],
      }),
    );
    expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
    const list = screen.getByRole("radio", {
      name: "List",
    }) as HTMLInputElement;
    expect(list.checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(onChange).toHaveBeenCalledWith("grid");
  });
});

describe("BinderTabs", () => {
  it("selects tabs with arrows and offers a trailing add", () => {
    const onChange = vi.fn();
    const onAdd = vi.fn();
    render(
      createElement(BinderTabs, {
        label: "Collections",
        value: "all",
        onChange,
        onAdd,
        tabs: [
          { id: "all", label: "All" },
          { id: "weeknights", label: "Weeknights", tone: "olive" },
        ],
      }),
    );
    const all = screen.getByRole("tab", { name: "All" });
    expect(all.getAttribute("aria-selected")).toBe("true");
    expect(all.tabIndex).toBe(0);
    fireEvent.keyDown(all, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("weeknights");
    fireEvent.keyDown(all, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("weeknights");
    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("undoToast", () => {
  function lastOptions() {
    const call = vi.mocked(toast).mock.calls.at(-1);
    const options = call?.[1] as unknown as {
      action: { onClick: (event: unknown) => void };
      onAutoClose: () => void;
      onDismiss: () => void;
    };
    return options;
  }

  it("undoes once and never commits after undo", () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    expect(undoToast("Recipe deleted", { onUndo, onCommit })).toBe("toast-id");
    const options = lastOptions();
    options.action.onClick({});
    options.onDismiss();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits when the toast times out", () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoToast("Ticked", { onUndo, onCommit });
    const options = lastOptions();
    options.onAutoClose();
    options.onDismiss();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });
});

describe("shell helpers", () => {
  it("derives initials and You paths", () => {
    expect(initialsOf("Dan Sayer")).toBe("DS");
    expect(initialsOf("dan")).toBe("D");
    expect(initialsOf("")).toBe("?");
    expect(isYouPath("/settings")).toBe(true);
    expect(isYouPath("/recipes")).toBe(false);
  });
});
