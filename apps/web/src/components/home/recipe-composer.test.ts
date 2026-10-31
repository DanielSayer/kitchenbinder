// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createQueryClient } from "@/utils/query-client";
import {
  importDraftKey,
  readImportQueue,
  writeImportQueue,
  writePendingImport,
} from "./import-draft";
import { RecipeComposer } from "./recipe-composer";

const {
  createImport,
  discardImport,
  readStatus,
  selectHousehold,
  readRecipe,
  deleteRecipe,
  shareRecipe,
  unshareRecipe,
  addToCollection,
  undo,
} = vi.hoisted(() => ({
  createImport: vi.fn(),
  discardImport: vi.fn(),
  readStatus: vi.fn(),
  selectHousehold: vi.fn(),
  readRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
  shareRecipe: vi.fn(),
  unshareRecipe: vi.fn(),
  addToCollection: vi.fn(),
  undo: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/pantry/undo-toast", () => ({ undoToast: undo }));
const weeknights = "00000000-0000-4000-8000-000000000009";
const family = "00000000-0000-4000-8000-000000000003";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "viewer" } }, isPending: false }),
  },
}));
vi.mock("@/utils/trpc", () => ({
  useTRPC: () => ({
    recipes: {
      create: { mutationOptions: () => ({ mutationFn: createImport }) },
      discardImport: { mutationOptions: () => ({ mutationFn: discardImport }) },
      importStatus: {
        queryOptions: ({ id }: { id: string }, options: object) => ({
          queryKey: ["import-status", id],
          queryFn: () => readStatus(id),
          ...options,
        }),
      },
      get: {
        queryOptions: ({ id }: { id: string }, options: object) => ({
          queryKey: ["recipe", id],
          queryFn: () => readRecipe(id),
          ...options,
        }),
      },
      delete: {
        mutationOptions: (options: object) => ({
          mutationFn: deleteRecipe,
          ...options,
        }),
      },
      share: { mutationOptions: () => ({ mutationFn: shareRecipe }) },
      unshare: { mutationOptions: () => ({ mutationFn: unshareRecipe }) },
      list: { queryKey: () => ["recipes"] },
    },
    collections: {
      list: {
        queryKey: () => ["collections"],
        queryOptions: () => ({
          queryKey: ["collections"],
          queryFn: () => [
            { id: weeknights, name: "Weeknights", isOwner: true },
            { id: "shared-collection", name: "Shared", isOwner: false },
          ],
        }),
      },
      create: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      addRecipes: { mutationOptions: () => ({ mutationFn: addToCollection }) },
      removeRecipes: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  }),
}));
vi.mock("@/components/households/household-context", () => ({
  useHousehold: () => ({
    householdId: null,
    available: true,
    selectHousehold,
    households: {
      data: [
        { id: family, name: "Family recipes", personal: false, color: "plum" },
      ],
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    params,
  }: {
    children?: ReactNode;
    params?: { recipeId: string };
  }) =>
    createElement(
      "a",
      { href: params ? `/recipes/${params.recipeId}` : "#" },
      children,
    ),
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  writePendingImport(importDraftKey("viewer"), {
    id: "00000000-0000-4000-8000-000000000001",
    input: "Make lemon pasta",
    householdId: null,
  });
  readStatus.mockRejectedValue(
    Object.assign(new Error("Import not found."), {
      data: { code: "NOT_FOUND" },
    }),
  );
  discardImport.mockResolvedValue(undefined);
  readRecipe.mockImplementation((id: string) =>
    Promise.resolve({
      id,
      sourceUrl: "https://www.example.com/lemon-pasta",
      sharedWith: [],
      collectionIds: [],
      tags: [{ id: "t1", name: "Vegetarian" }],
      content: {
        title: "Lemon pasta",
        description: "",
        servings: "2",
        prepMinutes: 10,
        cookMinutes: 15,
        totalMinutes: null,
        ingredients: ["Pasta", "Lemon", "Spinach", "Garlic", "Olive oil"],
        steps: ["Cook."],
        notes: "",
      },
    }),
  );
  shareRecipe.mockResolvedValue({ success: true });
  addToCollection.mockResolvedValue({ added: 1 });
  deleteRecipe.mockResolvedValue({ success: true });
});

afterEach(cleanup);

function showComposer() {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { retry: false },
    mutations: { retry: false },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RecipeComposer),
    ),
  );
}

