// @vitest-environment jsdom

import type { Context } from "@prep-sheet/api/context";
import { sampleRecipe } from "@prep-sheet/api/recipes/fixtures";
import { appRouter } from "@prep-sheet/api/routers/index";
import { db } from "@prep-sheet/db";
import type { Meal, MealInput } from "@prep-sheet/db/meal-planner";
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
  within,
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
import { initialMealDraft, readMealDraft } from "./meal-draft";
import { MealEditor } from "./meal-editor";

const { ownerId, getPlanner, saveMeal, close } = vi.hoisted(() => {
  // The wrapper validates the isolated DB URL. Allow the real server router inside jsdom.
  vi.stubEnv("SKIP_ENV_VALIDATION", "true");
  return {
    ownerId: crypto.randomUUID(),
    getPlanner: vi.fn(),
    saveMeal: vi.fn(),
    close: vi.fn(),
  };
});
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: ownerId } } }) },
}));
vi.mock("@/components/households/household-context", () => ({
  useHousehold: () => ({ householdId: null }),
}));
vi.mock("@/utils/trpc", () => ({
  useTRPC: () => ({
    collections: {
      list: {
        queryOptions: () => ({
          queryKey: ["collections", "list"],
          queryFn: async () => [],
        }),
      },
    },
    planner: {
      get: {
        queryOptions: () => ({
          queryKey: ["planner", "get"],
          queryFn: getPlanner,
        }),
      },
      save: {
        mutationOptions: (options: object) => ({
          mutationFn: saveMeal,
          ...options,
        }),
      },
      pathKey: () => ["planner"],
    },
    shopping: {
      recipes: {
        queryOptions: () => ({
          queryKey: ["shopping", "recipes"],
          queryFn: async () => ({ items: [], total: 0 }),
        }),
      },
      recipe: {
        queryOptions: ({ id }: { id: string }, options: object) => ({
          queryKey: ["shopping", "recipe", id],
          queryFn: async () => null,
          ...options,
        }),
      },
      pathKey: () => ["shopping"],
    },
  }),
}));
const recipeId = crypto.randomUUID();
const now = new Date();
const session: Context["session"] = {
  user: {
    id: ownerId,
    name: "Planner client test",
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
const meal: Meal = {
  id: crypto.randomUUID(),
  kind: "out",
  date: "2026-10-14",
  slot: "Dinner",
  description: "Original dinner",
};
const key = `meal-draft:${ownerId}:edit:${meal.id}`;
const clients: QueryClient[] = [];
beforeAll(async () => {
  await db.insert(user).values({
    id: ownerId,
    name: "Planner client test",
    email: `${ownerId}@example.test`,
  });
  await api.recipes.createManual({
    id: recipeId,
    content: sampleRecipe,
  });
});
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await db.$client.query(
    "DELETE FROM meal_planner WHERE household_id IN (SELECT id FROM household WHERE owner_id = $1)",
    [ownerId],
  );
  await api.planner.save({ revision: 0, meal });
  getPlanner.mockReset().mockImplementation(() => api.planner.get());
  saveMeal.mockReset().mockImplementation((input) => api.planner.save(input));
  close.mockReset();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.$client.query("DELETE FROM recipe WHERE user_id = $1", [ownerId]);
  await db.$client.query("DELETE FROM household WHERE owner_id = $1", [
    ownerId,
  ]);
  await db.$client.query('DELETE FROM "user" WHERE id = $1', [ownerId]);
  await db.$client.end();
});
async function otherTab(changes: Partial<Extract<MealInput, { kind: "out" }>>) {
  const state = await api.planner.get();
  const latest = state.meals.find((entry) => entry.id === meal.id);
  if (latest?.kind !== "out") throw new Error("Expected a meal out");
  await api.planner.save({
    revision: state.revision,
    meal: { ...latest, ...changes },
  });
}
async function mount(options: { cached?: boolean; meal?: Meal } = {}) {
  const state = await api.planner.get();
  const currentMeal =
    options.meal ?? state.meals.find((entry) => entry.id === meal.id) ?? meal;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  if (options.cached !== false) client.setQueryData(["planner", "get"], state);
  const root = createRootRoute({
    component: () =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(MealEditor, {
          date: currentMeal.date,
          meal: currentMeal,
          onClose: close,
        }),
      ),
  });
  render(
    createElement(RouterProvider, {
      router: createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ["/"] }),
      }),
    }),
  );
  await screen.findByRole("heading", { name: "Edit meal" });
  return client;
}
function changeDescription(value: string) {
  fireEvent.change(screen.getByLabelText("Note"), {
    target: { value },
  });
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save meal" }));
}
async function review() {
  await screen.findByRole("heading", { name: "Review changed meal" });
}
function chooseMine() {
  fireEvent.click(screen.getByRole("radio", { name: /My draft/ }));
}
function saveReviewed() {
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed meal" }));
}

