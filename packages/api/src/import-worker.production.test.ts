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
import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { sampleRecipe } from "./recipes/fixtures";

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

function worker() {
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
          `DATABASE_URL=${databaseUrl.href}`,
          "-e",
          `BETTER_AUTH_SECRET=${process.env.BETTER_AUTH_SECRET}`,
          "-e",
          `BETTER_AUTH_URL=${process.env.BETTER_AUTH_URL}`,
          "-e",
          "WORKER_SHUTDOWN_TIMEOUT_MS=10000",
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
            OPENAI_API_KEY: "",
            POLAR_ACCESS_TOKEN: "",
            POLAR_PRO_PRODUCT_ID: "",
            POLAR_WEBHOOK_SECRET: "",
            WORKER_SHUTDOWN_TIMEOUT_MS: "10000",
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
    first.stop();
    await setTimeout(100);
    expect(first.child.exitCode).toBeNull();
    await blocker.query("COMMIT");
    const [code] = await first.closed;
    expect(code, first.output()).toBe(0);
    expect(first.output()).toContain("import_worker_stopped");
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