it("stops showing progress after a quota rejection and keeps the draft", async () => {
  createImport.mockRejectedValue(
    Object.assign(new Error("Your Free plan is full."), {
      data: { code: "FORBIDDEN" },
    }),
  );
  showComposer();

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Your Free plan is full.",
    ),
  );
  expect(screen.queryByText(/Creating your recipe/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  expect(readStatus).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  const polls = readStatus.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 2200));
  expect(readStatus).toHaveBeenCalledTimes(polls);

  fireEvent.click(screen.getByRole("button", { name: "Edit and try again" }));
  await waitFor(() => expect(discardImport).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole("textbox")).toHaveProperty(
      "value",
      "Make lemon pasta",
    ),
  );
});

it("keeps an uncertain request recoverable", async () => {
  createImport.mockRejectedValue(new Error("Connection lost."));
  showComposer();

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Connection lost."),
  );
  expect(screen.getByText(/Creating your recipe/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
  await waitFor(() => expect(readStatus).toHaveBeenCalled());
  expect(toast.error).not.toHaveBeenCalled();
});

it("waits for admission before checking progress", async () => {
  const status = {
    kind: "queued",
    id: "00000000-0000-4000-8000-000000000001",
    queuedForMs: 0,
  };
  let accept: (() => void) | undefined;
  createImport.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = () => resolve(status);
      }),
  );
  readStatus.mockResolvedValue(status);
  showComposer();
  await waitFor(() => expect(createImport).toHaveBeenCalledOnce());
  expect(readStatus).not.toHaveBeenCalled();
  if (!accept) throw new Error("Admission did not start");
  accept();
  await waitFor(() => expect(readStatus).toHaveBeenCalledOnce());
  expect(screen.getByText(/Your recipe is queued/)).toBeTruthy();
  expect(toast.error).not.toHaveBeenCalled();
});

it("recovers a lost admission response without a not-found toast", async () => {
  createImport.mockRejectedValue(new Error("Connection lost."));
  readStatus
    .mockRejectedValueOnce(
      Object.assign(new Error("Import not found."), {
        data: { code: "NOT_FOUND" },
      }),
    )
    .mockResolvedValue({
      kind: "saved",
      id: "00000000-0000-4000-8000-000000000001",
      recipeId: "00000000-0000-4000-8000-000000000001",
      title: "Lemon pasta",
    });
  showComposer();
  await waitFor(() => expect(readStatus).toHaveBeenCalledOnce());
  expect(toast.error).not.toHaveBeenCalled();
  await waitFor(
    () =>
      expect(
        screen.getByRole("button", { name: "Open Lemon pasta" }),
      ).toBeTruthy(),
    { timeout: 4000 },
  );
  expect(toast.error).not.toHaveBeenCalled();
  expect(createImport).toHaveBeenCalledOnce();
});

it("shows progress failures inline without duplicating them in a toast", async () => {
  createImport.mockResolvedValue({
    kind: "queued",
    id: "00000000-0000-4000-8000-000000000001",
    queuedForMs: 0,
  });
  readStatus.mockRejectedValue(new Error("Network unavailable."));
  showComposer();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't check progress.",
    ),
  );
  expect(toast.error).not.toHaveBeenCalled();
  expect(screen.getByText(/Your recipe is queued/)).toBeTruthy();
});

it("shows a stalled queue with its reference while preserving the existing request", async () => {
  const status = {
    kind: "queued",
    id: "00000000-0000-4000-8000-000000000001",
    queuedForMs: 65_000,
  };
  createImport.mockResolvedValue(status);
  readStatus.mockResolvedValue(status);
  showComposer();
  await waitFor(() =>
    expect(
      screen.getByText(/Still waiting to start after 65 seconds/),
    ).toBeTruthy(),
  );
  expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "View input" }));
  expect(
    within(screen.getByRole("dialog")).getByText(/Import reference:/)
      .textContent,
  ).toContain(status.id);
  expect(createImport).toHaveBeenCalledTimes(1);
  expect(discardImport).not.toHaveBeenCalled();
});

function enterRecipe(input: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: input } });
  fireEvent.click(screen.getByRole("button", { name: "Make a recipe" }));
}

