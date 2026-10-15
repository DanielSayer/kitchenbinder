import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend } from "@prep-sheet/db/schema/billing";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { aiPolicy } from "@prep-sheet/env/ai-policy";
import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { pricing } from "./billing/policy";
import { usageSummary } from "./billing/usage";
import { importStatus, processNextImport, submitImport } from "./imports";
import { sampleRecipe } from "./recipes/fixtures";

const owner = randomUUID();
const generated = {
  content: sampleRecipe,
  tagIds: [],
  sourceUrl: null,
  origin: "imported" as const,
};

beforeAll(async () => {
  await db.insert(user).values({
    id: owner,
    name: "Save retries",
    email: `${owner}@example.test`,
  });
  // Inject an actual PostgreSQL persistence failure, after generation has checkpointed.
  await db.execute(sql`create function test_import_save_failure() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from recipe_import where id = NEW.id and fingerprint in ('fail-save', 'fail-retry-state')) then
        raise exception 'injected save failure';
      end if;
      if exists (select 1 from recipe_import where id = NEW.id and fingerprint = 'block-save') then
        perform pg_advisory_xact_lock(728193049);
      end if;
      return NEW;
    end;
  $$`);
  await db.execute(sql`create trigger test_import_save_failure before insert on recipe
    for each row execute function test_import_save_failure()`);
  await db.execute(sql`create function test_import_retry_failure() returns trigger language plpgsql as $$
    begin
      if OLD.fingerprint = 'fail-retry-state' and OLD.state = 'ready' and NEW.worker_token is null then
        raise exception 'injected retry state failure';
      end if;
      return NEW;
    end;
  $$`);
  await db.execute(sql`create trigger test_import_retry_failure before update on recipe_import
    for each row execute function test_import_retry_failure()`);
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
          .where(eq(recipeImport.userId, owner)),
      ),
    );
  await db.delete(recipe).where(eq(recipe.userId, owner));
  await db.delete(recipeImport).where(eq(recipeImport.userId, owner));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function job(id: string) {
  const [row] = await db
    .select()
    .from(recipeImport)
    .where(eq(recipeImport.id, id));
  if (!row) throw new Error("Missing test import");
  return row;
}

async function enqueue(
  overrides: Partial<typeof recipeImport.$inferInsert> = {},
) {
  const id = randomUUID();
  await db.insert(recipeImport).values({
    id,
    userId: owner,
    fingerprint: "healthy",
    input: "Soup recipe",
    createdAt: new Date(Date.now() - 1000),
    nextSaveAttemptAt: new Date(Date.now() - 1000),
    ...overrides,
  });
  return id;
}

function clock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  return Date.now();
}

afterAll(async () => {
  await db.execute(
    sql`drop trigger if exists test_import_retry_failure on recipe_import`,
  );
  await db.execute(sql`drop function if exists test_import_retry_failure()`);
  await db.execute(
    sql`drop trigger if exists test_import_save_failure on recipe`,
  );
  await db.execute(sql`drop function if exists test_import_save_failure()`);
  await db
    .delete(aiSpend)
    .where(
      inArray(
        aiSpend.importId,
        db
          .select({ id: recipeImport.id })
          .from(recipeImport)
          .where(eq(recipeImport.userId, owner)),
      ),
    );
  await db.delete(recipe).where(eq(recipe.userId, owner));
  await db.delete(user).where(eq(user.id, owner));
  await db.$client.end();
});

it("releases usage and reserves no spend for an oversized durable input", async () => {
  const id = randomUUID();
  await db.insert(recipeImport).values({
    id,
    userId: owner,
    fingerprint: id,
    input: "x".repeat(aiPolicy.maxContentBytes + 1),
  });
  const generate = vi.fn().mockResolvedValue(generated);
  await processNextImport(generate);
  expect(generate).not.toHaveBeenCalled();
  expect(await job(id)).toMatchObject({ state: "failed", usageReleased: true });
  expect(
    await db.select().from(aiSpend).where(eq(aiSpend.importId, id)),
  ).toHaveLength(0);
});

