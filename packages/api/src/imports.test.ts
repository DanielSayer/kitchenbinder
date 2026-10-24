import { randomBytes, randomUUID } from "node:crypto";
import { hashSecret } from "@prep-sheet/auth/extensions";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { extensionCredential } from "@prep-sheet/db/schema/extension";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { extensionRate, recipeImport } from "@prep-sheet/db/schema/import";
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
import { handleExtensionRequest } from "./extension-handler";
import { importInputSchema } from "./import-contract";
import {
  discardImport,
  importCollections,
  importStatus,
  processNextImport,
  submitImport,
} from "./imports";
import { sampleRecipe } from "./recipes/fixtures";
import { checkRecipeUsage } from "./recipes/usage";

const owner = randomUUID();
const other = randomUUID();
const householdId = randomUUID();
const token = `pse_${randomBytes(32).toString("base64url")}`;
const credentialId = randomUUID();
const origin = "chrome-extension://kjmnecmcpdklkaaiklbfoialfdiamabj";
const input = () => ({
  id: randomUUID(),
  content:
    "Soup. Ingredients: 1 onion, 500 ml water. Instructions: Chop the onion. Simmer in water for 20 minutes and serve.",
  sourceUrl: "https://recipes.example/soup",
  householdId: null,
});
const generated = {
  content: sampleRecipe,
  tagIds: [],
  sourceUrl: "https://recipes.example/soup",
  origin: "imported" as const,
};
const request = (
  action: string,
  body: unknown = {},
  overrides: Record<string, string> = {},
) =>
  new Request(`http://localhost:3001/api/extensions/${action}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...overrides,
    },
    body: JSON.stringify(body),
  });

describe("durable extension imports with PostgreSQL", () => {
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
    await db.insert(extensionCredential).values({
      id: credentialId,
      userId: owner,
      extensionId: "kjmnecmcpdklkaaiklbfoialfdiamabj",
      tokenHash: hashSecret(token),
      scope: "collections:read recipes:import",
      expiresAt: new Date(Date.now() + 600_000),
    });
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

  it("validates content and source separately, rejects credentials/query/fragment and does not accept extra fields", () => {
    for (const sourceUrl of [
      "javascript:alert(1)",
      "https://user:pass@example.com/r",
      "https://example.com/r?token=secret",
      "https://example.com/r#secret",
      "https://example.com:9000/r",
    ])
      expect(
        importInputSchema.safeParse({ ...input(), sourceUrl }).success,
      ).toBe(false);
    expect(
      importInputSchema.safeParse({ ...input(), content: "x".repeat(32_001) })
        .success,
    ).toBe(false);
    expect(
      importInputSchema.safeParse({ ...input(), token: "secret" }).success,
    ).toBe(false);
  });
  it("enforces exact origins, token auth, scopes, body size and revocation", async () => {
    expect(
      (
        await handleExtensionRequest(
          request("collections", {}, { Origin: `${origin}.evil` }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleExtensionRequest(
          request("collections", {}, { Authorization: "" }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleExtensionRequest(
          request("import", { ...input(), content: "x".repeat(200_001) }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handleExtensionRequest(
          request("import", { ...input(), content: "too short" }),
        )
      ).status,
    ).toBe(400);
    await db
      .update(extensionCredential)
      .set({ scope: "account:read" })
      .where(eq(extensionCredential.id, credentialId));
    expect((await handleExtensionRequest(request("collections"))).status).toBe(
      403,
    );
    await db
      .update(extensionCredential)
      .set({ scope: "collections:read recipes:import", revokedAt: new Date() })
      .where(eq(extensionCredential.id, credentialId));
    expect(
      (
        await handleExtensionRequest(
          request("import-status", { id: randomUUID() }),
        )
      ).status,
    ).toBe(401);
    await db
      .update(extensionCredential)
      .set({ revokedAt: null })
      .where(eq(extensionCredential.id, credentialId));
  });
  it("lists only writable collections and rejects non-members", async () => {
    expect(await importCollections(owner)).toEqual([
      { id: null, name: "My recipes" },
      { id: householdId, name: "Shared recipes" },
    ]);
    expect(await importCollections(other)).toEqual([
      { id: null, name: "My recipes" },
    ]);
    await expect(
      submitImport(other, { ...input(), householdId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Older extension builds send the household as groupId.
    await expect(
      submitImport(other, { ...input(), groupId: householdId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("imports through the authenticated endpoint, shares with the household and keeps the recipe personal", async () => {
    const item = { ...input(), householdId };
    const response = await handleExtensionRequest(request("import", item));
    expect(response.status).toBe(202);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const generate = vi.fn().mockResolvedValue(generated);
    await processNextImport(generate);
    const status = await handleExtensionRequest(
      request("import-status", { id: item.id }),
    );
    expect(await status.json()).toMatchObject({
      kind: "saved",
      id: item.id,
      recipeId: item.id,
    });
    const [saved] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, item.id));
    expect(saved).toMatchObject({
      userId: owner,
      origin: "imported",
      sourceUrl: item.sourceUrl,
    });
    expect(
      await db
        .select({ householdId: recipeShare.householdId })
        .from(recipeShare)
        .where(eq(recipeShare.recipeId, item.id)),
    ).toEqual([{ householdId }]);
    // The importer owns the recipe, so leaving the household keeps it.
    await db
      .delete(householdMember)
      .where(
        and(
          eq(householdMember.householdId, householdId),
          eq(householdMember.userId, owner),
        ),
      );
    expect(
      (await handleExtensionRequest(request("import-status", { id: item.id })))
        .status,
    ).toBe(200);
    await db.insert(householdMember).values({ householdId, userId: owner });
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
      Array.from({ length: 6 }, () => submitImport(owner, item)),
    );
    expect(results.every((result) => result.kind === "queued")).toBe(true);
    await expect(
      submitImport(owner, { ...item, content: `${item.content} changed` }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitImport(other, item)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(importStatus(other, item.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const generate = vi
      .fn()
      .mockResolvedValue({ ...generated, tagIds: [tagId, foreignTagId] });
    await Promise.all([
      processNextImport(generate),
      processNextImport(generate),
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      item.content,
      expect.any(Array),
      item.sourceUrl,
      [],
    );
    const [saved] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, item.id));
    expect(saved).toMatchObject({
      userId: owner,
      sourceUrl: item.sourceUrl,
      origin: "imported",
      content: sampleRecipe,
    });
    expect(
      await db
        .select({ id: recipeTag.tagId })
        .from(recipeTag)
        .where(eq(recipeTag.recipeId, item.id)),
    ).toEqual([{ id: tagId }]);
    expect((await submitImport(owner, item)).kind).toBe("saved");
    await processNextImport(generate);
    expect(generate).toHaveBeenCalledTimes(1);
    await db.delete(recipe).where(eq(recipe.id, item.id));
    expect((await submitImport(owner, item)).kind).toBe("failed");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("rechecks membership immediately before saving", async () => {
    const item = { ...input(), householdId };
    await submitImport(owner, item);
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
    await submitImport(owner, ready);
    await submitImport(owner, interrupted);
    await db
      .update(recipeImport)
      .set({ state: "ready", generated, input: "" })
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
    expect((await submitImport(owner, interrupted)).kind).toBe("failed");
  });
  it("failures are terminal for their ID and do not spend AI again", async () => {
    const item = input();
    await submitImport(other, item);
    const generate = vi
      .fn()
      .mockRejectedValue(new Error("private internal error"));
    await processNextImport(generate);
    const result = await submitImport(other, item);
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
      submitImport(other, input()),
      submitImport(other, input()),
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
    await submitImport(owner, item);
    for (let index = 0; index < 4; index++) await submitImport(owner, input());
    await expect(submitImport(owner, input())).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect((await submitImport(owner, item)).kind).toBe("queued");
    for (let index = 0; index < 5; index++)
      await processNextImport(vi.fn().mockResolvedValue(generated));
  });
  it("rate limits polling by account and supplies retry timing", async () => {
    await db
      .insert(extensionRate)
      .values({ userId: owner, window: new Date(), requests: 60 })
      .onConflictDoUpdate({
        target: extensionRate.userId,
        set: { window: new Date(), requests: 60 },
      });
    const response = await handleExtensionRequest(request("collections"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("tombstones a lost request before local reset so a late submission cannot import it", async () => {
    const item = input();
    await discardImport(owner, item);
    expect((await submitImport(owner, item)).kind).toBe("failed");
    const generate = vi.fn();
    await processNextImport(generate);
    expect(generate).not.toHaveBeenCalled();
    await expect(discardImport(other, item)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("serializes discard against admission without losing an active request", async () => {
    const item = input();
    await submitImport(owner, item);
    await expect(discardImport(owner, item)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const generate = vi.fn().mockResolvedValue(generated);
    await processNextImport(generate);
    await discardImport(owner, item);
    expect((await submitImport(owner, item)).kind).toBe("saved");
    expect(generate).toHaveBeenCalledTimes(1);
    const race = input();
    await Promise.allSettled([
      discardImport(owner, race),
      submitImport(owner, race),
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
