import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { household } from "@prep-sheet/db/schema/household";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { providerConfiguration } from "@prep-sheet/env/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { submitWebsiteImport } from "../imports";
import { sampleRecipe } from "../recipes/fixtures";
import { appRouter } from "../routers";
import { pricing } from "./policy";
import { checkAiAllowance, reserveAiSpend, usageSummary } from "./usage";

const ids: string[] = [];
const spendIds: string[] = [];
let id: string;
function caller(userId: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id: userId,
      name: "Billing test",
      email: `${userId}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: randomUUID(),
      token: randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
  return appRouter.createCaller({ auth: null, session });
}
const manual = () => ({
  id: randomUUID(),
  content: sampleRecipe,
  householdId: null,
});
const ai = () => ({
  id: randomUUID(),
  input: "Make a soup with onions and lentils",
  householdId: null,
});
async function pro(userId: string, status = "active") {
  await db
    .insert(billingAccount)
    .values({ userId, status, validUntil: new Date(Date.now() + 86400000) })
    .onConflictDoUpdate({
      target: billingAccount.userId,
      set: { status, validUntil: new Date(Date.now() + 86400000) },
    });
}

describe("billing enforcement with PostgreSQL", () => {
  beforeEach(async () => {
    id = randomUUID();
    ids.push(id);
    await db
      .insert(user)
      .values({ id, name: "Billing test", email: `${id}@example.test` });
  });
  afterAll(async () => {
    await db.delete(household).where(inArray(household.ownerId, ids));
    await db.delete(recipe).where(inArray(recipe.userId, ids));
    await db.delete(user).where(inArray(user.id, ids));
    if (spendIds.length)
      await db.delete(aiSpend).where(inArray(aiSpend.importId, spendIds));
    await db.$client.end();
  });
  it("keeps manual saves available with AI and billing disabled while rejecting new AI without usage or spend", async () => {
    const enabled = providerConfiguration.aiEnabled;
    try {
      providerConfiguration.aiEnabled = false;
      const api = caller(id);
      const item = manual();
      await expect(api.recipes.createManual(item)).resolves.toMatchObject({
        id: item.id,
      });
      await expect(submitWebsiteImport(id, ai())).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(
        await db.select().from(recipeImport).where(eq(recipeImport.userId, id)),
      ).toHaveLength(0);
      expect((await usageSummary(db, id)).used).toBe(0);
      expect(await api.billing.status()).toMatchObject({
        available: false,
        pricing: { ai: { enabled: false } },
      });
    } finally {
      providerConfiguration.aiEnabled = enabled;
    }
  });

  it("admits exactly ten concurrent manual saves and permits retrying the tenth", async () => {
    const api = caller(id);
    const inputs = Array.from({ length: 12 }, manual);
    const results = await Promise.allSettled(
      inputs.map((input) => api.recipes.createManual(input)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const saved = results.find((r) => r.status === "fulfilled");
    if (saved?.status !== "fulfilled")
      throw new Error("Expected a saved recipe");
    await expect(
      api.recipes.createManual({ ...manual(), id: saved.value.id }),
    ).resolves.toMatchObject({ id: saved.value.id });
  });
  it("shares capacity between pending AI, manual entry, copies and restores", async () => {
    const api = caller(id);
    const item = await api.recipes.createManual(manual());
    await api.recipes.delete({ id: item.id });
    await Promise.all(
      Array.from({ length: 9 }, () => api.recipes.createManual(manual())),
    );
    await submitWebsiteImport(id, ai());
    await expect(api.recipes.restore({ id: item.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const [source] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.userId, id));
    if (!source) throw new Error("Missing test recipe");
    await expect(
      api.recipes.copy({ id: source.id, newId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.recipes.createManual(manual())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("atomically reserves three lifetime Free credits", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => submitWebsiteImport(id, ai())),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    await db
      .update(recipeImport)
      .set({ state: "failed", createdAt: new Date(Date.now() - 120000) })
      .where(eq(recipeImport.userId, id));
    await db.delete(recipe).where(eq(recipe.userId, id));
    await expect(submitWebsiteImport(id, ai())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("restores remaining Free credits on downgrade without resetting them", async () => {
    await submitWebsiteImport(id, ai());
    await db
      .update(recipeImport)
      .set({ state: "failed", createdAt: new Date(Date.now() - 120000) })
      .where(eq(recipeImport.userId, id));
    await pro(id);
    await submitWebsiteImport(id, ai());
    expect(await usageSummary(db, id)).toMatchObject({
      bucket: "pro",
      used: 1,
    });
    await db
      .update(billingAccount)
      .set({ validUntil: new Date(0) })
      .where(eq(billingAccount.userId, id));
    expect(await usageSummary(db, id)).toMatchObject({
      bucket: "free",
      used: 1,
      credits: 3,
    });
  });
  it("does not reset trial allowance across subscriptions", async () => {
    await pro(id, "trialing");
    await Promise.all(
      Array.from({ length: 3 }, () => submitWebsiteImport(id, ai())),
    );
    await db
      .update(recipeImport)
      .set({ state: "failed", createdAt: new Date(Date.now() - 120000) })
      .where(eq(recipeImport.userId, id));
    await pro(id, "trialing");
    await expect(submitWebsiteImport(id, ai())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("caps monthly Pro credits even when the daily window has cleared", async () => {
    await pro(id);
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    await db.insert(recipeImport).values(
      Array.from({ length: 50 }, () => ({
        id: randomUUID(),
        userId: id,
        input: "",
        fingerprint: "spent",
        usageBucket: "pro" as const,
        state: "failed" as const,
        createdAt: start,
      })),
    );
    await expect(
      db.transaction((tx) => checkAiAllowance(tx, id)),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const previousMonth = new Date(start.getTime() - 2 * 86400000);
    await db
      .update(recipeImport)
      .set({ createdAt: previousMonth })
      .where(eq(recipeImport.userId, id));
    expect(await usageSummary(db, id)).toMatchObject({
      bucket: "pro",
      used: 0,
    });
    await expect(submitWebsiteImport(id, ai())).resolves.toMatchObject({
      kind: "queued",
    });
  });
  it("blocks only new recipes after downgrade and keeps editing and reading", async () => {
    await pro(id);
    const api = caller(id);
    const items = await Promise.all(
      Array.from({ length: 11 }, () => api.recipes.createManual(manual())),
    );
    await db
      .update(billingAccount)
      .set({ status: "free" })
      .where(eq(billingAccount.userId, id));
    const first = items[0];
    if (!first) throw new Error("Missing test recipe");
    expect((await api.recipes.get({ id: first.id })).title).toBe(
      sampleRecipe.title,
    );
    await expect(api.recipes.createManual(manual())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("requires Pro for household creation while Free members can join", async () => {
    const api = caller(id);
    await expect(
      api.households.create({ name: "Test household" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pro(id);
    const household = await api.households.create({ name: "Test household" });
    const invite = await api.households.invite({ householdId: household.id });
    const member = randomUUID();
    ids.push(member);
    await db.insert(user).values({
      id: member,
      name: "Free member",
      email: `${member}@example.test`,
    });
    await expect(
      caller(member).households.acceptInvite({ token: invite.token }),
    ).resolves.toBeDefined();
    await expect(
      api.households.transferOwnership({
        householdId: household.id,
        userId: member,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps the service cutoff atomic and rejects repeated provider calls", async () => {
    const original = pricing.ai.dailyBudgetCents;
    try {
      pricing.ai.dailyBudgetCents = 0;
      await expect(
        db.transaction((tx) => reserveAiSpend(tx, randomUUID())),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      pricing.ai.dailyBudgetCents = 1000000;
      const attempt = randomUUID();
      spendIds.push(attempt);
      const results = await Promise.allSettled([
        db.transaction((tx) => reserveAiSpend(tx, attempt)),
        db.transaction((tx) => reserveAiSpend(tx, attempt)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await db.select().from(aiSpend).where(eq(aiSpend.importId, attempt)),
      ).toHaveLength(1);
    } finally {
      pricing.ai.dailyBudgetCents = original;
    }
  });
  it("rejects unauthenticated billing operations", async () => {
    const api = appRouter.createCaller({ auth: null, session: null });
    await expect(api.billing.checkout()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(api.billing.portal()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(api.billing.status()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
