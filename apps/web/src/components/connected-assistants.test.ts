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
import { ConnectedAssistants } from "./connected-assistants";

const calls = vi.hoisted(() => ({
  list: vi.fn(),
  client: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    oauth2: { getConsents: calls.list, publicClient: calls.client },
    $fetch: calls.disconnect,
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: string }) =>
    createElement("a", { href: to }, children),
}));
beforeEach(() => {
  calls.list.mockResolvedValue({
    data: [{ id: "consent-one", clientId: "client-one" }],
  });
  calls.client.mockResolvedValue({ data: { client_name: "Test assistant" } });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConnectedAssistants),
    ),
  );
}
it("keeps a failed disconnect visible and lets the user retry", async () => {
  calls.disconnect
    .mockResolvedValueOnce({ error: { message: "offline" } })
    .mockResolvedValueOnce({ data: { success: true } });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Disconnect Test assistant" }),
  );
  await screen.findByText("Couldn't disconnect this assistant. Try again.");
  expect(screen.getByText("Test assistant")).toBeTruthy();
  expect(calls.disconnect).toHaveBeenCalledWith("/mcp/disconnect", {
    method: "POST",
    body: { id: "consent-one" },
  });
  calls.list.mockResolvedValue({ data: [] });
  fireEvent.click(
    screen.getByRole("button", { name: "Disconnect Test assistant" }),
  );
  await screen.findByText("No assistants connected.", { exact: false });
  expect(screen.queryByText("Test assistant")).toBeNull();
});
it("disables duplicate actions while the disconnect request is pending", async () => {
  let finish: (value: object) => void = () => {};
  calls.disconnect.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mount();
  const button = await screen.findByRole("button", {
    name: "Disconnect Test assistant",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(calls.disconnect).toHaveBeenCalledTimes(1));
  expect(button.hasAttribute("disabled")).toBe(true);
  finish({ data: { success: true } });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
});
