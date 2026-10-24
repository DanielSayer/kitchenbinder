import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { db } from "@prep-sheet/db";
import { ensurePersonalHousehold } from "@prep-sheet/db/households";
import { user } from "@prep-sheet/db/schema/auth";
import { collection } from "@prep-sheet/db/schema/collection";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { recipe, recipeShare } from "@prep-sheet/db/schema/recipe";
import { accountDeletionRequest } from "@prep-sheet/db/schema/support";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeAccountDeletion } from "./account-deletion";
import type { Context } from "./context";
import { sampleRecipe } from "./recipes/fixtures";
import { appRouter } from "./routers";
import { listSupportQueue } from "./support-operations";

const ownerId = randomUUID();
const otherId = randomUUID();
const householdId = randomUUID();
const emptyId = randomUUID();
const personalId = randomUUID();
const sharedId = randomUUID();
const emptySharedId = randomUUID();
function operatorCommand(...args: string[]) {
  return execFileSync(
    process.execPath,
    ["--import", "tsx", "packages/api/src/support-admin.ts", ...args],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, SUPPORT_OPERATOR: "Isolated queue operator" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
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
  return appRouter.createCaller({ auth: null, session }).support;
}

const owner = caller(ownerId);
const other = caller(otherId);
describe("account support with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: "Support test",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(household).values([
      {
        id: householdId,
        ownerId,
        name: "Support test household",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: emptyId,
        ownerId,
        name: "Only me",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);
    await db.insert(householdMember).values([
      { householdId, userId: ownerId },
      { householdId, userId: otherId },
      { householdId: emptyId, userId: ownerId },
    ]);
    await ensurePersonalHousehold(db, ownerId);
    await db
      .insert(collection)
      .values({ id: randomUUID(), userId: ownerId, name: "Favourites" });
    await db.insert(recipe).values([
      {
        id: personalId,
        userId: ownerId,
        title: "Personal",
        origin: "manual",
        content: sampleRecipe,
      },
      {
        id: sharedId,
        userId: ownerId,
        title: "Shared",
        origin: "manual",
        content: sampleRecipe,
      },
      {
        id: emptySharedId,
        userId: ownerId,
        title: "Shared with nobody else",
        origin: "manual",
        content: sampleRecipe,
      },
    ]);
    await db.insert(recipeShare).values([
      { recipeId: sharedId, householdId },
      { recipeId: emptySharedId, householdId: emptyId },
    ]);
  });
  afterAll(async () => {
    await db
      .delete(household)
      .where(inArray(household.ownerId, [ownerId, otherId]));
    await db
      .delete(recipe)
      .where(inArray(recipe.id, [personalId, sharedId, emptySharedId]));
    await db.delete(user).where(inArray(user.id, [ownerId, otherId]));
    await db.$client.end();
  });
  it("requires authentication and keeps reports private", async () => {
    await expect(
      appRouter.createCaller({ auth: null, session: null }).support.reports(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(owner.report({ message: " " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await owner.report({ message: "The recipe page failed to load." });
    expect(await owner.reports()).toHaveLength(1);
    expect(await other.reports()).toHaveLength(0);
  });
  it("limits concurrent reports to five per hour", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        owner.report({ message: "A concurrent test report." }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(4);
    expect(await owner.reports()).toHaveLength(5);
  });
  it("lets the configured operator inspect and resolve the exact report through the CLI", async () => {
    const saved = await other.report({
      message: "Operator rehearsal report, no real user.",
    });
    const listing = operatorCommand("list");
    expect(listing).toContain("Isolated queue operator");
    expect(listing).toContain(saved.id);
    expect(listing).toContain(`${otherId}@example.test`);
    expect(() => operatorCommand("resolve-report", saved.id)).toThrow();
    expect(await other.reports()).toHaveLength(1);
    expect(operatorCommand("resolve-report", saved.id, "--confirm")).toContain(
      saved.id,
    );
    expect(await other.reports()).toHaveLength(0);
    expect(await owner.reports()).toHaveLength(5);
    expect((await listSupportQueue(100)).reports).toHaveLength(0);
  }, 40_000);
  it("deduplicates deletion requests and only cancels your own", async () => {
    await Promise.all([
      owner.requestDeletion({ confirmation: "DELETE" }),
      owner.requestDeletion({ confirmation: "DELETE" }),
    ]);
    expect(
      await db
        .select()
        .from(accountDeletionRequest)
        .where(eq(accountDeletionRequest.userId, ownerId)),
    ).toHaveLength(1);
    await other.cancelDeletion();
    const current = await owner.deletion();
    expect(current.ownedHouseholds).toEqual([
      {
        id: householdId,
        name: "Support test household",
        transferTo: { id: otherId, name: "Support test" },
      },
      { id: emptyId, name: "Only me", transferTo: null },
    ]);
    expect(current.request).not.toBeNull();
    await owner.cancelDeletion();
    expect((await owner.deletion()).request).toBeNull();
    if (!current.request) throw new Error("Missing request");
    await expect(completeAccountDeletion(current.request.id)).rejects.toThrow(
      "No pending",
    );
  });
  it("transfers or deletes owned households, removes private data and preserves shared recipes", async () => {
    await owner.requestDeletion({ confirmation: "DELETE" });
    const { request } = await owner.deletion();
    if (!request) throw new Error("Missing request");
    expect(
      operatorCommand("complete-deletion", request.id, "--confirm"),
    ).toContain(request.id);
    expect(
      await db.select().from(user).where(eq(user.id, ownerId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(recipe).where(eq(recipe.id, personalId)),
    ).toHaveLength(0);
    const [shared] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, sharedId));
    expect(shared?.userId).toBeNull();
    expect(
      await db
        .select({ householdId: recipeShare.householdId })
        .from(recipeShare)
        .where(eq(recipeShare.recipeId, sharedId)),
    ).toEqual([{ householdId }]);
    expect(
      await db.select().from(recipe).where(eq(recipe.id, emptySharedId)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: household.id, ownerId: household.ownerId })
        .from(household)
        .where(inArray(household.id, [householdId, emptyId])),
    ).toEqual([{ id: householdId, ownerId: otherId }]);
    expect(
      await db.select().from(household).where(eq(household.ownerId, ownerId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(collection).where(eq(collection.userId, ownerId)),
    ).toHaveLength(0);
    await expect(completeAccountDeletion(request.id)).rejects.toThrow(
      "No pending",
    );
  });
});
