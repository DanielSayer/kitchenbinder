import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import type { MealInput } from "@prep-sheet/db/meal-planner";
import { user } from "@prep-sheet/db/schema/auth";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "./context";
import { sampleRecipe } from "./recipes/fixtures";
import { appRouter } from "./routers";

const ownerId = randomUUID();
const otherId = randomUUID();
const recipeId = randomUUID();
const outsiderId = randomUUID();
const sharedId = randomUUID();
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Planner test",
      email: `${id}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: randomUUID(),
      token: randomUUID(),
      userId: id,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
  return appRouter.createCaller({ auth: null, session });
}
const owner = caller(ownerId);
const other = caller(otherId);
const outsider = caller(outsiderId);
const meal: Extract<MealInput, { kind: "recipe" }> = {
  id: randomUUID(),
  kind: "recipe",
  date: "2026-09-21",
  slot: "Dinner",
  recipeId,
  baseServings: 2,
  cook: 4,
  eat: 2,
};
const coverage = {
  shoppingDate: "2026-09-19",
  start: "2026-09-20",
  end: "2026-09-25",
};
async function save(value: MealInput) {
  await owner.planner.save({
    meal: value,
    revision: (await owner.planner.get()).revision,
  });
}
async function generate(replace = false) {
  const preview = await owner.planner.preview({ coverage, replace });
  await owner.planner.applyTrip({ coverage, replace, token: preview.token });
  return preview;
}
describe("personal meal planner with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      [ownerId, otherId, outsiderId].map((id) => ({
        id,
        name: "Planner test",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(recipe).values({
      id: recipeId,
      userId: ownerId,
      title: "Curry",
      origin: "manual",
      content: { ...sampleRecipe, ingredients: ["200 g rice", "1 onion"] },
    });
  });
  // Plans and lists cascade with their households; "Just me" is recreated lazily.
  beforeEach(async () => {
    await db
      .delete(household)
      .where(inArray(household.ownerId, [ownerId, otherId, outsiderId]));
  });
  afterAll(async () => {
    await db.delete(recipe).where(eq(recipe.id, recipeId));
    await db
      .delete(household)
      .where(inArray(household.ownerId, [ownerId, otherId, outsiderId]));
    await db
      .delete(user)
      .where(inArray(user.id, [ownerId, otherId, outsiderId]));
    await db.$client.end();
  });
  it("requires authentication, keeps plans private and checks recipe access", async () => {
    await expect(
      appRouter.createCaller({ auth: null, session: null }).planner.get(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      other.planner.save({ revision: 0, meal }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await save(meal);
    expect((await other.planner.get()).meals).toEqual([]);
    await other.planner.remove({ id: meal.id, revision: 0 });
    expect((await owner.planner.get()).meals).toHaveLength(1);
  });
  it("prevents lost updates between tabs", async () => {
    const results = await Promise.allSettled([
      owner.planner.save({ revision: 0, meal }),
      owner.planner.save({ revision: 0, meal: { ...meal, id: randomUUID() } }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await owner.planner.get()).meals).toHaveLength(1);
  });
  it("scales repeated cooking sessions and excludes leftovers and eating out", async () => {
    await save(meal);
    await save({ ...meal, id: randomUUID(), date: "2026-09-23" });
    await save({
      id: randomUUID(),
      date: "2026-09-22",
      slot: "Lunch",
      kind: "leftovers",
      sourceId: meal.id,
      portions: 2,
    });
    await save({
      id: randomUUID(),
      date: "2026-09-24",
      slot: "Dinner",
      kind: "out",
      description: "Dinner with friends",
    });
    await generate(true);
    const items = await owner.shopping.list();
    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.text === "400 g rice")).toHaveLength(2);
    expect(new Set(items.map((item) => item.plannedMealId)).size).toBe(2);
    expect((await owner.shopping.generated())?.content.groups).toHaveLength(2);
    expect((await owner.planner.get()).stale).toBe(false);
  });
  it("retains manual groceries and purchased quantities, adding only extra portions", async () => {
    const manualId = randomUUID();
    await owner.shopping.addItem({ id: manualId, text: "Dish soap" });
    await save(meal);
    await generate(true);
    const initial = await owner.shopping.list();
    const rice = initial.find((item) => item.text === "400 g rice");
    const onion = initial.find((item) => item.text === "2 onion");
    if (!rice || !onion) throw new Error("Missing ingredients");
    await owner.shopping.updateItem({
      id: rice.id,
      kind: "status",
      status: "bought",
    });
    await owner.shopping.updateItem({
      id: onion.id,
      kind: "status",
      status: "owned",
    });
    await save({ ...meal, cook: 6 });
    expect((await owner.planner.get()).stale).toBe(true);
    await expect(owner.shopping.generate()).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const plan = await owner.shopping.generated();
    if (!plan) throw new Error("Missing trip");
    await expect(
      owner.shopping.checkGroup({
        planId: plan.id,
        groupIndex: 0,
        bought: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await generate();
    const updated = await owner.shopping.list();
    expect(updated.find((item) => item.id === rice.id)?.status).toBe("bought");
    expect(updated.find((item) => item.id === onion.id)?.status).toBe("owned");
    expect(updated.find((item) => item.id === manualId)?.text).toBe(
      "Dish soap",
    );
    expect(
      updated
        .filter((item) => item.status === "needed")
        .map((item) => item.text),
    ).toEqual(expect.arrayContaining(["200 g rice", "1 onion"]));
    expect((await owner.shopping.generated())?.stale).toBe(false);
  });
  it("does not reset bought states or manual ingredient edits on unchanged meals", async () => {
    await save(meal);
    await generate(true);
    const item = (await owner.shopping.list())[0];
    if (!item) throw new Error("Missing ingredient");
    await owner.shopping.updateItem({
      id: item.id,
      kind: "text",
      text: "My preferred rice",
    });
    await save({ ...meal, date: "2026-09-23", slot: "Lunch" });
    expect((await owner.planner.get()).stale).toBe(false);
    await generate();
    expect(
      (await owner.shopping.list()).find((row) => row.id === item.id)?.text,
    ).toBe("My preferred rice");
  });
  it("remembers purchased portions after clearing bought items", async () => {
    await save(meal);
    await generate(true);
    const rice = (await owner.shopping.list()).find(
      (item) => item.text === "400 g rice",
    );
    if (!rice) throw new Error("Missing rice");
    await owner.shopping.updateItem({
      id: rice.id,
      kind: "status",
      status: "bought",
    });
    await owner.shopping.clear({ scope: "bought" });
    await generate();
    await save({ ...meal, cook: 6 });
    await generate();
    expect(
      (await owner.shopping.list())
        .filter((item) => item.text.includes("rice"))
        .map((item) => item.text),
    ).toEqual(["200 g rice"]);
  });
  it("rejects a stale preview when meals or shopping progress change", async () => {
    await save(meal);
    const first = await owner.planner.preview({ coverage, replace: true });
    await save({ ...meal, cook: 6 });
    await expect(
      owner.planner.applyTrip({ coverage, replace: true, token: first.token }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await owner.shopping.list()).toEqual([]);
    const second = await owner.planner.preview({ coverage, replace: true });
    await owner.shopping.addItem({ id: randomUUID(), text: "Soap" });
    await expect(
      owner.planner.applyTrip({ coverage, replace: true, token: second.token }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("flags broken leftovers and blocks generation until resolved", async () => {
    await save(meal);
    const leftover: MealInput = {
      id: randomUUID(),
      kind: "leftovers",
      sourceId: meal.id,
      date: "2026-09-22",
      slot: "Lunch",
      portions: 3,
    };
    await save(leftover);
    expect((await owner.planner.get()).issues).toHaveLength(1);
    await expect(generate(true)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await save({ ...leftover, portions: 2 });
    await generate(true);
    await owner.planner.remove({
      id: meal.id,
      revision: (await owner.planner.get()).revision,
    });
    expect((await owner.planner.get()).issues[0]?.message).toContain(
      "Choose a cooking session",
    );
  });
  it("removes only unbought meal ingredients when a meal leaves coverage", async () => {
    await save(meal);
    await generate(true);
    const item = (await owner.shopping.list())[0];
    if (!item) throw new Error("Missing ingredient");
    await owner.shopping.updateItem({
      id: item.id,
      kind: "status",
      status: "bought",
    });
    await save({ ...meal, date: "2026-10-01" });
    await generate();
    expect((await owner.shopping.list()).map((row) => row.id)).toEqual([
      item.id,
    ]);
    expect((await owner.planner.get()).stale).toBe(false);
  });
  it("allows an empty trip and clears its planner link when the list is reset", async () => {
    await generate(true);
    expect((await owner.shopping.generated())?.content.groups).toEqual([]);
    await owner.shopping.clear({ scope: "all" });
    expect((await owner.planner.get()).trip).toBeNull();
  });
  it("shares a plan and list per household and verifies membership", async () => {
    await db
      .insert(household)
      .values({ id: sharedId, name: "Family", ownerId: ownerId });
    await db.insert(householdMember).values([
      { householdId: sharedId, userId: ownerId },
      { householdId: sharedId, userId: otherId },
    ]);
    await owner.planner.save({ householdId: sharedId, revision: 0, meal });
    // The member sees the meal even without access to its recipe.
    expect(
      (await other.planner.get({ householdId: sharedId })).meals,
    ).toMatchObject([{ id: meal.id, title: "Curry" }]);
    expect((await owner.planner.get()).meals).toEqual([]);
    await expect(
      outsider.planner.get({ householdId: sharedId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.shopping.addItem({
        householdId: sharedId,
        id: randomUUID(),
        text: "Soap",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const preview = await other.planner.preview({
      householdId: sharedId,
      coverage,
      replace: true,
    });
    await other.planner.applyTrip({
      householdId: sharedId,
      coverage,
      replace: true,
      token: preview.token,
    });
    await other.shopping.addItem({
      householdId: sharedId,
      id: randomUUID(),
      text: "Soap",
    });
    const items = await owner.shopping.list({ householdId: sharedId });
    expect(items.map((item) => item.text).sort()).toEqual(
      ["2 onion", "400 g rice", "Soap"].sort(),
    );
    expect(new Set(items.map((item) => item.addedBy))).toEqual(
      new Set([otherId]),
    );
    expect(await owner.shopping.list()).toEqual([]);
    await owner.shopping.clear({ householdId: sharedId, scope: "all" });
    expect(await other.shopping.list({ householdId: sharedId })).toEqual([]);
  });
});
