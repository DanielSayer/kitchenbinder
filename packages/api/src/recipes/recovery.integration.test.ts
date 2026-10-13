import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { group } from "@prep-sheet/db/schema/group";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { appRouter } from "../routers/index";
import { sampleRecipe } from "./fixtures";

const ownerId = randomUUID();
const memberId = randomUUID();
const outsiderId = randomUUID();
const users = [ownerId, memberId, outsiderId];
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Recovery test",
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

describe("recipe recovery with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      users.map((id) => ({
        id,
        name: "Recovery test",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(billingAccount).values(
      users.map((userId) => ({
        userId,
        status: "active",
        validUntil: new Date(Date.now() + 86400000),
      })),
    );
  });
  afterAll(async () => {
    await db.delete(group).where(inArray(group.ownerId, users));
    await db.delete(recipe).where(inArray(recipe.userId, users));
    await db.delete(user).where(inArray(user.id, users));
    await db.$client.end();
  });

  it("hides deleted recipes from normal operations and restores all original private metadata", async () => {
    const id = randomUUID();
    const tag = await owner.tags.create({ name: "Recovery tag" });
    await owner.recipes.createManual({
      id,
      groupId: null,
      content: sampleRecipe,
    });
    await owner.recipes.setFavourite({ id, isFavourite: true });
    await owner.recipes.setRating({ id, rating: 4 });
    await owner.recipes.setTag({ id, tagId: tag.id, selected: true });
    const entryId = randomUUID();
    await owner.recipes.saveCooking({
      id,
      entryId,
      cookedOn: "2026-09-01",
      note: "Keep this note",
    });
    await owner.recipes.delete({ id });
    expect((await owner.recipes.list()).items.some((r) => r.id === id)).toBe(
      false,
    );
    expect(
      (await owner.recipes.taggingList()).items.some((r) => r.id === id),
    ).toBe(false);
    expect(
      (await owner.shopping.recipes()).items.some((r) => r.id === id),
    ).toBe(false);
    for (const request of [
      () => owner.recipes.get({ id }),
      () =>
        owner.recipes.update({
          expectedRevision: 1,
          id,
          content: sampleRecipe,
        }),
      () => owner.recipes.copy({ id, newId: randomUUID(), groupId: null }),
      () => owner.recipes.setFavourite({ id, isFavourite: false }),
      () =>
        owner.recipes.setTags({
          recipeIds: [id],
          tagIds: [tag.id],
          operation: "remove",
        }),
      () => owner.shopping.addRecipes({ recipeIds: [id] }),
      () => outsider.recipes.restore({ id }),
    ])
      await expect(request()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await outsider.recipes.recentlyDeleted({ groupId: null })).toEqual(
      [],
    );
    const deleted = (
      await owner.recipes.recentlyDeleted({ groupId: null })
    ).find((r) => r.id === id);
    expect(deleted?.deletedByName).toBe("Recovery test");
    if (!deleted?.deletedAt || !deleted.expiresAt)
      throw new Error("Missing recovery dates");
    expect(deleted.expiresAt.getTime() - deleted.deletedAt.getTime()).toBe(
      30 * 86400000,
    );
    await expect(owner.recipes.delete({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const outcomes = await Promise.allSettled([
      owner.recipes.restore({ id }),
      owner.recipes.restore({ id }),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await owner.recipes.get({ id })).toMatchObject({
      id,
      content: sampleRecipe,
      isFavourite: true,
      rating: 4,
      tagIds: [tag.id],
      deletedAt: null,
      expiresAt: null,
      deletedBy: null,
    });
    expect(await owner.recipes.cookingHistory({ id })).toEqual([
      { id: entryId, cookedOn: "2026-09-01", note: "Keep this note" },
    ]);
    expect(
      (await owner.recipes.recentlyDeleted({ groupId: null })).some(
        (r) => r.id === id,
      ),
    ).toBe(false);
  });

  it("allows current group members to restore and rejects removed members and outsiders", async () => {
    const target = await owner.groups.create({ name: "Recovery group" });
    const invitation = await owner.groups.invite({ groupId: target.id });
    await member.groups.acceptInvite({ token: invitation.token });
    const id = randomUUID();
    await owner.recipes.createManual({
      id,
      groupId: target.id,
      content: sampleRecipe,
    });
    await owner.recipes.setRating({ id, rating: 5 });
    await member.recipes.setRating({ id, rating: 2 });
    await member.recipes.delete({ id });
    expect((await owner.recipes.list({ groupId: target.id })).items).toEqual(
      [],
    );
    expect(
      await owner.recipes.recentlyDeleted({ groupId: target.id }),
    ).toHaveLength(1);
    expect(
      (await owner.recipes.recentlyDeleted({ groupId: null })).some(
        (r) => r.id === id,
      ),
    ).toBe(false);
    await expect(
      outsider.recipes.recentlyDeleted({ groupId: target.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await member.recipes.restore({ id });
    expect((await member.recipes.get({ id })).rating).toBe(2);
    expect((await owner.recipes.get({ id })).rating).toBe(5);
    await owner.recipes.delete({ id });
    await owner.groups.removeMember({ groupId: target.id, userId: memberId });
    await expect(member.recipes.restore({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      member.recipes.recentlyDeleted({ groupId: target.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.recipes.restore({ id });
  });

  it("rejects expired restoration without removing the stored recipe", async () => {
    const id = randomUUID();
    await owner.recipes.createManual({
      id,
      groupId: null,
      content: sampleRecipe,
    });
    await owner.recipes.delete({ id });
    await db
      .update(recipe)
      .set({
        deletedAt: new Date(Date.now() - 31 * 86400000),
        expiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(recipe.id, id));
    await expect(owner.recipes.restore({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (await owner.recipes.recentlyDeleted({ groupId: null })).some(
        (r) => r.id === id,
      ),
    ).toBe(false);
    expect(
      await db.select().from(recipe).where(eq(recipe.id, id)),
    ).toHaveLength(1);
  });
});