it("clears and focuses the composer while two requests have independent inputs and progress", async () => {
  sessionStorage.clear();
  createImport.mockImplementation((request) =>
    Promise.resolve({ kind: "queued", id: request.id, queuedForMs: 0 }),
  );
  readStatus.mockImplementation((id) =>
    Promise.resolve({ kind: "queued", id, queuedForMs: 0 }),
  );
  showComposer();
  enterRecipe("https://example.com/lemon-pasta");
  expect(screen.getByRole("textbox")).toHaveProperty("value", "");
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
  enterRecipe("Make a chickpea soup with spinach");
  await waitFor(() => expect(createImport).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(readStatus).toHaveBeenCalledTimes(2));
  const requests = readImportQueue(importDraftKey("viewer"));
  expect(requests.map((request) => request.input)).toEqual([
    "https://example.com/lemon-pasta",
    "Make a chickpea soup with spinach",
  ]);
  expect(new Set(requests.map((request) => request.id)).size).toBe(2);
  expect(screen.getAllByRole("article")).toHaveLength(2);
  for (const request of requests) {
    const card = screen.getByRole("article", {
      name: `Recipe request: ${request.input}`,
    });
    expect(within(card).getByRole("heading").textContent).toBe(request.input);
    expect(within(card).getByText("Queued")).toBeTruthy();
  }
  expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
});

it("keeps a new draft intact when an earlier request succeeds or is dismissed", async () => {
  createImport.mockResolvedValue({
    kind: "saved",
    id: "00000000-0000-4000-8000-000000000001",
    recipeId: "00000000-0000-4000-8000-000000000004",
    title: "Lemon pasta",
  });
  readStatus.mockImplementation(() => createImport.mock.results[0]?.value);
  showComposer();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "My next recipe draft" },
  });
  await waitFor(() =>
    expect(screen.getByText("Ready · 5 ingredients")).toBeTruthy(),
  );
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "My next recipe draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open Lemon pasta" }));
  const sheet = await screen.findByRole("dialog", {
    name: "Ready to save: Lemon pasta",
  });
  expect(within(sheet).getByText("From example.com")).toBeTruthy();
  expect(within(sheet).getByText("25 min")).toBeTruthy();
  expect(within(sheet).getByText("Vegetarian")).toBeTruthy();
  expect(within(sheet).getByText("+1 more")).toBeTruthy();
  // Only my own collections are offered.
  await within(sheet).findByRole("button", { name: "Weeknights" });
  expect(within(sheet).queryByRole("button", { name: "Shared" })).toBeNull();
  fireEvent.click(within(sheet).getByRole("button", { name: "Weeknights" }));
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Family recipes" }),
  );
  fireEvent.click(within(sheet).getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  expect(addToCollection.mock.calls[0]?.[0]).toEqual({
    collectionId: weeknights,
    recipeIds: ["00000000-0000-4000-8000-000000000004"],
  });
  expect(shareRecipe.mock.calls[0]?.[0]).toEqual({
    id: "00000000-0000-4000-8000-000000000004",
    householdId: family,
  });
  expect(toast.success).toHaveBeenCalledWith(
    "Saved to Weeknights · shared with Family recipes",
  );
  expect(readImportQueue(importDraftKey("viewer"))).toEqual([]);
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "My next recipe draft",
  );
  expect(discardImport).not.toHaveBeenCalled();
});

it("discards a ready recipe with undo instead of a confirmation", async () => {
  createImport.mockResolvedValue({
    kind: "saved",
    id: "00000000-0000-4000-8000-000000000001",
    recipeId: "00000000-0000-4000-8000-000000000004",
    title: "Lemon pasta",
  });
  readStatus.mockImplementation(() => createImport.mock.results[0]?.value);
  showComposer();
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Lemon pasta" }),
  );
  const sheet = await screen.findByRole("dialog");
  await within(sheet).findByText("Lemon pasta");
  fireEvent.click(within(sheet).getByRole("button", { name: "Discard" }));
  expect(screen.queryByRole("article")).toBeNull();
  expect(undo).toHaveBeenCalledOnce();
  const [message, options] = undo.mock.calls[0] ?? [];
  expect(message).toBe("Recipe discarded");
  expect(deleteRecipe).not.toHaveBeenCalled();
  act(() => options.onUndo());
  expect(readImportQueue(importDraftKey("viewer"))).toHaveLength(1);
  await screen.findByRole("article");
  undo.mockClear();
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Lemon pasta" }),
  );
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Discard",
    }),
  );
  act(() => undo.mock.calls[0]?.[1].onCommit());
  await waitFor(() => expect(deleteRecipe).toHaveBeenCalledOnce());
  expect(deleteRecipe.mock.calls[0]?.[0]).toEqual({
    id: "00000000-0000-4000-8000-000000000004",
  });
  expect(readImportQueue(importDraftKey("viewer"))).toEqual([]);
});