it("keeps the original base through close and restore, requiring review of another tab's conflicting edit", async () => {
  await mount();
  changeDescription("My older draft");
  expect(readMealDraft(key)?.base).toEqual({
    kind: "known",
    revision: 1,
    meal,
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledOnce();
  cleanup();
  await otherTab({ description: "Other tab", date: "2026-10-16" });
  await mount();
  expect(screen.getByLabelText("Note")).toHaveProperty(
    "value",
    "My older draft",
  );
  save();
  await review();
  expect(saveMeal).not.toHaveBeenCalled();
  expect(readMealDraft(key)?.base).toMatchObject({ revision: 1 });
  expect(
    screen.getByRole("button", { name: "Save reviewed meal" }),
  ).toHaveProperty("disabled", true);
  chooseMine();
  saveReviewed();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  expect((await api.planner.get()).meals[0]).toMatchObject({
    description: "My older draft",
    date: "2026-10-16",
  });
  expect(saveMeal.mock.calls[0]?.[0]).toMatchObject({ revision: 2 });
  expect(readMealDraft(key)).toBeNull();
});

it("merges independent edits through the actual restored draft and request path", async () => {
  await mount();
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-17" },
  });
  cleanup();
  await otherTab({ description: "New saved description" });
  await mount();
  save();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect((await api.planner.get()).meals[0]).toMatchObject({
    date: "2026-10-17",
    description: "New saved description",
  });
  expect(saveMeal.mock.calls[0]?.[0]).toMatchObject({ revision: 2 });
  expect(
    screen.queryByRole("heading", { name: "Review changed meal" }),
  ).toBeNull();
});

it("recovers legacy drafts conservatively instead of blessing them with the current revision", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      ...initialMealDraft(meal.date, meal),
      description: "Legacy draft",
    }),
  );
  await otherTab({ description: "Fresh saved meal" });
  await mount();
  save();
  await waitFor(() =>
    expect(
      close.mock.calls.length > 0 ||
        screen.queryByRole("heading", { name: "Review changed meal" }),
    ).toBeTruthy(),
  );
  expect((await api.planner.get()).meals[0]).toMatchObject({
    description: "Fresh saved meal",
  });
  await review();
  expect(readMealDraft(key)?.base).toEqual({ kind: "unknown" });
  expect(saveMeal).not.toHaveBeenCalled();
  expect(
    screen.getByRole("radio", { name: /Saved meal Fresh saved meal/ }),
  ).toBeTruthy();
  chooseMine();
  saveReviewed();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect((await api.planner.get()).meals[0]).toMatchObject({
    description: "Legacy draft",
  });
});

it("requires fresh choices after another edit during review and repeated server conflicts", async () => {
  await mount();
  changeDescription("My draft");
  await otherTab({ description: "Saved version two" });
  save();
  await review();
  chooseMine();
  await otherTab({ description: "Saved version three" });
  saveReviewed();
  await screen.findByRole("radio", { name: /Saved meal Saved version three/ });
  expect(saveMeal).not.toHaveBeenCalled();
  expect(screen.getByRole("radio", { name: /My draft/ })).toHaveProperty(
    "checked",
    false,
  );
  for (const description of ["Racing version four", "Racing version five"]) {
    chooseMine();
    saveMeal.mockImplementationOnce(async (input) => {
      await otherTab({ description });
      return api.planner.save(input);
    });
    saveReviewed();
    await screen.findByText(/Your plan or shopping list changed/);
    await screen.findByRole("button", { name: "Save meal" });
    expect(close).not.toHaveBeenCalled();
    expect(readMealDraft(key)?.fields.description).toBe("My draft");
    save();
    await review();
    expect(screen.getByRole("radio", { name: /My draft/ })).toHaveProperty(
      "checked",
      false,
    );
    expect(
      screen.getByRole("radio", {
        name: new RegExp(`Saved meal ${description}`),
      }),
    ).toBeTruthy();
  }
  fireEvent.click(
    screen.getByRole("radio", { name: /Saved meal Racing version five/ }),
  );
  saveReviewed();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect((await api.planner.get()).meals[0]).toMatchObject({
    description: "Racing version five",
  });
});

