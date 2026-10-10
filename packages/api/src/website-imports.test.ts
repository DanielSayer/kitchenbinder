import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { group, groupMember } from "@prep-sheet/db/schema/group";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray } from "drizzle-orm";
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
  recentImports,
  submitWebsiteImport,
} from "./imports";
import { sampleRecipe } from "./recipes/fixtures";
import { requireRecipeProvider } from "./recipes/generate";
import { checkRecipeUsage } from "./recipes/usage";

const account = randomUUID();
const input = () => ({
  id: randomUUID(),
  input: "Make lemon pasta",
  groupId: null,
});
const output = {
  content: sampleRecipe,
  tagIds: [],
  origin: "generated" as const,
  sourceUrl: null,
};

describe("website durable imports", () => {
  beforeAll(async () => {
    await db.insert(user).values({
      id: account,
      name: "Import test",
      email: `${account}@example.test`,
    });
    await db.insert(billingAccount).values({
      userId: account,
      status: "active",
      validUntil: new Date(Date.now() + 86400000),
    });
  });
  beforeEach(async () => {
    await db
      .delete(aiSpend)
      .where(
        inArray(
          aiSpend.importId,
          db
            .select({ id: recipeImport.id })
            .from(recipeImport)
            .where(eq(recipeImport.userId, account)),
        ),
      );
    await db.delete(recipeImport).where(eq(recipeImport.userId, account));
    await db.delete(recipe).where(eq(recipe.userId, account));
  });
  afterAll(async () => {
    await db
      .delete(aiSpend)
      .where(
        inArray(
          aiSpend.importId,
          db
            .select({ id: recipeImport.id })
            .from(recipeImport)
            .where(eq(recipeImport.userId, account)),
        ),
      );
    await db.delete(recipe).where(eq(recipe.userId, account));
    await db.delete(group).where(eq(group.ownerId, account));
    await db.delete(user).where(eq(user.id, account));
    await db.$client.end();
  });
  it("reserves once for concurrent submissions, rejects changed input and saves once", async () => {
    const item = input();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => submitWebsiteImport(account, item)),
    );
    expect(results.every((result) => result.kind === "queued")).toBe(true);
    expect(
      await db
        .select()
        .from(recipeImport)
        .where(eq(recipeImport.userId, account)),
    ).toHaveLength(1);
    await expect(
      submitWebsiteImport(account, { ...item, input: "Different dinner" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(importStatus(randomUUID(), item.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const generate = vi.fn().mockResolvedValue(output);
    await Promise.all([
      processNextImport(generate),
      processNextImport(generate),
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await submitWebsiteImport(account, item)).toMatchObject({
      kind: "saved",
      id: item.id,
    });
    const [saved] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, item.id));
    expect(saved).toMatchObject({ origin: "generated", sourceUrl: null });
  });
  it("recovers account jobs without request IDs and hides deleted recipe links", async () => {
    const item = input();
    await submitWebsiteImport(account, item);
    expect(await recentImports(randomUUID())).toEqual([]);
    expect(await recentImports(account)).toMatchObject([
      { id: item.id, state: "queued", recipeId: null },
    ]);
    await processNextImport(vi.fn().mockResolvedValue(output));
    expect(await recentImports(account)).toMatchObject([
      {
        id: item.id,
        state: "saved",
        recipeId: item.id,
        title: sampleRecipe.title,
      },
    ]);
    await db.delete(recipe).where(eq(recipe.id, item.id));
    expect(await recentImports(account)).toMatchObject([
      { id: item.id, state: "saved", recipeId: null, title: null },
    ]);
  });
  it("reports a durable queue wait across page reloads without claiming the job", async () => {
    const item = input();
    await submitWebsiteImport(account, item);
    await db
      .update(recipeImport)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(recipeImport.id, item.id));
    const status = await importStatus(account, item.id);
    expect(status).toMatchObject({
      kind: "queued",
      id: item.id,
      queuedForMs: expect.any(Number),
    });
    if (status.kind !== "queued") throw new Error("Expected a queued import");
    expect(status.queuedForMs).toBeGreaterThanOrEqual(60_000);
    const [job] = await db
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, item.id));
    expect(job?.startedAt).toBeNull();
  });
  it("hides completed recipe titles and links after group access is lost", async () => {
    const groupId = randomUUID();
    await db
      .insert(group)
      .values({ id: groupId, name: "Import collection", ownerId: account });
    await db.insert(groupMember).values({ groupId, userId: account });
    const item = { ...input(), groupId };
    await submitWebsiteImport(account, item);
    await processNextImport(vi.fn().mockResolvedValue(output));
    expect(await recentImports(account)).toMatchObject([
      { recipeId: item.id, title: sampleRecipe.title },
    ]);
    await db.delete(groupMember).where(eq(groupMember.groupId, groupId));
    expect(await recentImports(account)).toMatchObject([
      { state: "saved", recipeId: null, title: null },
    ]);
  });
  it("keeps old active imports ahead of a bounded recent history", async () => {
    const activeId = randomUUID();
    await db.insert(recipeImport).values([
      {
        id: activeId,
        userId: account,
        input: "",
        fingerprint: "active",
        createdAt: new Date(0),
      },
      ...Array.from({ length: 55 }, () => ({
        id: randomUUID(),
        userId: account,
        input: "",
        fingerprint: "failed",
        state: "failed" as const,
        error: "Could not read page",
      })),
    ]);
    const jobs = await recentImports(account);
    expect(jobs).toHaveLength(50);
    expect(jobs[0]).toMatchObject({ id: activeId, state: "queued" });
    expect(jobs[1]).toMatchObject({
      state: "failed",
      error: "Could not read page",
    });
  });
  it("atomically bounds the last daily reservation and retains it after deletion", async () => {
    await db.insert(recipeImport).values(
      Array.from({ length: 49 }, () => ({
        id: randomUUID(),
        userId: account,
        input: "",
        fingerprint: "spent",
        state: "failed" as const,
        createdAt: new Date(Date.now() - 120_000),
      })),
    );
    const outcomes = await Promise.allSettled([
      submitWebsiteImport(account, input()),
      submitWebsiteImport(account, input()),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await processNextImport(vi.fn().mockResolvedValue(output));
    await db.delete(recipe).where(eq(recipe.userId, account));
    await expect(
      db.transaction((tx) => checkRecipeUsage(tx, account)),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("limits pending jobs and concurrent claims across workers", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 7 }, () => submitWebsiteImport(account, input())),
    );
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(5);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      await gate;
      return output;
    });
    const workers = Array.from({ length: 5 }, () =>
      processNextImport(generate),
    );
    try {
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
      expect(await processNextImport(generate)).toBe(false);
    } finally {
      release();
      await Promise.all(workers);
    }
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("retains failed AI usage, never replays it, and releases a failed fetch", async () => {
    const item = input();
    await submitWebsiteImport(account, item);
    const generate = vi.fn().mockRejectedValue(new Error("provider failure"));
    await processNextImport(generate);
    expect(await submitWebsiteImport(account, item)).toMatchObject({
      kind: "failed",
    });
    await processNextImport(generate);
    expect(generate).toHaveBeenCalledTimes(1);
    const [failed] = await db
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, item.id));
    expect(failed?.usageReleased).toBe(false);
    const badUrl = { ...input(), input: "http://127.0.0.1/private" };
    await submitWebsiteImport(account, badUrl);
    await processNextImport(generate);
    const [unreadable] = await db
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, badUrl.id));
    expect(unreadable).toMatchObject({ state: "failed", usageReleased: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("releases AI usage when the provider is not configured", async () => {
    const item = input();
    await submitWebsiteImport(account, item);
    const generate = vi.fn().mockResolvedValue(output);

    await processNextImport(generate, () => requireRecipeProvider(""));

    expect(generate).not.toHaveBeenCalled();
    expect(await importStatus(account, item.id)).toMatchObject({
      kind: "failed",
      message: expect.not.stringContaining("OPENAI_API_KEY"),
    });
    const [failed] = await db
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, item.id));
    expect(failed?.usageReleased).toBe(true);
    expect(
      await db.select().from(aiSpend).where(eq(aiSpend.importId, item.id)),
    ).toHaveLength(0);
  });
  it("recovers saving without AI and blocks delayed requests after cancellation", async () => {
    const item = input();
    await submitWebsiteImport(account, item);
    await db
      .update(recipeImport)
      .set({ state: "ready", generated: output })
      .where(eq(recipeImport.id, item.id));
    const generate = vi.fn();
    await processNextImport(generate);
    expect(await importStatus(account, item.id)).toMatchObject({
      kind: "saved",
    });
    const cancelled = input();
    await discardWebsiteImport(account, cancelled);
    expect(await submitWebsiteImport(account, cancelled)).toMatchObject({
      kind: "failed",
    });
    await processNextImport(generate);
    expect(generate).not.toHaveBeenCalled();
  });
  it("expires an interrupted AI call without replaying it", async () => {
    const item = input();
    await submitWebsiteImport(account, item);
    await db
      .update(recipeImport)
      .set({ state: "processing", startedAt: new Date(Date.now() - 240_000) })
      .where(eq(recipeImport.id, item.id));
    const generate = vi.fn();
    await processNextImport(generate);
    expect(await submitWebsiteImport(account, item)).toMatchObject({
      kind: "failed",
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