it("keeps a multi-recipe card until each recipe is saved or discarded", async () => {
  const pasta = "00000000-0000-4000-8000-000000000001";
  const soup = "00000000-0000-4000-8000-000000000005";
  createImport.mockResolvedValue({
    kind: "saved",
    id: pasta,
    recipeId: pasta,
    title: "Lemon pasta",
    recipes: [
      { id: pasta, title: "Lemon pasta" },
      { id: soup, title: "Tomato soup" },
    ],
  });
  readStatus.mockImplementation(() => createImport.mock.results[0]?.value);
  showComposer();
  expect(await screen.findByText("2 recipes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Tomato soup" }));
  fireEvent.click(
    await within(await screen.findByRole("dialog")).findByRole("button", {
      name: "Discard",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Open Tomato soup" }),
    ).toBeNull(),
  );
  expect(readImportQueue(importDraftKey("viewer"))[0]?.done).toEqual([soup]);
  act(() => undo.mock.calls[0]?.[1].onCommit());
  await waitFor(() => expect(deleteRecipe).toHaveBeenCalledOnce());
  expect(deleteRecipe.mock.calls[0]?.[0]).toEqual({ id: soup });
  fireEvent.click(screen.getByRole("button", { name: "Open Lemon pasta" }));
  const sheet = await screen.findByRole("dialog", {
    name: "Ready to save: Lemon pasta",
  });
  fireEvent.click(
    await within(sheet).findByRole("button", { name: "Save recipe" }),
  );
  await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  expect(readImportQueue(importDraftKey("viewer"))).toEqual([]);
});

it("recovers every request with the same ID and destination without consuming the next draft", async () => {
  const queue = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      input: "Make lemon pasta",
      householdId: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      input: "Make chickpea soup",
      householdId: "00000000-0000-4000-8000-000000000003",
    },
  ];
  writeImportQueue(importDraftKey("viewer"), queue);
  sessionStorage.setItem(
    `${importDraftKey("viewer")}:text`,
    "A third unfinished recipe",
  );
  createImport.mockImplementation((request) =>
    Promise.resolve({ kind: "queued", id: request.id }),
  );
  readStatus.mockImplementation((id) =>
    Promise.resolve({ kind: "queued", id }),
  );
  const view = showComposer();
  await waitFor(() => expect(createImport).toHaveBeenCalledTimes(2));
  expect(screen.getByText("Family recipes")).toBeTruthy();
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "A third unfinished recipe",
  );
  view.unmount();
  showComposer();
  await waitFor(() => expect(createImport).toHaveBeenCalledTimes(4));
  expect(createImport.mock.calls.map(([request]) => request)).toEqual([
    ...queue,
    ...queue,
  ]);
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "A third unfinished recipe",
  );
});

it("attaches a quota rejection to its card while another request keeps polling", async () => {
  writeImportQueue(importDraftKey("viewer"), [
    {
      id: "00000000-0000-4000-8000-000000000001",
      input: "Make lemon pasta",
      householdId: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      input: "Make chickpea soup",
      householdId: "00000000-0000-4000-8000-000000000003",
    },
  ]);
  createImport.mockImplementation((request) =>
    request.input === "Make lemon pasta"
      ? Promise.resolve({ kind: "queued", id: request.id })
      : Promise.reject(
          Object.assign(new Error("Your queue is full."), {
            data: { code: "TOO_MANY_REQUESTS" },
          }),
        ),
  );
  readStatus.mockResolvedValue({
    kind: "queued",
    id: "00000000-0000-4000-8000-000000000001",
  });
  showComposer();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Your queue is full.",
    ),
  );
  const rejected = screen.getByRole("article", {
    name: "Recipe request: Make chickpea soup",
  });
  expect(within(rejected).getByText("Not started")).toBeTruthy();
  expect(within(rejected).queryByText(/Your recipe is queued/)).toBeNull();
  await waitFor(() => expect(readStatus).toHaveBeenCalled());
  expect(
    readStatus.mock.calls.every(
      ([id]) => id === "00000000-0000-4000-8000-000000000001",
    ),
  ).toBe(true);
  fireEvent.click(
    within(rejected).getByRole("button", { name: "Edit and try again" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox")).toHaveProperty(
      "value",
      "Make chickpea soup",
    ),
  );
  expect(readImportQueue(importDraftKey("viewer"))).toHaveLength(1);
  expect(selectHousehold).toHaveBeenCalledWith(
    "00000000-0000-4000-8000-000000000003",
  );
  expect(
    screen.getByRole("article", { name: "Recipe request: Make lemon pasta" }),
  ).toBeTruthy();
});

