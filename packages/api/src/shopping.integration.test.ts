import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { group, groupMember } from "@prep-sheet/db/schema/group";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./context";
import { sampleRecipe } from "./recipes/fixtures";
import { appRouter } from "./routers";

const ownerId = randomUUID();
const otherId = randomUUID();
const groupId = randomUUID();
const personalId = randomUUID();
const sharedId = randomUUID();
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Shopping test",
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
  return appRouter.createCaller({ auth: null, session }).shopping;
}
const owner = caller(ownerId);
const other = caller(otherId);

describe("personal shopping list with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: "Shopping test",
        email: `${id}@example.test`,
      })),
    );
    await db
      .insert(group)
      .values({ id: groupId, ownerId: otherId, name: "Shopping test group" });
    await db.insert(groupMember).values([
      { groupId, userId: ownerId },
      { groupId, userId: otherId },
    ]);
    await db.insert(recipe).values([
      {
        id: personalId,
        userId: ownerId,
        title: "Curry",
        origin: "manual",
        content: { ...sampleRecipe, ingredients: ["1 onion", "200 g rice"] },
      },
      {
        id: sharedId,
        groupId,
        userId: otherId,
        title: "Salad",
        origin: "manual",
        content: { ...sampleRecipe, ingredients: ["1 onion", "2 tomatoes"] },
      },
    ]);
  });
  afterAll(async () => {
    await db.delete(group).where(eq(group.id, groupId));
    await db.delete(recipe).where(eq(recipe.id, personalId));
    await db.delete(user).where(inArray(user.id, [ownerId, otherId]));
    await db.$client.end();
  });
  it("requires authentication and checks recipe access atomically", async () => {
    await expect(
      appRouter.createCaller({ auth: null, session: null }).shopping.list(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      other.addRecipes({ recipeIds: [sharedId, personalId] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await other.list()).toEqual([]);
    expect((await other.recipes()).items.map((row) => row.id)).not.toContain(
      personalId,
    );
  });
  it("copies original lines with attribution and prevents concurrent duplicate recipe additions", async () => {
    await Promise.all([
      owner.addRecipes({ recipeIds: [personalId, sharedId] }),
      owner.addRecipes({ recipeIds: [personalId] }),
    ]);
    const rows = await owner.list();
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.text === "1 onion")).toHaveLength(2);
    expect(rows.find((row) => row.recipeId === personalId)).toMatchObject({
      recipeTitle: "Curry",
      servings: sampleRecipe.servings,
      status: "needed",
    });
    expect(await other.list()).toEqual([]);
  });
  it("keeps updates private, validates text and preserves the original recipe", async () => {
    const item = (await owner.list()).find(
      (row) => row.recipeId === personalId,
    );
    if (!item) throw new Error("Missing fixture item");
    await expect(
      other.updateItem({ kind: "text", id: item.id, text: "Stolen" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await other.removeItem({ id: item.id });
    await expect(
      owner.updateItem({ kind: "text", id: item.id, text: " " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.updateItem({ kind: "text", id: item.id, text: "3 onions" });
    const [source] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, personalId));
    expect(source?.content.ingredients).toEqual(["1 onion", "200 g rice"]);
    await db
      .update(recipe)
      .set({
        title: "Changed curry",
        content: { ...sampleRecipe, ingredients: ["Different ingredient"] },
      })
      .where(eq(recipe.id, personalId));
    expect(
      (await owner.list()).find((row) => row.id === item.id),
    ).toMatchObject({ text: "3 onions", recipeTitle: "Curry" });
  });
  it("retries grocery additions safely and clears only bought items", async () => {
    const id = randomUUID();
    await owner.addItem({ id, text: "Milk" });
    await owner.addItem({ id, text: "Milk" });
    const recipeItem = (await owner.list()).find(
      (row) => row.recipeId === personalId,
    );
    if (!recipeItem) throw new Error("Missing fixture item");
    await owner.updateItem({
      kind: "status",
      id: recipeItem.id,
      status: "owned",
    });
    await owner.updateItem({ kind: "status", id, status: "bought" });
    await other.clear({ scope: "all" });
    expect(await owner.list()).toHaveLength(5);
    await owner.clear({ scope: "bought" });
    expect(await owner.list()).toHaveLength(4);
    expect(
      (await owner.list()).find((row) => row.id === recipeItem.id)?.status,
    ).toBe("owned");
    await owner.updateItem({
      kind: "status",
      id: recipeItem.id,
      status: "needed",
    });
    expect(
      (await owner.list()).find((row) => row.id === recipeItem.id)?.status,
    ).toBe("needed");
  });
  it("retains copied items after source deletion and resets the list", async () => {
    await db.delete(recipe).where(eq(recipe.id, personalId));
    expect(
      (await owner.list()).some(
        (row) => row.recipeId === personalId && row.recipeTitle === "Curry",
      ),
    ).toBe(true);
    await owner.clear({ scope: "all" });
    expect(await owner.list()).toEqual([]);
    await owner.addRecipes({ recipeIds: [sharedId] });
    expect(await owner.list()).toHaveLength(2);
  });
  it("generates private groups, excludes owned/bought items and synchronises checkboxes", async () => {
    await owner.clear({ scope: "all" });
    await expect(owner.generate()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const flourA = randomUUID();
    const flourB = randomUUID();
    const milk = randomUUID();
    const butter = randomUUID();
    await owner.addItem({ id: flourA, text: "200 g flour" });
    await owner.addItem({ id: flourB, text: "0.5 kg flour" });
    await owner.addItem({ id: milk, text: "1 litre milk" });
    await owner.addItem({ id: butter, text: "250g butter" });
    await owner.updateItem({ kind: "status", id: milk, status: "owned" });
    await owner.updateItem({ kind: "status", id: butter, status: "bought" });
    await owner.generate();
    const plan = await owner.generated();
    if (!plan) throw new Error("Missing generated list");
    expect(plan.stale).toBe(false);
    expect(plan.content.groups).toHaveLength(1);
    expect(plan.content.groups[0]?.itemIds.sort()).toEqual(
      [flourA, flourB].sort(),
    );
    expect(await other.generated()).toBeNull();
    await expect(
      other.checkGroup({ planId: plan.id, groupIndex: 0, bought: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await owner.checkGroup({ planId: plan.id, groupIndex: 0, bought: true });
    expect(
      (await owner.list())
        .filter((item) => item.id === flourA || item.id === flourB)
        .every((item) => item.status === "bought"),
    ).toBe(true);
    expect((await owner.generated())?.stale).toBe(false);
    await owner.checkGroup({ planId: plan.id, groupIndex: 0, bought: false });
    await owner.updateItem({ kind: "text", id: flourA, text: "300g flour" });
    expect((await owner.generated())?.stale).toBe(true);
    await expect(
      owner.checkGroup({ planId: plan.id, groupIndex: 0, bought: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await owner.generate();
    expect((await owner.generated())?.stale).toBe(false);
    await expect(
      owner.checkGroup({ planId: plan.id, groupIndex: 0, bought: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await owner.updateItem({ kind: "status", id: milk, status: "needed" });
    expect((await owner.generated())?.stale).toBe(true);
    await owner.clear({ scope: "all" });
    expect(await owner.generated()).toBeNull();
  });
});
