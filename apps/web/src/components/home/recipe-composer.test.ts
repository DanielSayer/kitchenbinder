// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importDraftKey, writePendingImport } from "./import-draft";
import { RecipeComposer } from "./recipe-composer";

const { createImport, discardImport, readStatus } = vi.hoisted(() => ({
  createImport: vi.fn(),
  discardImport: vi.fn(),
  readStatus: vi.fn(),
}));

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
      list: { queryKey: () => ["recipes"] },
    },
  }),
}));
vi.mock("../groups/collection-context", () => ({
  useCollection: () => ({
    groupId: null,
    available: true,
    groups: { data: [] },
  }),
  CollectionSelect: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: () => null,
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  writePendingImport(importDraftKey("viewer"), {
    id: "00000000-0000-4000-8000-000000000001",
    input: "Make lemon pasta",
    groupId: null,
  });
  readStatus.mockRejectedValue(
    Object.assign(new Error("Import not found."), {
      data: { code: "NOT_FOUND" },
    }),
  );
  discardImport.mockResolvedValue(undefined);
});

afterEach(cleanup);

function showComposer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
  const polls = readStatus.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 2200));
  expect(readStatus).toHaveBeenCalledTimes(polls);

  fireEvent.click(screen.getByRole("button", { name: "Edit and try again" }));
  await waitFor(() => expect(discardImport).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
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
  expect(screen.getByText(/Import reference:/).textContent).toContain(
    status.id,
  );
  expect(
    screen
      .getByRole("button", { name: "Working on it" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(createImport).toHaveBeenCalledTimes(1);
  expect(discardImport).not.toHaveBeenCalled();
});
