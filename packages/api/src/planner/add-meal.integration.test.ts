import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { household } from "@prep-sheet/db/schema/household";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { sampleRecipe } from "../recipes/fixtures";
import { appRouter } from "../routers";

const ownerId = randomUUID();
const otherId = randomUUID();
const recipeId = randomUUID();
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Add meal test",
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
  return appRouter.createCaller({ auth: null, session }).planner;
}
const owner = caller(ownerId);
const other = caller(otherId);
async function setServings(servings: string | null) {
  await db
    .update(recipe)
    .set({ content: { ...sampleRecipe, servings } })
    .where(eq(recipe.id, recipeId));
}
async function planned(id: string) {
  return (await owner.get()).meals.find((meal) => meal.id === id);
}

describe("planner.addMeal with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: "Add meal test",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(recipe).values({
      id: recipeId,
      userId: ownerId,
      title: "Curry",
      origin: "manual",
      content: sampleRecipe,
    });
  });
  beforeEach(async () => {
    await db
      .delete(household)
      .where(inArray(household.ownerId, [ownerId, otherId]));
  });
  afterAll(async () => {
    await db.delete(recipe).where(eq(recipe.id, recipeId));
    await db
      .delete(household)
      .where(inArray(household.ownerId, [ownerId, otherId]));
    await db.delete(user).where(inArray(user.id, [ownerId, otherId]));
    await db.$client.end();
  });

  it.each([
    { recipeServings: "Serves 6", base: 6, portions: 6, assumed: false },
    { recipeServings: "4 people", base: 4, portions: 4, assumed: false },
    { recipeServings: "4-6 servings", base: 4, portions: 4, assumed: false },
    { recipeServings: "12 cookies", base: 12, portions: 12, assumed: false },
    { recipeServings: null, base: 2, portions: 2, assumed: true },
    { recipeServings: "A crowd", base: 2, portions: 2, assumed: true },
    { recipeServings: "0", base: 2, portions: 2, assumed: true },
    { recipeServings: "101", base: 2, portions: 2, assumed: true },
    { recipeServings: "6", servings: 3, base: 6, portions: 3, assumed: false },
    {
      recipeServings: "6",
      baseServings: 5,
      base: 5,
      portions: 5,
      assumed: false,
    },
    {
      recipeServings: null,
      baseServings: 5,
      servings: 8,
      base: 5,
      portions: 8,
      assumed: false,
    },
  ])(
    "plans $recipeServings at base $base, portions $portions",
    async ({ recipeServings, base, portions, assumed, ...overrides }) => {
      await setServings(recipeServings);
      const result = await owner.addMeal({
        recipeId,
        date: "2026-11-18",
        ...overrides,
      });
      expect(result).toEqual({
        mealId: expect.any(String),
        revision: 1,
        baseServingsAssumed: assumed,
      });
      expect(await planned(result.mealId)).toMatchObject({
        kind: "recipe",
        recipeId,
        title: "Curry",
        slot: "",
        baseServings: base,
        cook: portions,
        eat: portions,
      });
    },
  );

  it("needs no revision and keeps other meals", async () => {
    await setServings("4");
    const first = await owner.addMeal({ recipeId, date: "2026-11-18" });
    const second = await owner.addMeal({
      recipeId,
      date: "2026-11-19",
      slot: "Lunch",
    });
    expect(second.revision).toBe(first.revision + 1);
    expect((await owner.get()).meals.map((meal) => meal.id)).toEqual([
      first.mealId,
      second.mealId,
    ]);
  });

  it("replays the same meal and keeps its base after recipe changes", async () => {
    await setServings("4");
    const id = randomUUID();
    const input = { id, recipeId, date: "2026-11-18", slot: "Dinner" as const };
    const added = await owner.addMeal(input);
    await setServings("Serves 8");
    expect(await owner.addMeal(input)).toEqual({
      mealId: id,
      revision: added.revision,
      baseServingsAssumed: false,
    });
    expect(await owner.addMeal({ ...input, baseServings: 4 })).toMatchObject({
      revision: added.revision,
    });
    expect((await owner.get()).revision).toBe(added.revision);
    expect(await planned(id)).toMatchObject({ baseServings: 4, cook: 4 });
  });

  it("rejects a reused ID for a different meal", async () => {
    await setServings("4");
    const id = randomUUID();
    await owner.addMeal({ id, recipeId, date: "2026-11-18" });
    for (const change of [
      { date: "2026-11-19" },
      { slot: "Lunch" as const },
      { servings: 3 },
      { baseServings: 6 },
      { recipeId: randomUUID() },
    ])
      await expect(
        owner.addMeal({ id, recipeId, date: "2026-11-18", ...change }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.get()).revision).toBe(1);
  });

  it("re-adds a removed meal on retry", async () => {
    await setServings("4");
    const input = { id: randomUUID(), recipeId, date: "2026-11-18" };
    const added = await owner.addMeal(input);
    await owner.remove({ id: input.id, revision: added.revision });
    await owner.addMeal(input);
    expect(await planned(input.id)).toMatchObject({ baseServings: 4 });
  });

  it("checks recipe access", async () => {
    await expect(
      other.addMeal({ recipeId, date: "2026-11-18" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.get()).meals).toEqual([]);
  });
});
