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
      name: "Move meal test",
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
async function plan(date: string, slot: "" | "Dinner" = "Dinner") {
  const { mealId } = await owner.addMeal({ recipeId, date, slot });
  return mealId;
}
async function dates() {
  const { meals } = await owner.get();
  return Object.fromEntries(meals.map((meal) => [meal.id, meal.date]));
}

describe("planner.move with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: "Move meal test",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(recipe).values({
      id: recipeId,
      userId: ownerId,
      title: "Dal",
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

  it("moves a meal and keeps its slot and servings", async () => {
    const id = await plan("2026-11-26");
    const before = (await owner.get()).meals.find((meal) => meal.id === id);
    const result = await owner.move({
      moves: [{ id, from: "2026-11-26", to: "2026-11-25" }],
    });
    const saved = await owner.get();
    expect(result).toEqual({ revision: saved.revision });
    expect(saved.meals.find((meal) => meal.id === id)).toEqual({
      ...before,
      date: "2026-11-25",
    });
  });

  it("swaps two meals together, including into the past", async () => {
    const thursday = await plan("2026-11-26");
    const monday = await plan("2026-11-23");
    await owner.move({
      moves: [
        { id: thursday, from: "2026-11-26", to: "2026-11-23" },
        { id: monday, from: "2026-11-23", to: "2026-11-26" },
      ],
    });
    expect(await dates()).toEqual({
      [thursday]: "2026-11-23",
      [monday]: "2026-11-26",
    });
  });

  it("refuses a move from an outdated plan and changes nothing", async () => {
    const a = await plan("2026-11-26");
    const b = await plan("2026-11-27");
    const { revision } = await owner.get();
    await expect(
      owner.move({
        moves: [
          { id: a, from: "2026-11-26", to: "2026-11-27" },
          { id: b, from: "2026-11-24", to: "2026-11-26" },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const saved = await owner.get();
    expect(saved.revision).toBe(revision);
    expect(await dates()).toEqual({ [a]: "2026-11-26", [b]: "2026-11-27" });
  });

  it("reports a removed meal and repeated moves", async () => {
    const id = await plan("2026-11-26");
    await expect(
      owner.move({
        moves: [{ id: randomUUID(), from: "2026-11-26", to: "2026-11-27" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.move({
        moves: [
          { id, from: "2026-11-26", to: "2026-11-27" },
          { id, from: "2026-11-27", to: "2026-11-28" },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("flags leftovers moved before their cook", async () => {
    const cook = randomUUID();
    await owner.save({
      revision: (await owner.get()).revision,
      meal: {
        id: cook,
        kind: "recipe",
        recipeId,
        baseServings: 2,
        cook: 4,
        eat: 2,
        date: "2026-11-26",
        slot: "Dinner",
      },
    });
    const leftovers = randomUUID();
    await owner.save({
      revision: (await owner.get()).revision,
      meal: {
        id: leftovers,
        kind: "leftovers",
        sourceId: cook,
        portions: 1,
        date: "2026-11-28",
        slot: "",
      },
    });
    expect((await owner.get()).issues).toEqual([]);
    await owner.move({
      moves: [{ id: cook, from: "2026-11-26", to: "2026-11-29" }],
    });
    const saved = await owner.get();
    expect(saved.issues.map((issue) => issue.id)).toContain(leftovers);
    expect(saved.meals.find((meal) => meal.id === leftovers)).toMatchObject({
      sourceId: cook,
    });
  });

  it("can't move meals in another household", async () => {
    const id = await plan("2026-11-26");
    const { householdId } = await owner.get();
    await expect(
      other.move({
        householdId,
        moves: [{ id, from: "2026-11-26", to: "2026-11-27" }],
      }),
    ).rejects.toThrow();
    expect(await dates()).toEqual({ [id]: "2026-11-26" });
  });
});
