import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe, recipeShare } from "@prep-sheet/db/schema/recipe";
import { recipeTag, tag } from "@prep-sheet/db/schema/tag";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  discardWebsiteImport,
  importStatus,
  processNextImport,
  submitWebsiteImport,
} from "./imports";
import { sampleRecipe } from "./recipes/fixtures";
import { checkRecipeUsage } from "./recipes/usage";

const owner = randomUUID();
const other = randomUUID();
const householdId = randomUUID();
const input = () => ({
  id: randomUUID(),
  input:
    "Soup. Ingredients: 1 onion, 500 ml water. Instructions: Chop the onion. Simmer in water for 20 minutes and serve.",
  householdId: null,
});
const generated = {
  recipes: [{ content: sampleRecipe, tagIds: [] as string[] }],
  sourceUrl: null,
  origin: "generated" as const,
};
describe("durable import concurrency and recovery with PostgreSQL", () => {
  beforeEach(async () => {
    // Each case gets a fresh admission window without changing daily accounting.
    await db
      .update(recipeImport)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(inArray(recipeImport.userId, [owner, other]));
  });
  beforeAll(async () => {
    await db.insert(user).values(
      [owner, other].map((id) => ({
        id,
        name: "Import test",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(billingAccount).values(
      [owner, other].map((userId) => ({
        userId,
        status: "active",
        validUntil: new Date(Date.now() + 86400000),
      })),
    );
    await db
      .insert(household)
      .values({ id: householdId, name: "Shared recipes", ownerId: owner });
    await db.insert(householdMember).values({ householdId, userId: owner });
  });
  afterAll(async () => {
    await db.delete(aiSpend).where(
      inArray(
        aiSpend.importId,
        db
          .select({ id: recipeImport.id })
          .from(recipeImport)
          .where(inArray(recipeImport.userId, [owner, other])),
      ),
    );
    await db
      .delete(household)
      .where(inArray(household.ownerId, [owner, other]));
    await db.delete(recipe).where(inArray(recipe.userId, [owner, other]));
    await db.delete(user).where(inArray(user.id, [owner, other]));
    await db.$client.end();
  });

  it("rejects sharing with a household the importer does not belong to", async () => {
    await expect(
      submitWebsiteImport(other, { ...input(), householdId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("shares with the household and keeps the recipe personal", async () => {
    const item = { ...input(), householdId };
    expect((await submitWebsiteImport(owner, item)).kind).toBe("queued");
    const progress = vi.fn(
      async (_stage: "fetching" | "generating" | "saving") => {},
    );
    await processNextImport(
      vi.fn().mockResolvedValue(generated),
      undefined,
      progress,
    );
    expect(progress.mock.calls.map(([stage]) => stage)).toEqual([
      "fetching",
      "generating",
      "saving",
    ]);
    expect(await importStatus(owner, item.id)).toMatchObject({
      kind: "saved",
      recipeId: item.id,
    });
    const [saved] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, item.id));
    expect(saved).toMatchObject({
      userId: owner,
      origin: "generated",
      sourceUrl: null,
    });
    expect(
      await db
        .select({ householdId: recipeShare.householdId })
        .from(recipeShare)
        .where(eq(recipeShare.recipeId, item.id)),
    ).toEqual([{ householdId }]);
    await db
      .delete(householdMember)
      .where(
        and(
          eq(householdMember.householdId, householdId),
          eq(householdMember.userId, owner),
        ),
      );
    expect((await importStatus(owner, item.id)).kind).toBe("saved");
    await db.insert(householdMember).values({ householdId, userId: owner });
  });
  it("saves every recipe from one import with the same placement", async () => {
    const item = { ...input(), householdId };
    await submitWebsiteImport(owner, item);
    const titles = ["Soup", "Bread", "Salad"];
    await processNextImport(
      vi.fn().mockResolvedValue({
        ...generated,
        origin: "imported",
        recipes: titles.map((title) => ({
          content: { ...sampleRecipe, title },
          tagIds: [],
        })),
      }),
    );
    const status = await importStatus(owner, item.id);
    if (status.kind !== "saved") throw new Error(`Import ${status.kind}`);
    expect(status.recipeId).toBe(item.id);
    expect(status.recipes.map((saved) => saved.title)).toEqual(titles);
    const ids = status.recipes.map((saved) => saved.id);
    expect(new Set(ids).size).toBe(3);
    expect(
      await db
        .select({ id: recipeShare.recipeId })
        .from(recipeShare)
        .where(inArray(recipeShare.recipeId, ids)),
    ).toHaveLength(3);
    const [job] = await db
      .select({ recipeIds: recipeImport.recipeIds })
      .from(recipeImport)
      .where(eq(recipeImport.id, item.id));
    expect(job?.recipeIds).toEqual(ids);
    // Deleting the first recipe leaves the rest reachable from the import.
    await db.delete(recipe).where(eq(recipe.id, item.id));
    expect(await importStatus(owner, item.id)).toMatchObject({
      kind: "saved",
      recipeId: ids[1],
      recipes: [{ title: "Bread" }, { title: "Salad" }],
    });
  });
  it("concurrent retries produce one AI call and one imported recipe with valid tags", async () => {
    const item = input();
    const tagId = randomUUID();
    const foreignTagId = randomUUID();
    await db.insert(tag).values([
      { id: tagId, userId: owner, name: "Import tag" },
      { id: foreignTagId, userId: other, name: "Private tag" },
    ]);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => submitWebsiteImport(owner, item)),
    );
    expect(results.every((result) => result.kind === "queued")).toBe(true);
    await expect(
      submitWebsiteImport(owner, { ...item, input: `${item.input} changed` }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitWebsiteImport(other, item)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(importStatus(other, item.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const generate = vi.fn().mockResolvedValue({
      ...generated,
      recipes: [{ content: sampleRecipe, tagIds: [tagId, foreignTagId] }],
    });
    await Promise.all([
      processNextImport(generate),
      processNextImport(generate),
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      item.input,
      expect.any(Array),
      undefined,
      [],
    );
    const [saved] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, item.id));
    expect(saved).toMatchObject({
      userId: owner,
      sourceUrl: null,
      origin: "generated",
      content: sampleRecipe,
    });
    expect(
      await db
        .select({ id: recipeTag.tagId })
        .from(recipeTag)
        .where(eq(recipeTag.recipeId, item.id)),
    ).toEqual([{ id: tagId }]);
    expect((await submitWebsiteImport(owner, item)).kind).toBe("saved");
    await processNextImport(generate);
    expect(generate).toHaveBeenCalledTimes(1);
    await db.delete(recipe).where(eq(recipe.id, item.id));
    expect((await submitWebsiteImport(owner, item)).kind).toBe("failed");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("rechecks membership immediately before saving", async () => {
    const item = { ...input(), householdId };
    await submitWebsiteImport(owner, item);
    const generate = vi.fn().mockImplementation(async () => {
      await db
        .delete(householdMember)
        .where(
          and(
            eq(householdMember.householdId, householdId),
            eq(householdMember.userId, owner),
          ),
        );
      return generated;
    });
    await processNextImport(generate);
    expect((await importStatus(owner, item.id)).kind).toBe("failed");
    expect(
      await db.select().from(recipe).where(eq(recipe.id, item.id)),
    ).toHaveLength(0);
    await db.insert(householdMember).values({ householdId, userId: owner });
  });
  it("recovers checkpointed output without AI, and never replays an interrupted AI call", async () => {
    const ready = input();
    const interrupted = input();
    await submitWebsiteImport(owner, ready);
    await submitWebsiteImport(owner, interrupted);
    await db
      .update(recipeImport)
      .set({
        state: "ready",
        generated: {
          recipes: [{ id: ready.id, content: sampleRecipe, tagIds: [] }],
          origin: "generated",
        },
        input: "",
      })
      .where(eq(recipeImport.id, ready.id));
    await db
      .update(recipeImport)
      .set({ state: "processing", startedAt: new Date(Date.now() - 240_000) })
      .where(eq(recipeImport.id, interrupted.id));
    const generate = vi.fn();
    await processNextImport(generate);
    await processNextImport(generate);
    expect(generate).not.toHaveBeenCalled();
    expect((await importStatus(owner, ready.id)).kind).toBe("saved");
    expect((await submitWebsiteImport(owner, interrupted)).kind).toBe("failed");
  });
  it("failures are terminal for their ID and do not spend AI again", async () => {
    const item = input();
    await submitWebsiteImport(other, item);
    const generate = vi
      .fn()
      .mockRejectedValue(new Error("private internal error"));
    await processNextImport(generate);
    const result = await submitWebsiteImport(other, item);
    expect(result.kind).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("private internal");
    await processNextImport(generate);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("reserves the remaining daily allowance atomically and counts it for website saves", async () => {
    await db.delete(recipeImport).where(eq(recipeImport.userId, other));
    await db.insert(recipeImport).values(
      Array.from({ length: 49 }, () => ({
        id: randomUUID(),
        userId: other,
        fingerprint: "spent",
        input: "",
        sourceUrl: null,
        state: "failed" as const,
        createdAt: new Date(Date.now() - 120_000),
      })),
    );
    const results = await Promise.allSettled([
      submitWebsiteImport(other, input()),
      submitWebsiteImport(other, input()),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await expect(
      db.transaction((tx) => checkRecipeUsage(tx, other)),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await processNextImport(vi.fn().mockResolvedValue(generated));
    await expect(
      db.transaction((tx) => checkRecipeUsage(tx, other)),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("limits new imports per minute while allowing identical retries", async () => {
    const item = input();
    await submitWebsiteImport(owner, item);
    for (let index = 0; index < 4; index++)
      await submitWebsiteImport(owner, input());
    await expect(submitWebsiteImport(owner, input())).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect((await submitWebsiteImport(owner, item)).kind).toBe("queued");
    for (let index = 0; index < 5; index++)
      await processNextImport(vi.fn().mockResolvedValue(generated));
  });
  it("tombstones a lost request before local reset so a late submission cannot import it", async () => {
    const item = input();
    await discardWebsiteImport(owner, item);
    expect((await submitWebsiteImport(owner, item)).kind).toBe("failed");
    const generate = vi.fn();
    await processNextImport(generate);
    expect(generate).not.toHaveBeenCalled();
    await expect(discardWebsiteImport(other, item)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("serializes discard against admission without losing an active request", async () => {
    const item = input();
    await submitWebsiteImport(owner, item);
    await expect(discardWebsiteImport(owner, item)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const generate = vi.fn().mockResolvedValue(generated);
    await processNextImport(generate);
    await discardWebsiteImport(owner, item);
    expect((await submitWebsiteImport(owner, item)).kind).toBe("saved");
    expect(generate).toHaveBeenCalledTimes(1);
    const race = input();
    await Promise.allSettled([
      discardWebsiteImport(owner, race),
      submitWebsiteImport(owner, race),
    ]);
    const raced = await importStatus(owner, race.id);
    expect(["queued", "failed"]).toContain(raced.kind);
    const racedGenerate = vi.fn().mockResolvedValue(generated);
    await processNextImport(racedGenerate);
    expect(racedGenerate).toHaveBeenCalledTimes(
      raced.kind === "queued" ? 1 : 0,
    );
  });
});