it("lets healthy ready and queued jobs finish beside a persistently failing checkpoint", async () => {
  const failing = randomUUID();
  const ready = randomUUID();
  const queued = randomUUID();
  await db.insert(recipeImport).values([
    {
      id: failing,
      userId: owner,
      fingerprint: "fail-save",
      input: "",
      state: "ready",
      generated,
      createdAt: new Date(Date.now() - 3000),
      nextSaveAttemptAt: new Date(Date.now() - 3000),
    },
    {
      id: ready,
      userId: owner,
      fingerprint: "healthy-ready",
      input: "",
      state: "ready",
      generated,
      createdAt: new Date(Date.now() - 2000),
      nextSaveAttemptAt: new Date(Date.now() - 2000),
    },
    {
      id: queued,
      userId: owner,
      fingerprint: "healthy-queued",
      input: "Soup recipe",
      createdAt: new Date(Date.now() - 1000),
    },
  ]);
  const generate = vi.fn().mockResolvedValue(generated);
  await Promise.all([processNextImport(generate), processNextImport(generate)]);
  await processNextImport(generate);
  expect(
    await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(inArray(recipe.id, [ready, queued])),
  ).toHaveLength(2);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await job(failing)).toMatchObject({
    state: "ready",
    saveAttempts: 1,
    generated: { content: sampleRecipe },
    saveClaimedAt: null,
    workerToken: null,
    usageReleased: false,
  });
  expect((await job(failing)).nextSaveAttemptAt.getTime()).toBeGreaterThan(
    Date.now(),
  );
  expect(await processNextImport(generate)).toBe(false);
});

