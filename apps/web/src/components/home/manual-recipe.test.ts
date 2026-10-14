// @vitest-environment jsdom

import type { Context } from "@prep-sheet/api/context";
import { sampleRecipe } from "@prep-sheet/api/recipes/fixtures";
import { appRouter } from "@prep-sheet/api/routers/index";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  readDraftBase,
  readDraftRevision,
  readRecipeDraft,
  recipeDraftKey,
  recipeFields,
  writeRecipeDraft,
} from "../recipes/recipe-draft";
import { ManualRecipe } from "./manual-recipe";
import { readManualSubmission } from "./manual-submission";

const { ownerId, createManual, navigate, collection } = vi.hoisted(() => {
  // The wrapper validates the isolated DB URL. Allow the real server router inside jsdom.
  vi.stubEnv("SKIP_ENV_VALIDATION", "true");
  const collection: { groupId: string | null } = { groupId: null };
  return {
    ownerId: crypto.randomUUID(),
    createManual: vi.fn(),
    navigate: vi.fn(),
    collection,
  };
});
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: ownerId } } }),
  },
}));
vi.mock("@/utils/trpc", () => ({
  useTRPC: () => ({
    recipes: {
      createManual: {
        mutationOptions: (options: object) => ({
          mutationFn: createManual,
          ...options,
        }),
      },
      list: { queryKey: () => ["recipes"] },
    },
  }),
}));
vi.mock("../groups/collection-context", () => ({
  useCollection: () => ({ ...collection, available: true }),
  CollectionSelect: () => null,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
const now = new Date();
const session: Context["session"] = {
  user: {
    id: ownerId,
    name: "Manual client test",
    email: `${ownerId}@example.test`,
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
  },
  session: {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    userId: ownerId,
    expiresAt: new Date(Date.now() + 60000),
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
  },
};
const api = appRouter.createCaller({ auth: null, session });
const key = recipeDraftKey(ownerId);
const submissionKey = `${key}:submission`;
const clients: QueryClient[] = [];
beforeAll(async () => {
  await db.insert(user).values({
    id: ownerId,
    name: "Manual client test",
    email: `${ownerId}@example.test`,
  });
});
beforeEach(() => {
  sessionStorage.clear();
  collection.groupId = null;
  createManual
    .mockReset()
    .mockImplementation((input) => api.recipes.createManual(input));
  navigate.mockReset();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  writeRecipeDraft(key, recipeFields(sampleRecipe));
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.$client.query("DELETE FROM recipe WHERE user_id = $1", [ownerId]);
  await db.$client.query('DELETE FROM "user" WHERE id = $1', [ownerId]);
  await db.$client.end();
});
async function mount(expectedTitle = sampleRecipe.title) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const root = createRootRoute({
    component: () =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(ManualRecipe, { onCancel: () => {} }),
      ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(createElement(RouterProvider, { router }));
  await screen.findByLabelText("Recipe name");
  await waitFor(() =>
    expect(screen.getByLabelText("Recipe name")).toHaveProperty(
      "value",
      expectedTitle,
    ),
  );
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
}
async function loseResponse() {
  createManual.mockImplementationOnce(async (input) => {
    await api.recipes.createManual(input);
    throw new Error("Response lost");
  });
  submit();
  await screen.findByText("Response lost");
  const pending = readManualSubmission(submissionKey);
  if (!pending) throw new Error("Missing pending submission");
  return pending;
}

it("recovers an identical save after a lost response and reload with one recipe", async () => {
  await mount();
  const pending = await loseResponse();
  cleanup();
  await mount();
  submit();
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/recipes/$recipeId",
      params: { recipeId: pending.id },
    }),
  );
  expect(createManual.mock.calls[1]?.[0]).toEqual(pending);
  expect(readRecipeDraft(key)).toBeNull();
  expect(readManualSubmission(submissionKey)).toBeNull();
  expect(
    (await api.recipes.list()).items.filter(
      (recipe) => recipe.id === pending.id,
    ),
  ).toHaveLength(1);
});

it("preserves an edited retry and transfers it for review against the original save after remount", async () => {
  await mount();
  const pending = await loseResponse();
  fireEvent.change(screen.getByLabelText("Recipe name"), {
    target: { value: "Newer draft" },
  });
  cleanup();
  // A different editor changes the recipe after the uncertain create committed.
  await api.recipes.update({
    id: pending.id,
    expectedRevision: 1,
    content: { ...sampleRecipe, notes: "Other editor note" },
  });
  await mount("Newer draft");
  submit();
  await screen.findByText(/An earlier save may have completed/);
  expect(createManual).toHaveBeenCalledTimes(1);
  expect(readRecipeDraft(key)?.title).toBe("Newer draft");
  fireEvent.click(screen.getByRole("button", { name: "Recover earlier save" }));
  await screen.findByText(/Your earlier recipe was saved/);
  expect(createManual.mock.calls[1]?.[0]).toEqual(pending);
  expect(readRecipeDraft(key)?.title).toBe("Newer draft");
  expect(navigate).not.toHaveBeenCalled();
  const target = recipeDraftKey(ownerId, pending.id);
  writeRecipeDraft(target, {
    ...recipeFields(sampleRecipe),
    title: "Existing recipe draft",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review draft in saved recipe" }),
  );
  expect(readRecipeDraft(target)?.title).toBe("Existing recipe draft");
  expect(readRecipeDraft(key)?.title).toBe("Newer draft");
  writeRecipeDraft(target, null);
  fireEvent.click(
    screen.getByRole("button", { name: "Review draft in saved recipe" }),
  );
  expect(readRecipeDraft(target)?.title).toBe("Newer draft");
  expect(readDraftBase(target)).toEqual(recipeFields(sampleRecipe));
  expect(readDraftRevision(target)).toBe(1);
  expect((await api.recipes.get({ id: pending.id })).content.notes).toBe(
    "Other editor note",
  );
  expect(readRecipeDraft(key)).toBeNull();
});

it("retains the same request ID when the first request never reached the server", async () => {
  await mount();
  createManual.mockRejectedValueOnce(new Error("Offline before send"));
  submit();
  await screen.findByText("Offline before send");
  const pending = readManualSubmission(submissionKey);
  cleanup();
  await mount();
  submit();
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(createManual.mock.calls[1]?.[0]).toEqual(pending);
});

it("does not send a request without durable submission identity", async () => {
  await mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  submit();
  await screen.findByText(/could not retain the save ID/);
  expect(createManual).not.toHaveBeenCalled();
});

it("keeps newer in-memory fields when storage fails after an uncertain save", async () => {
  await mount();
  await loseResponse();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  fireEvent.change(screen.getByLabelText("Recipe name"), {
    target: { value: "Newer unstored draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Recover earlier save" }));
  await screen.findByText(/Your earlier recipe was saved/);
  expect(screen.getByLabelText("Recipe name")).toHaveProperty(
    "value",
    "Newer unstored draft",
  );
  expect(navigate).not.toHaveBeenCalled();
});
