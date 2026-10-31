import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { inspectImportQueue } from "./imports";

const userId = randomUUID();
beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: "Queue observations",
    email: `${userId}@example.test`,
  });
});
beforeEach(async () => {
  await db.delete(recipeImport).where(eq(recipeImport.userId, userId));
});
afterAll(async () => {
  await db.delete(user).where(eq(user.id, userId));
  await db.$client.end();
});

it("reports queued, ready, active and exhausted-save timestamps in the scheduling query", async () => {
  const oldest = new Date(Date.now() - 3_600_000);
  await db.insert(recipeImport).values(
    (
      [
        "queued",
        "ready",
        "processing",
        "failed",
      ] satisfies (typeof recipeImport.$inferInsert.state)[]
    ).map((state) => ({
      id: randomUUID(),
      userId,
      fingerprint: "private-queue-fixture",
      input: "private content",
      state,
      createdAt: oldest,
      startedAt: oldest,
      saveAttempts: state === "failed" ? 5 : 0,
    })),
  );
  const scan = await inspectImportQueue(1_800_000);
  for (const key of [
    "queuedAt",
    "readyAt",
    "activeAt",
    "saveFailureAt",
  ] satisfies (keyof typeof scan.queue)[]) {
    expect(scan.queue[key]).toBe(oldest.getTime());
  }
  expect(JSON.stringify(scan)).not.toMatch(/private|content|fingerprint/);
});

it("keeps exhausted saves visible while allowing an otherwise idle worker to sleep", async () => {
  const oldest = new Date(Date.now() - 400_000);
  await db.insert(recipeImport).values({
    id: randomUUID(),
    userId,
    fingerprint: "failed-save",
    input: "",
    state: "failed",
    saveAttempts: 5,
    createdAt: oldest,
  });
  const scan = await inspectImportQueue(1_800_000);
  expect(scan.delayMs).toBe(1_800_000);
  expect(scan.queue).toMatchObject({
    queuedAt: null,
    readyAt: null,
    activeAt: null,
    saveFailureAt: oldest.getTime(),
  });
});

it("excludes a first save holding its lease from failure alerts and preserves retry timing", async () => {
  const now = Date.now();
  await db.insert(recipeImport).values({
    id: randomUUID(),
    userId,
    fingerprint: "first-save",
    input: "",
    state: "ready",
    saveAttempts: 1,
    saveClaimedAt: new Date(now),
  });
  expect((await inspectImportQueue(1_800_000)).queue.saveFailureAt).toBeNull();
  await db
    .update(recipeImport)
    .set({ saveClaimedAt: null, nextSaveAttemptAt: new Date(now + 5000) })
    .where(eq(recipeImport.userId, userId));
  const retry = await inspectImportQueue(1_800_000);
  expect(retry.queue.saveFailureAt).not.toBeNull();
  expect(retry.delayMs).toBeGreaterThan(100);
  expect(retry.delayMs).toBeLessThanOrEqual(5000);
});
