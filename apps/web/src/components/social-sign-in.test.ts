// @vitest-environment jsdom
import type { AppRouter } from "@prep-sheet/api/routers/index";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTRPCClient, httpLink } from "@trpc/client";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TRPCProvider } from "../utils/trpc";
import { LinkedAccounts } from "./linked-accounts";
import { type SignInProvider, SocialSignIn } from "./social-sign-in";

vi.mock("../lib/auth-client", () => ({
  authClient: {
    listAccounts: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));
afterEach(cleanup);

function harness(
  providers: SignInProvider[],
  options: {
    failing?: boolean;
    linkedAccounts?: boolean;
    pending?: SignInProvider;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSignIn = vi.fn();
  const trpcClient = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: "http://localhost/api/trpc",
        fetch: async () =>
          options.failing
            ? new Response("unavailable", { status: 503 })
            : Response.json({ result: { data: providers } }),
      }),
    ],
  });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(TRPCProvider, {
        trpcClient,
        queryClient,
        children: options.linkedAccounts
          ? createElement(LinkedAccounts)
          : createElement(SocialSignIn, {
              pending: options.pending ?? null,
              onSignIn,
            }),
      }),
    ),
  );
  return { onSignIn };
}

it.each<SignInProvider>(["google", "discord"])(
  "only offers configured %s sign-in and sends the selected provider",
  async (provider) => {
    const { onSignIn } = harness([provider]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const button = await screen.findByRole("button", {
      name: `Continue with ${provider === "google" ? "Google" : "Discord"}`,
    });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(button);
    expect(onSignIn).toHaveBeenCalledWith(provider);
  },
);

it("shows an unavailable state with no provider controls", async () => {
  harness([]);
  await screen.findByText(/Sign-in is temporarily unavailable/);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

it("provides a retry after configuration discovery fails", async () => {
  harness([], { failing: true });
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  expect(screen.queryByText(/Continue with/)).toBeNull();
});

it("prevents duplicate attempts while a configured provider is connecting", async () => {
  const { onSignIn } = harness(["google", "discord"], { pending: "google" });
  await screen.findByText("Connecting to Google...");
  for (const button of screen.getAllByRole("button")) fireEvent.click(button);
  expect(onSignIn).not.toHaveBeenCalled();
});

it("only offers linking for configured providers", async () => {
  harness(["discord"], { linkedAccounts: true });
  await screen.findByRole("button", { name: "Link Discord" });
  expect(screen.queryByRole("button", { name: "Link Google" })).toBeNull();
});
