// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantGuide } from "../routes/mcp";

const state = vi.hoisted(() => ({ signedIn: false, copy: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: state.signedIn ? { user: { id: "free-user" } } : null,
    }),
  },
}));
vi.mock("@/functions/get-site-origin", () => ({
  getSiteOrigin: () => "http://localhost:3001",
}));
vi.mock("@/utils/trpc", () => ({
  useTRPC: () => ({
    billing: {
      status: {
        queryOptions: () => ({
          queryKey: ["billing"],
          queryFn: async () => ({ tier: "free" }),
        }),
      },
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => "http://localhost:3001",
  }),
  Link: ({ to, children }: { to: string; children: string }) =>
    createElement("a", { href: to }, children),
}));
beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: state.copy },
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  state.signedIn = false;
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AssistantGuide),
    ),
  );
}
it("keeps the connection URL available if copying fails, then supports a successful retry", async () => {
  state.copy
    .mockRejectedValueOnce(new Error("clipboard denied"))
    .mockResolvedValueOnce(undefined);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Copy connection link" }));
  await screen.findByText(
    "Couldn't copy the link. Select it above and copy it manually.",
  );
  expect(
    screen.getByDisplayValue("http://localhost:3001/api/mcp"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy connection link" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(state.copy).toHaveBeenLastCalledWith("http://localhost:3001/api/mcp");
});
it("switches client instructions and shows a free user's upgrade note", async () => {
  state.signedIn = true;
  mount();
  await screen.findByText(
    "You'll need to upgrade to Pro to use your assistant with Kitchenbinder.",
    { exact: false },
  );
  fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));
  expect(screen.getByText(/Add custom MCP server/)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "ChatGPT" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.queryByText("Choose Add, then Add custom connector."),
  ).toBeNull();
});