it("retries only after backoff, then saves the checkpoint without another AI call or charge", async () => {
  const now = clock();
  const id = await enqueue({ fingerprint: "fail-save" });
  const generate = vi.fn().mockResolvedValue(generated);
  const write = vi.spyOn(process.stdout, "write");
  await processNextImport(generate);
  const spent = await db.select().from(aiSpend).where(eq(aiSpend.importId, id));
  const allowance = await usageSummary(db, owner);
  expect(spent).toHaveLength(1);
  expect(spent[0]?.reservedCents).toBe(pricing.ai.reserveCentsPerAttempt);
  expect(allowance.used).toBe(1);
  expect(await job(id)).toMatchObject({
    state: "ready",
    saveAttempts: 1,
    nextSaveAttemptAt: new Date(now + 5000),
    generated: { content: sampleRecipe },
  });
  expect(
    write.mock.calls.some(
      ([line]) =>
        String(line).includes('"event":"import_save_retry"') &&
        String(line).includes(id) &&
        String(line).includes('"delayMs":5000'),
    ),
  ).toBe(true);
  expect(await processNextImport(generate)).toBe(false);
  vi.setSystemTime(now + 4999);
  expect(await processNextImport(generate)).toBe(false);
  vi.setSystemTime(now + 5000);
  await processNextImport(generate);
  expect(await job(id)).toMatchObject({
    state: "ready",
    saveAttempts: 2,
    nextSaveAttemptAt: new Date(now + 15000),
  });
  await db
    .update(recipeImport)
    .set({ fingerprint: "healthy" })
    .where(eq(recipeImport.id, id));
  vi.setSystemTime(now + 14999);
  expect(await processNextImport(generate)).toBe(false);
  vi.setSystemTime(now + 15000);
  await Promise.all([processNextImport(generate), processNextImport(generate)]);
  expect(await job(id)).toMatchObject({
    state: "saved",
    saveAttempts: 3,
    generated: null,
    workerToken: null,
    saveClaimedAt: null,
    usageReleased: false,
  });
  expect(await db.select().from(recipe).where(eq(recipe.id, id))).toHaveLength(
    1,
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(
    await db.select().from(aiSpend).where(eq(aiSpend.importId, id)),
  ).toEqual(spent);
  expect((await usageSummary(db, owner)).used).toBe(allowance.used);
});

it("stops after five failed saves, retains output and spent credits, and deduplicates the request", async () => {
  clock();
  const input = {
    id: randomUUID(),
    content:
      "Soup. Ingredients: onion and water. Simmer the onion in the water for twenty minutes.",
    sourceUrl: "https://recipes.example/soup",
    groupId: null,
  };
  await submitImport(owner, input);
  const originalFingerprint = (await job(input.id)).fingerprint;
  await db
    .update(recipeImport)
    .set({ fingerprint: "fail-save" })
    .where(eq(recipeImport.id, input.id));
  const generate = vi.fn().mockResolvedValue(generated);
  await processNextImport(generate);
  for (const delayMs of [5000, 10000, 20000, 40000]) {
    const previous = await job(input.id);
    expect(previous.nextSaveAttemptAt.getTime() - Date.now()).toBe(delayMs);
    expect(await processNextImport(generate)).toBe(false);
    vi.setSystemTime(previous.nextSaveAttemptAt);
    await processNextImport(generate);
  }
  expect(await job(input.id)).toMatchObject({
    state: "failed",
    saveAttempts: 5,
    generated: { content: sampleRecipe },
    usageReleased: false,
    workerToken: null,
    saveClaimedAt: null,
  });
  expect((await importStatus(owner, input.id)).kind).toBe("failed");
  expect((await usageSummary(db, owner)).used).toBe(1);
  expect(
    await db.select().from(aiSpend).where(eq(aiSpend.importId, input.id)),
  ).toHaveLength(1);
  await db
    .update(recipeImport)
    .set({ fingerprint: originalFingerprint })
    .where(eq(recipeImport.id, input.id));
  expect((await submitImport(owner, input)).kind).toBe("failed");
  vi.setSystemTime(Date.now() + 86400000);
  expect(await processNextImport(generate)).toBe(false);
  expect(generate).toHaveBeenCalledTimes(1);
});

it("recovers abandoned save and fetch claims even with eligible ready work, without replaying interrupted AI", async () => {
  const now = clock();
  const stale = new Date(now - 240000);
  const abandoned = await enqueue({
    state: "ready",
    generated,
    saveAttempts: 1,
    saveClaimedAt: stale,
    workerToken: randomUUID(),
  });
  const exhausted = await enqueue({
    state: "ready",
    generated,
    saveAttempts: 5,
    saveClaimedAt: stale,
    workerToken: randomUUID(),
  });
  const interrupted = await enqueue({
    state: "processing",
    startedAt: stale,
    workerToken: randomUUID(),
  });
  const fetch = await enqueue({
    state: "fetching",
    startedAt: stale,
    workerToken: randomUUID(),
    createdAt: new Date(now - 2000),
  });
  const healthy = await enqueue({ state: "ready", generated });
  const generate = vi.fn().mockResolvedValue(generated);
  await processNextImport(generate);
  expect(await job(abandoned)).toMatchObject({
    state: "ready",
    saveAttempts: 1,
    nextSaveAttemptAt: new Date(now + 5000),
    saveClaimedAt: null,
    workerToken: null,
  });
  expect(await job(exhausted)).toMatchObject({
    state: "failed",
    generated: { content: sampleRecipe },
    saveAttempts: 5,
    usageReleased: false,
  });
  expect(await job(interrupted)).toMatchObject({
    state: "failed",
    usageReleased: false,
  });
  expect((await job(fetch)).state).toBe("saved");
  await processNextImport(generate);
  expect((await job(healthy)).state).toBe("saved");
  vi.setSystemTime(now + 5000);
  await processNextImport(generate);
  expect(await job(abandoned)).toMatchObject({
    state: "saved",
    saveAttempts: 2,
  });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(
    await db
      .select()
      .from(aiSpend)
      .where(
        inArray(aiSpend.importId, [
          abandoned,
          exhausted,
          interrupted,
          fetch,
          healthy,
        ]),
      ),
  ).toHaveLength(1);
});

it("fails missing or malformed checkpoints explicitly and continues with healthy work", async () => {
  const missing = await enqueue({ state: "ready" });
  const malformed = await enqueue({ state: "ready", generated });
  await db.execute(
    sql`update recipe_import set generated = '{"content":{"title":7},"tagIds":[]}'::jsonb where id = ${malformed}`,
  );
  const healthy = await enqueue({ state: "ready", generated });
  const generate = vi.fn();
  for (let iteration = 0; iteration < 3; iteration++)
    await processNextImport(generate);
  for (const id of [missing, malformed]) {
    expect(await job(id)).toMatchObject({
      state: "failed",
      saveAttempts: 1,
      usageReleased: false,
      saveClaimedAt: null,
      workerToken: null,
    });
    expect(await importStatus(owner, id)).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("missing or invalid"),
    });
  }
  expect((await job(malformed)).generated).toEqual({
    content: { title: 7 },
    tagIds: [],
  });
  expect((await job(healthy)).state).toBe("saved");
  expect(await processNextImport(generate)).toBe(false);
  expect(generate).not.toHaveBeenCalled();
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("retains the claim and import diagnostic if persisting the retry itself fails, then recovers it", async () => {
  const now = clock();
  const id = await enqueue({ fingerprint: "fail-retry-state" });
  const generate = vi.fn().mockResolvedValue(generated);
  const write = vi.spyOn(process.stdout, "write");
  await expect(processNextImport(generate)).rejects.toThrow();
  const claimed = await job(id);
  expect(claimed).toMatchObject({
    state: "ready",
    saveAttempts: 1,
    generated: { content: sampleRecipe },
    usageReleased: false,
  });
  expect(claimed.workerToken).not.toBeNull();
  expect(
    write.mock.calls.some(
      ([line]) =>
        String(line).includes('"event":"import_save_retry_failed"') &&
        String(line).includes(id) &&
        String(line).includes('"saveFailure"'),
    ),
  ).toBe(true);
  await db
    .update(recipeImport)
    .set({ fingerprint: "healthy" })
    .where(eq(recipeImport.id, id));
  vi.setSystemTime(now + 240000);
  expect(await processNextImport(generate)).toBe(false);
  expect(await job(id)).toMatchObject({
    state: "ready",
    saveClaimedAt: null,
    workerToken: null,
    nextSaveAttemptAt: new Date(now + 245000),
  });
  vi.setSystemTime(now + 245000);
  await processNextImport(generate);
  expect((await job(id)).state).toBe("saved");
  expect(generate).toHaveBeenCalledTimes(1);
  expect(
    await db.select().from(aiSpend).where(eq(aiSpend.importId, id)),
  ).toHaveLength(1);
});

it("skips a live locked save during stale recovery and lets the second worker finish healthy work", async () => {
  const now = clock();
  const blocked = await enqueue({
    state: "ready",
    generated,
    fingerprint: "block-save",
    nextSaveAttemptAt: new Date(now - 3000),
  });
  const ready = await enqueue({
    state: "ready",
    generated,
    nextSaveAttemptAt: new Date(now - 2000),
  });
  const queued = await enqueue();
  const held = deferred();
  const release = deferred();
  const lock = db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(728193049)`);
    held.resolve();
    await release.promise;
  });
  await held.promise;
  const generate = vi.fn().mockResolvedValue(generated);
  const saver = processNextImport(generate);
  try {
    await vi.waitFor(
      async () => {
        const result = await db.execute<{
          waiting: boolean;
        }>(sql`select exists (
        select 1 from pg_stat_activity where datname = current_database()
          and wait_event = 'advisory' and query like 'insert into "recipe"%'
      ) as waiting`);
        expect(result.rows[0]?.waiting).toBe(true);
      },
      { timeout: 5000 },
    );
    const claimed = await job(blocked);
    expect(claimed.saveAttempts).toBe(1);
    vi.setSystemTime(now + 240000);
    await processNextImport(generate);
    await processNextImport(generate);
    expect((await job(ready)).state).toBe("saved");
    expect((await job(queued)).state).toBe("saved");
    expect(await job(blocked)).toMatchObject({
      state: "ready",
      saveAttempts: 1,
      workerToken: claimed.workerToken,
      saveClaimedAt: claimed.saveClaimedAt,
    });
  } finally {
    release.resolve();
    await lock;
    await saver;
  }
  expect(await job(blocked)).toMatchObject({ state: "saved", saveAttempts: 1 });
  expect(
    await db.select().from(recipe).where(eq(recipe.id, blocked)),
  ).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(1);
});

it("keeps the global generation limit while permitting checkpoint saves and prevents claim races", async () => {
  const queued = await Promise.all(
    Array.from({ length: pricing.ai.concurrentAttempts + 1 }, () => enqueue()),
  );
  const release = deferred();
  const generate = vi.fn().mockImplementation(async () => {
    await release.promise;
    return generated;
  });
  const workers = Array.from(
    { length: pricing.ai.concurrentAttempts + 1 },
    () => processNextImport(generate),
  );
  try {
    await vi.waitFor(() =>
      expect(generate).toHaveBeenCalledTimes(pricing.ai.concurrentAttempts),
    );
    expect(await processNextImport(generate)).toBe(false);
    const ready = await enqueue({ state: "ready", generated });
    await Promise.all([
      processNextImport(generate),
      processNextImport(generate),
    ]);
    expect(await job(ready)).toMatchObject({ state: "saved", saveAttempts: 1 });
    expect(
      await db.select().from(recipe).where(eq(recipe.id, ready)),
    ).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(pricing.ai.concurrentAttempts);
    const pending = await db
      .select()
      .from(recipeImport)
      .where(inArray(recipeImport.id, queued));
    expect(pending.filter((row) => row.state === "processing")).toHaveLength(
      pricing.ai.concurrentAttempts,
    );
    expect(pending.filter((row) => row.state === "queued")).toHaveLength(1);
  } finally {
    release.resolve();
    await Promise.all(workers);
  }
  await processNextImport(generate);
  expect(generate).toHaveBeenCalledTimes(queued.length);
  expect(
    await db.select().from(aiSpend).where(inArray(aiSpend.importId, queued)),
  ).toHaveLength(queued.length);
});

it("upgrades legacy ready checkpoints additively and can apply the SQL twice", async () => {
  const upgrade = await readFile(
    new URL("../../db/src/upgrades/import-save-retries.sql", import.meta.url),
    "utf8",
  );
  const client = await db.$client.connect();
  const id = randomUUID();
  try {
    // A temporary legacy table keeps this upgrade test independent of the suite schema.
    await client.query(
      "create temporary table recipe_import (id uuid primary key, state text, generated jsonb)",
    );
    await client.query("insert into recipe_import values ($1, 'ready', $2)", [
      id,
      JSON.stringify(generated),
    ]);
    await client.query(upgrade);
    await client.query(upgrade);
    const result = await client.query(
      "select * from recipe_import where id = $1",
      [id],
    );
    expect(result.rows[0]).toMatchObject({
      id,
      state: "ready",
      generated,
      save_attempts: 0,
      save_claimed_at: null,
      next_save_attempt_at: expect.any(Date),
    });
  } finally {
    await client.query("drop table if exists pg_temp.recipe_import");
    client.release();
  }
});