it("does not overwrite text entered while returning a rejected request to the composer", async () => {
  createImport.mockRejectedValue(
    Object.assign(new Error("Your queue is full."), {
      data: { code: "TOO_MANY_REQUESTS" },
    }),
  );
  let finishDiscard: (() => void) | undefined;
  discardImport.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishDiscard = resolve;
      }),
  );
  showComposer();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Edit and try again" }),
    ).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit and try again" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Keep this new draft" },
  });
  await waitFor(() => expect(discardImport).toHaveBeenCalledOnce());
  if (!finishDiscard) throw new Error("Discard did not start");
  finishDiscard();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Dismiss" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "Keep this new draft",
  );
  expect(readImportQueue(importDraftKey("viewer"))).toHaveLength(1);
});

it("shows the full submitted prompt in a dialog without changing the current draft", async () => {
  const input = `Make a soup.\n${"Use chickpeas and spinach. ".repeat(30)}`;
  writeImportQueue(importDraftKey("viewer"), [
    { id: "00000000-0000-4000-8000-000000000001", input, householdId: null },
  ]);
  createImport.mockResolvedValue({
    kind: "queued",
    id: "00000000-0000-4000-8000-000000000001",
  });
  readStatus.mockImplementation(() => createImport.mock.results[0]?.value);
  showComposer();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "The next recipe" },
  });
  fireEvent.click(screen.getByRole("button", { name: "View input" }));
  const dialog = screen.getByRole("dialog", { name: "Submitted input" });
  expect(dialog.querySelector(".import-input-content")?.textContent).toBe(
    input.trim(),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "The next recipe",
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "View input" }),
    ),
  );
});

it("preserves the composer input and sends nothing if durable queue storage fails", async () => {
  sessionStorage.clear();
  showComposer();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Keep my pasta recipe" },
  });
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage full");
    });
  fireEvent.click(screen.getByRole("button", { name: "Make a recipe" }));
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "Keep my pasta recipe",
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Couldn't save the recipe queue",
  );
  expect(createImport).not.toHaveBeenCalled();
  storage.mockRestore();
});

it("asks for photos again when a reload lost them before admission", async () => {
  writeImportQueue(importDraftKey("viewer"), [
    {
      id: "00000000-0000-4000-8000-000000000001",
      input: "",
      householdId: null,
      photoCount: 2,
    },
  ]);
  showComposer();

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Photos weren't sent. Add them again.",
    ),
  );
  expect(screen.getByRole("heading", { name: "2 photos" })).toBeTruthy();
  expect(createImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() =>
    expect(discardImport).toHaveBeenCalledWith(
      { id: "00000000-0000-4000-8000-000000000001", kind: "photo" },
      expect.anything(),
    ),
  );
});

it("sends picked photos without text and keeps only their count in storage", async () => {
  sessionStorage.clear();
  const send = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(
      (init.body as FormData).get("request") as string,
    );
    return Response.json({ kind: "queued", id: request.id });
  });
  vi.stubGlobal("fetch", send);
  vi.stubGlobal("createImageBitmap", async () => ({
    width: 3200,
    height: 2400,
    close: vi.fn(),
  }));
  URL.createObjectURL = () => "blob:thumbnail";
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) =>
    done(new Blob(["jpeg"], { type: "image/jpeg" })),
  );
  try {
    showComposer();
    const sendButton = screen.getByRole("button", { name: "Make a recipe" });
    expect(sendButton).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Add recipe photos"), {
      target: {
        files: [
          new File(["a"], "page-1.jpg", { type: "image/jpeg" }),
          new File(["b"], "page-2.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "Photos to import" }),
        ).getAllByRole("img"),
      ).toHaveLength(2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
    await waitFor(() => expect(sendButton).toHaveProperty("disabled", false));
    fireEvent.click(sendButton);

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const form = send.mock.calls[0]?.[1].body as FormData;
    expect(form.getAll("photo")).toHaveLength(1);
    expect(createImport).not.toHaveBeenCalled();
    expect(readImportQueue(importDraftKey("viewer"))).toEqual([
      expect.objectContaining({ input: "", photoCount: 1 }),
    ]);
    expect(screen.queryByRole("list", { name: "Photos to import" })).toBeNull();
    expect(screen.getByRole("heading", { name: "1 photo" })).toBeTruthy();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("lets phones pick any image or take a photo with one input", () => {
  showComposer();
  expect(
    screen.getByLabelText("Add recipe photos").getAttribute("accept"),
  ).toBe("image/*");
});