it("keeps entered input and its base when a request fails, then restores both", async () => {
  await mount();
  changeDescription("Keep my draft");
  saveMeal.mockRejectedValueOnce(new Error("Offline"));
  save();
  await screen.findByText("Offline");
  expect(readMealDraft(key)?.fields.description).toBe("Keep my draft");
  cleanup();
  await otherTab({ description: "Other tab while offline" });
  await mount();
  save();
  await review();
  expect(readMealDraft(key)?.fields.description).toBe("Keep my draft");
  expect(saveMeal).toHaveBeenCalledTimes(1);
});

it("requires explicit recreation after the saved meal was deleted", async () => {
  await mount();
  changeDescription("Keep after deletion");
  cleanup();
  const state = await api.planner.get();
  await api.planner.remove({ revision: state.revision, id: meal.id });
  await mount();
  save();
  await review();
  expect(saveMeal).not.toHaveBeenCalled();
  expect(
    within(screen.getByRole("group", { name: "Deleted meal" })).getByText(
      "Recreate this meal",
    ),
  ).toBeTruthy();
  chooseMine();
  saveReviewed();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect((await api.planner.get()).meals[0]).toMatchObject({
    description: "Keep after deletion",
  });
});

it("merges separate cooking and eating edits after restoring the real recipe meal form", async () => {
  const cooking: MealInput = {
    id: meal.id,
    kind: "recipe",
    date: meal.date,
    slot: "Dinner",
    recipeId,
    baseServings: 2,
    cook: 4,
    eat: 2,
  };
  await api.planner.save({ revision: 1, meal: cooking });
  await mount();
  fireEvent.change(screen.getByLabelText("Cook"), { target: { value: "6" } });
  cleanup();
  await api.planner.save({ revision: 2, meal: { ...cooking, eat: 3 } });
  await mount();
  save();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect((await api.planner.get()).meals[0]).toMatchObject({
    kind: "recipe",
    cook: 6,
    eat: 3,
  });
  expect(saveMeal.mock.calls[0]?.[0]).toMatchObject({ revision: 3 });
});

it("reviews conflicting meal types as one choice and shows recipe names", async () => {
  await mount();
  changeDescription("My dinner out");
  cleanup();
  await api.planner.save({
    revision: 1,
    meal: {
      id: meal.id,
      kind: "recipe",
      date: meal.date,
      slot: "Dinner",
      recipeId,
      baseServings: 2,
      cook: 4,
      eat: 2,
    },
  });
  await mount();
  save();
  await review();
  expect(saveMeal).not.toHaveBeenCalled();
  const saved = screen.getByRole("radio", {
    name: new RegExp(`Saved meal.*${sampleRecipe.title}`),
  });
  fireEvent.click(saved);
  saveReviewed();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect((await api.planner.get()).meals[0]).toMatchObject({
    kind: "recipe",
    recipeId,
    cook: 4,
    eat: 2,
  });
});

it("keeps the older draft when a different tab edits and clears its own draft", async () => {
  await mount();
  changeDescription("Tab A unfinished dinner");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  const tabA = sessionStorage.getItem(key);
  if (!tabA) throw new Error("Tab A draft was not stored");
  cleanup();
  // Separate browser tabs have separate session storage. Run the second real form.
  sessionStorage.clear();
  close.mockClear();
  await mount();
  changeDescription("Tab B saved dinner");
  save();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(sessionStorage.getItem(key)).toBeNull();
  cleanup();
  sessionStorage.setItem(key, tabA);
  close.mockClear();
  await mount();
  expect(screen.getByLabelText("Note")).toHaveProperty(
    "value",
    "Tab A unfinished dinner",
  );
  save();
  await review();
  expect((await api.planner.get()).meals[0]).toMatchObject({
    description: "Tab B saved dinner",
  });
  expect(readMealDraft(key)?.base).toMatchObject({ revision: 1 });
  expect(saveMeal).toHaveBeenCalledTimes(1);
});
