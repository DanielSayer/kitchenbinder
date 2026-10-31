import {
  type ChildProcess,
  execFileSync,
  fork,
  spawn,
  spawnSync,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend } from "@prep-sheet/db/schema/billing";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { sampleRecipe } from "./recipes/fixtures";
import { notifyImportWorker } from "./worker-wakeup";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const userId = randomUUID();
const ids = [randomUUID(), randomUUID()];
const children: ChildProcess[] = [];
const containers: string[] = [];
afterAll(async () => {
  for (const name of containers)
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  for (const child of children) if (child.exitCode === null) child.kill();
  await db.delete(recipe).where(inArray(recipe.id, ids));
  await db.delete(user).where(eq(user.id, userId));
  await db.$client.end();
});

function worker(reconcileMs = 1_800_000) {
  const image = process.env.PREP_SHEET_RELEASE_IMAGE;
  const name = `prep-sheet-worker-${randomUUID()}`;
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  const network =
    process.platform === "linux"
      ? "--network=host"
      : "--add-host=host.docker.internal:host-gateway";
  if (process.platform !== "linux")
    databaseUrl.hostname = "host.docker.internal";
  const child = image
    ? spawn(
        "docker",
        [
          "run",
          "--rm",
          "--init",
          "--name",
          name,
          network,
          "-e",
          "NODE_ENV=production",
          "-e",
          "SUPPORT_EMAIL=support@example.test",
          "-e",
          "SUPPORT_OPERATOR=Isolated support test operator",
          "-e",
          "PREP_SHEET_TEST_DATABASE=isolated",
          "-e",
          "AI_ENABLED=false",
          "-e",
          "BILLING_MODE=disabled",
          "-e",
          `DATABASE_URL=${databaseUrl.href}`,
          "-e",
          `BETTER_AUTH_SECRET=${process.env.BETTER_AUTH_SECRET}`,
          "-e",
          `BETTER_AUTH_URL=${process.env.BETTER_AUTH_URL}`,
          "-e",
          "WORKER_SHUTDOWN_TIMEOUT_MS=10000",
          "-e",
          "DATABASE_IDLE_TIMEOUT_MS=500",
          "-e",
          `WORKER_RECONCILE_MS=${reconcileMs}`,
          image,
          "node",
          "scripts/start-worker.mjs",
        ],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      )
    : fork(
        fileURLToPath(
          new URL("../../../scripts/start-worker.mjs", import.meta.url),
        ),
        [],
        {
          cwd: root,
          env: {
            ...process.env,
            NODE_ENV: "production",
            SUPPORT_EMAIL: "support@example.test",
            SUPPORT_OPERATOR: "Isolated support test operator",
            AI_ENABLED: "false",
            BILLING_MODE: "disabled",
            OPENAI_API_KEY: "",
            POLAR_ACCESS_TOKEN: "",
            POLAR_PRO_PRODUCT_ID: "",
            POLAR_WEBHOOK_SECRET: "",
            WORKER_SHUTDOWN_TIMEOUT_MS: "10000",
            DATABASE_IDLE_TIMEOUT_MS: "500",
            WORKER_RECONCILE_MS: String(reconcileMs),
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
  if (image) containers.push(name);
  children.push(child);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const closed = once(child, "exit");
  return {
    child,
    stop() {
      if (image)
        execFileSync("docker", ["kill", "--signal=SIGTERM", name], {
          stdio: "ignore",
        });
      else stop(child);
    },
    closed,
    async wait(event: string) {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (output.includes(event)) return;
        if (child.exitCode !== null) throw new Error(output);
        await setTimeout(50);
      }
      throw new Error(`Worker event missing: ${event}. ${output}`);
    },
    output: () => output,
    async wake() {
      if (image) {
        execFileSync(
          "docker",
          [
            "exec",
            name,
            "node",
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            'import { notifyImportWorker } from "./packages/api/src/worker-wakeup.ts"; await notifyImportWorker();',
          ],
          { stdio: "ignore" },
        );
      } else await notifyImportWorker();
    },
    healthy() {
      const result = spawnSync(
        image ? "docker" : process.execPath,
        image
          ? ["exec", name, "node", "scripts/operations.mjs", "worker"]
          : [
              fileURLToPath(
                new URL("../../../scripts/operations.mjs", import.meta.url),
              ),
              "worker",
            ],
        { cwd: root, env: process.env, stdio: "ignore", timeout: 5000 },
      );
      return result.status === 0;
    },
  };
}
function stop(child: ChildProcess) {
  // Windows child.kill(SIGTERM) forcibly terminates; IPC exercises the same
  // handler. Linux CI exercises the actual container signal.
  if (process.platform === "win32") child.send("shutdown");
  else child.kill("SIGTERM");
}

it("drains a blocked checkpoint save on shutdown, leaves the next job durable, then resumes after restart without AI", async () => {
  await db.insert(user).values({
    id: userId,
    name: "Worker release",
    email: `${userId}@example.test`,
  });
  await db.insert(recipeImport).values(
    ids.map(
      (id) =>
        ({
          id,
          userId,
          fingerprint: id,
          input: "checkpointed input",
          state: "ready",
          generated: { content: sampleRecipe, tagIds: [], origin: "generated" },
        }) satisfies typeof recipeImport.$inferInsert,
    ),
  );
  const blocker = await db.$client.connect();
  try {
    await blocker.query("BEGIN");
    // Claims skip locked import rows. Block the actual save after its claim
    // commits so shutdown must drain that active attempt.
    await blocker.query("LOCK TABLE recipe IN ACCESS EXCLUSIVE MODE");
    const first = worker();
    await first.wait('"stage":"saving"');
    expect(first.healthy()).toBe(true);
    first.stop();
    await setTimeout(100);
    expect(first.child.exitCode).toBeNull();
    await blocker.query("COMMIT");
    const [code] = await first.closed;
    expect(code, first.output()).toBe(0);
    expect(first.output()).toContain("import_worker_stopped");
    if (!process.env.PREP_SHEET_RELEASE_IMAGE)
      expect(first.healthy()).toBe(false);
    const rows = await db
      .select()
      .from(recipeImport)
      .where(inArray(recipeImport.id, ids));
    expect(rows.filter((row) => row.state === "saved")).toHaveLength(1);
    expect(rows.filter((row) => row.state === "ready")).toHaveLength(1);
    const second = worker();
    await second.wait("import_saved");
    second.stop();
    expect((await second.closed)[0], second.output()).toBe(0);
    expect(
      await db.select().from(recipe).where(inArray(recipe.id, ids)),
    ).toHaveLength(2);
    expect(
      await db.select().from(aiSpend).where(inArray(aiSpend.importId, ids)),
    ).toHaveLength(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
}, 60_000);

it("keeps an idle heartbeat alive without queue queries, then wakes and saves a checkpoint", async () => {
  const running = worker();
  try {
    await running.wait('"mode":"waiting"');
    // Allow PostgreSQL's previous scan statistics to flush before sampling.
    await setTimeout(1500);
    const scans = async () =>
      (
        await db.execute(
          sql`select seq_scan, idx_scan from pg_stat_user_tables where relname='recipe_import'`,
        )
      ).rows[0];
    const before = await scans();
    await setTimeout(31_000);
    expect(running.healthy()).toBe(true);
    expect(await scans()).toEqual(before);
    expect(running.output().match(/"mode":"waiting"/g)?.length).toBeGreaterThan(
      1,
    );
    const id = randomUUID();
    ids.push(id);
    await db.insert(recipeImport).values({
      id,
      userId,
      fingerprint: id,
      input: "",
      state: "ready",
      generated: { content: sampleRecipe, tagIds: [], origin: "generated" },
    });
    await running.wake();
    await running.wait("import_saved");
    expect(
      (await db.select().from(recipeImport).where(eq(recipeImport.id, id)))[0]
        ?.state,
    ).toBe("saved");
  } finally {
    running.stop();
    expect((await running.closed)[0], running.output()).toBe(0);
  }
}, 60_000);

it("reconciles a missed wakeup and honours a scheduled save without waiting for the next reconciliation", async () => {
  const running = worker(10_000);
  try {
    await running.wait('"mode":"waiting"');
    const id = randomUUID();
    ids.push(id);
    // Deliberately skip the notification. The fallback must find this checkpoint.
    await db.insert(recipeImport).values({
      id,
      userId,
      fingerprint: id,
      input: "",
      state: "ready",
      generated: { content: sampleRecipe, tagIds: [], origin: "generated" },
    });
    await running.wait("import_saved");
    running.stop();
    expect((await running.closed)[0], running.output()).toBe(0);

    const delayedId = randomUUID();
    ids.push(delayedId);
    await db.insert(recipeImport).values({
      id: delayedId,
      userId,
      fingerprint: delayedId,
      input: "",
      state: "ready",
      saveAttempts: 1,
      nextSaveAttemptAt: new Date(Date.now() + 4000),
      generated: { content: sampleRecipe, tagIds: [], origin: "generated" },
    });
    const retrying = worker();
    try {
      await retrying.wait("import_saved");
      expect(
        (
          await db
            .select()
            .from(recipeImport)
            .where(eq(recipeImport.id, delayedId))
        )[0]?.saveAttempts,
      ).toBe(2);
    } finally {
      retrying.stop();
      expect((await retrying.closed)[0], retrying.output()).toBe(0);
    }
  } finally {
    if (running.child.exitCode === null) {
      running.stop();
      await running.closed;
    }
  }
}, 60_000);
