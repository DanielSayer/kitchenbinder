// @vitest-environment jsdom

import type { AppRouter } from "@prep-sheet/api/routers/index";
import {
  type QueryKey,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
  createTRPCOptionsProxy,
  type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import { createElement, useState, useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { authClient } from "../lib/auth-client";
import { createQueryClient } from "../utils/query-client";
import { TRPCProvider, useTRPC } from "../utils/trpc";
import { AccountQueryBoundary } from "./account-query-boundary";
import {
  readRecipeDraft,
  recipeDraftKey,
  recipeFields,
  writeRecipeDraft,
} from "./recipes/recipe-draft";

vi.mock("../lib/auth-client", () => ({
  authClient: { useSession: vi.fn() },
}));

type SessionState = ReturnType<typeof authClient.useSession>;

function sessionState(id: string | null, pending = false): SessionState {
  const now = new Date();
  return {
    data: id
      ? {
          user: {
            id,
            name: id,
            email: `${id}@example.com`,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
          session: {
            id: `session-${id}`,
            userId: id,
            token: `token-${id}`,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: now,
            updatedAt: now,
          },
        }
      : null,
    isPending: pending,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function privateKeys(trpc: TRPCOptionsProxy<AppRouter>): QueryKey[] {
  return [
    trpc.planner.get.queryKey(),
    trpc.shopping.list.queryKey(),
    trpc.households.list.queryKey(),
    trpc.recipes.list.queryKey(),
  ];
}

async function harness({
  initial = sessionState("A"),
  stale = false,
  cached = true,
  response = (id: string, index: number) => Promise.resolve(`${id}-${index}`),
} = {}) {
  // jsdom has no viewport to scroll when the real router navigates.
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  let session = initial;
  const listeners = new Set<() => void>();
  vi.mocked(authClient.useSession).mockImplementation(() =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => session,
    ),
  );
  const queryClient = createQueryClient();
  const trpcClient = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: "http://localhost/api/trpc" })],
  });
  const trpc = createTRPCOptionsProxy({ client: trpcClient, queryClient });
  const keys = privateKeys(trpc);
  if (cached) {
    keys.forEach((key, index) => {
      queryClient.setQueryData(key, `A-${index}`, {
        updatedAt: stale ? Date.now() - 120_000 : Date.now(),
      });
    });
  }
  const root = createRootRouteWithContext<{
    queryClient: typeof queryClient;
    trpc: typeof trpc;
  }>()({
    component: () =>
      createElement(AccountQueryBoundary, { children: createElement(Page) }),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => createElement("p", null, "Home route"),
  });
  const other = createRoute({
    getParentRoute: () => root,
    path: "/privacy",
    component: () => createElement("p", null, "Privacy route"),
  });
  const router = createRouter({
    routeTree: root.addChildren([home, other]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient, trpc },
    Wrap: ({ children }) =>
      createElement(TRPCProvider, { trpcClient, queryClient, children }),
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  const renders: { account: string | null; data: (string | undefined)[] }[] =
    [];
  const clients = new Set<typeof queryClient>();
  const requests = vi.fn(response);

  function Page() {
    const { data } = authClient.useSession();
    const account = data?.user.id ?? null;
    clients.add(useQueryClient());
    const activeTrpc = useTRPC();
    const queries = useQueries({
      queries: privateKeys(activeTrpc).map((queryKey, index) => ({
        queryKey,
        queryFn: () => requests(account ?? "guest", index),
        enabled: !!account,
        retry: false,
      })),
    });
    const [draft] = useState(() =>
      readRecipeDraft(recipeDraftKey(account ?? "guest")),
    );
    renders.push({ account, data: queries.map((query) => query.data) });
    return createElement(
      "div",
      null,
      createElement("p", null, account ?? "Guest"),
      ...queries.map((query, index) =>
        createElement("p", { key: index }, query.data ?? "Loading"),
      ),
      createElement("p", null, draft?.title ?? "No draft"),
      createElement(Outlet),
    );
  }

  await router.load();
  const view = render(createElement(RouterProvider, { router }));

  return {
    view,
    queryClient,
    router,
    clients,
    keys,
    renders,
    requests,
    transition(next: SessionState) {
      act(() => {
        session = next;
        listeners.forEach((listener) => {
          listener();
        });
      });
    },
    async navigate() {
      await act(async () => {
        await router.navigate({ to: "/privacy" });
      });
    },
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each([false, true])(
  "isolates direct A to B transitions with stale cache = %s, including every render",
  async (stale) => {
    const b = deferred<string>();
    const app = await harness({
      stale,
      response: (id, index) =>
        id === "B" ? b.promise : Promise.resolve(`${id}-${index}`),
    });
    expect(screen.getByText("A-0")).toBeTruthy();
    app.transition(sessionState("B"));
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.queryByText("A-0")).toBeNull();
    expect(
      app.renders.filter((render) => render.account === "B"),
    ).not.toHaveLength(0);
    expect(
      app.renders
        .filter((render) => render.account === "B")
        .every((render) => render.data.every((value) => value === undefined)),
    ).toBe(true);
    expect(app.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(app.router.options.context.queryClient).not.toBe(app.queryClient);
    await act(async () => b.resolve("B-private"));
    await waitFor(() =>
      expect(screen.getAllByText("B-private")).toHaveLength(4),
    );
  },
);

it.each([false, true])(
  "retires A's fresh or stale cache through guest and B, stale = %s",
  async (stale) => {
    const app = await harness({ stale });
    app.transition(sessionState(null));
    expect(screen.getByText("Guest")).toBeTruthy();
    expect(screen.queryByText("A-0")).toBeNull();
    const guestClient = app.router.options.context.queryClient;
    app.transition(sessionState("B"));
    await screen.findByText("B-0");
    expect(app.router.options.context.queryClient).not.toBe(guestClient);
    expect(
      app.renders
        .filter((render) => render.account !== "A")
        .every((render) =>
          render.data.every((value) => !value?.startsWith("A-")),
        ),
    ).toBe(true);
    expect(app.clients.size).toBe(3);
  },
);

it("keeps same-account caches during session refresh and navigation", async () => {
  const app = await harness();
  app.transition({ ...sessionState("A"), isRefetching: true });
  await app.navigate();
  expect(screen.getByText("Privacy route")).toBeTruthy();
  expect(screen.getByText("A-0")).toBeTruthy();
  expect(app.requests).not.toHaveBeenCalled();
  expect(app.clients.size).toBe(1);
  expect(app.router.options.context.queryClient).toBe(app.queryClient);
});

it("does not mount authenticated queries until the initial session resolves", async () => {
  const app = await harness({
    initial: sessionState(null, true),
    cached: false,
  });
  expect(app.requests).not.toHaveBeenCalled();
  app.transition(sessionState("B"));
  await screen.findByText("B-0");
  expect(app.requests).toHaveBeenCalledTimes(4);
});

it("cancels A's queries and isolates late responses and old-client callbacks after B signs in", async () => {
  const a = deferred<string>();
  const b = deferred<string>();
  const app = await harness({
    cached: false,
    // This transport deliberately ignores the AbortSignal.
    response: (id) => (id === "A" ? a.promise : b.promise),
  });
  expect(app.queryClient.isFetching()).toBe(4);
  app.transition(sessionState("B"));
  const activeClient = app.router.options.context.queryClient;
  expect(app.queryClient.isFetching()).toBe(0);
  expect(app.queryClient.getQueryCache().getAll()).toHaveLength(0);
  await act(async () => {
    a.resolve("A-late-private");
    // An old mutation callback may still hold this retired client.
    app.queryClient.setQueryData(app.keys[0], "A-late-mutation");
  });
  expect(screen.queryByText("A-late-private")).toBeNull();
  expect(screen.queryByText("A-late-mutation")).toBeNull();
  expect(activeClient.getQueryData(app.keys[0])).toBeUndefined();
  await act(async () => b.resolve("B-private"));
  await waitFor(() => expect(screen.getAllByText("B-private")).toHaveLength(4));
  expect(
    app.renders
      .filter((render) => render.account === "B")
      .every((render) =>
        render.data.every((value) => !value?.startsWith("A-")),
      ),
  ).toBe(true);
});

it("remounts account state while preserving account-scoped saved drafts", async () => {
  const fields = recipeFields({
    title: "A saved draft",
    description: "",
    servings: null,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    ingredients: [],
    steps: [],
    notes: "",
  });
  writeRecipeDraft(recipeDraftKey("A"), fields);
  writeRecipeDraft(recipeDraftKey("B"), { ...fields, title: "B saved draft" });
  const app = await harness();
  expect(screen.getByText("A saved draft")).toBeTruthy();
  app.transition(sessionState("B"));
  expect(screen.queryByText("A saved draft")).toBeNull();
  expect(screen.getByText("B saved draft")).toBeTruthy();
  app.transition(sessionState("A"));
  expect(screen.getByText("A saved draft")).toBeTruthy();
  expect(app.clients.size).toBe(3);
});
