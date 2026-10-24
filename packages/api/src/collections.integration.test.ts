import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { recipe, recipeShare } from "@prep-sheet/db/schema/recipe";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./context";
import { sampleRecipe } from "./recipes/fixtures";
import { appRouter } from "./routers";

const ownerId = randomUUID();
const memberId = randomUUID();
const outsiderId = randomUUID();
const householdId = randomUUID();
const users = [ownerId, memberId, outsiderId];
const recipes = {
  first: randomUUID(),
  second: randomUUID(),
  third: randomUUID(),
  members: randomUUID(),
  private: randomUUID(),
};
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: `Collections ${id.slice(0, 4)}`,
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
const member = caller(memberId);
const outsider = caller(outsiderId);
const row = (id: string, userId: string, title: string) => ({
  id,
  userId,
  title,
  origin: "manual" as const,
  content: { ...sampleRecipe, title },
});

describe("collections with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      users.map((id) => ({
        id,
        name: `Collections ${id.slice(0, 4)}`,
        email: `${id}@example.test`,
      })),
    );
    await db
      .insert(household)
      .values({ id: householdId, ownerId, name: "Collections household" });
    await db.insert(householdMember).values([
      { householdId, userId: ownerId },
      { householdId, userId: memberId },
    ]);
    await db
      .insert(recipe)
      .values([
        row(recipes.first, ownerId, "First"),
        row(recipes.second, ownerId, "Second"),
        row(recipes.third, ownerId, "Third"),
        row(recipes.members, memberId, "Member's"),
        row(recipes.private, outsiderId, "Private"),
      ]);
    await db
      .insert(recipeShare)
      .values({ recipeId: recipes.members, householdId });
  });
  afterAll(async () => {
    await db.delete(household).where(inArray(household.ownerId, users));
    await db.delete(recipe).where(inArray(recipe.id, Object.values(recipes)));
    await db.delete(user).where(inArray(user.id, users));
    await db.$client.end();
  });

  it("creates, renames, orders and deletes personal collections", async () => {
    const dinners = await owner.collections.create({ name: "Dinners" });
    const bakes = await owner.collections.create({
      name: "Bakes",
      description: "Weekend",
    });
    await expect(
      owner.collections.create({ name: "DINNERS" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      member.collections.update({ collectionId: dinners.id, name: "Mine" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.collections.update({
      collectionId: dinners.id,
      description: "Weeknights",
    });
    await owner.collections.reorder({ collectionIds: [bakes.id, dinners.id] });
    expect(
      (await owner.collections.list()).map((item) => [item.name, item.isOwner]),
    ).toEqual([
      ["Bakes", true],
      ["Dinners", true],
    ]);
    await expect(
      owner.collections.reorder({ collectionIds: [bakes.id] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await owner.collections.delete({ collectionId: bakes.id });
    expect(
      await owner.collections.get({ collectionId: dinners.id }),
    ).toMatchObject({
      name: "Dinners",
      description: "Weeknights",
      recipeCount: 0,
      owner: { id: ownerId },
      sharedWith: [],
    });
  });

  it("orders recipes, accepts any accessible recipe and lists by collection", async () => {
    const { id: collectionId } = await owner.collections.create({
      name: "Ordered",
    });
    await owner.collections.addRecipes({
      collectionId,
      recipeIds: [recipes.second, recipes.first, recipes.members],
    });
    await owner.collections.addRecipes({
      collectionId,
      recipeIds: [recipes.third, recipes.first],
    });
    await expect(
      owner.collections.addRecipes({
        collectionId,
        recipeIds: [recipes.private],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ordered = async () =>
      (await owner.recipes.list({ collectionId, sort: "position" })).items.map(
        (item) => item.title,
      );
    expect(await ordered()).toEqual(["Second", "First", "Member's", "Third"]);
    await owner.collections.reorderRecipes({
      collectionId,
      recipeIds: [recipes.third, recipes.first],
    });
    expect(await ordered()).toEqual(["Third", "First", "Second", "Member's"]);
    await owner.collections.removeRecipes({
      collectionId,
      recipeIds: [recipes.second],
    });
    expect(await ordered()).toEqual(["Third", "First", "Member's"]);
    expect(
      (await owner.recipes.get({ id: recipes.first })).collectionIds,
    ).toContain(collectionId);
    await expect(outsider.recipes.list({ collectionId })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  it("shares collections with households, exposing only the owner's recipes", async () => {
    const { id: collectionId } = await owner.collections.create({
      name: "Shared",
    });
    await owner.collections.addRecipes({
      collectionId,
      recipeIds: [recipes.first, recipes.members],
    });
    const personal = (await owner.households.list()).find(
      (item) => item.personal,
    );
    if (!personal) throw new Error("Missing personal household");
    await expect(
      owner.collections.share({ collectionId, householdId: personal.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      member.collections.share({ collectionId, householdId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.collections.share({ collectionId, householdId });
    const seen = (await member.collections.list()).find(
      (item) => item.id === collectionId,
    );
    expect(seen).toMatchObject({
      isOwner: false,
      owner: { id: ownerId },
      recipeCount: 2,
      sharedWith: [{ id: householdId }],
    });
    // Outsiders join the household: they see the owner's recipe, not the member's.
    await db
      .insert(householdMember)
      .values({ householdId, userId: outsiderId });
    const view = await outsider.recipes.list({ collectionId });
    expect(view.items.map((item) => item.title).sort()).toEqual([
      "First",
      "Member's",
    ]);
    await db
      .delete(recipeShare)
      .where(inArray(recipeShare.recipeId, [recipes.members]));
    expect(
      (await outsider.recipes.list({ collectionId })).items.map(
        (item) => item.title,
      ),
    ).toEqual(["First"]);
    expect((await outsider.collections.get({ collectionId })).recipeCount).toBe(
      1,
    );
    await owner.collections.unshare({ collectionId, householdId });
    await expect(
      outsider.collections.get({ collectionId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.recipes.get({ id: recipes.first }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
