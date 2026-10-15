import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNotifier } from "./monitor-operations.mjs";
import { createOperations, workerStatus } from "./operations.mjs";

assert.equal(process.env.PREP_SHEET_TEST_DATABASE, "isolated");
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/prep_sheet_test");
assert.notEqual(database.port, "5432");
const require = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { Client } = require("pg");
const client = new Client({ connectionString: database.href });
const locker = new Client({ connectionString: database.href });
await client.connect();
await locker.connect();
const directory = await mkdtemp(join(tmpdir(), "prep-sheet-operations-"));
process.env.WORKER_HEARTBEAT_PATH = join(directory, "worker.json");
const { writeWorkerHeartbeat, clearWorkerHeartbeat } = await import(
  "../packages/api/src/worker-heartbeat.ts"
);
const userId = randomUUID();
const operations = createOperations();
const snapshots = [];
async function inspect() {
  const probe = createOperations();
  try {
    return await probe.snapshot();
  } finally {
    await probe.close();
  }
}
let reject = false;
const received = [];
const receiver = createServer(async (request, response) => {
  let body = "";
  for await (const part of request) body += part;
  received.push({
    body: JSON.parse(body),
    authorization: request.headers.authorization,
  });
  response.writeHead(reject ? 503 : 204).end();
});
receiver.listen(0, "127.0.0.1");
await once(receiver, "listening");
try {
  assert.equal((await workerStatus()).ok, false);
  await writeWorkerHeartbeat();
  assert.equal((await workerStatus()).ok, true);
  await writeFile(
    process.env.WORKER_HEARTBEAT_PATH,
    JSON.stringify({
      version: 1,
      timestamp: Date.now() - 100_000,
      instance: randomUUID(),
    }),
  );
  assert.equal((await workerStatus()).ok, false);
  await writeFile(
    process.env.WORKER_HEARTBEAT_PATH,
    JSON.stringify({
      version: 1,
      timestamp: Date.now() + 100_000,
      instance: randomUUID(),
    }),
  );
  assert.equal((await workerStatus()).ok, false);
  await writeFile(process.env.WORKER_HEARTBEAT_PATH, "{invalid");
  assert.equal((await workerStatus()).ok, false);
  await writeWorkerHeartbeat();
  assert.equal((await inspect()).ok, true);
  await clearWorkerHeartbeat();
  assert.deepEqual((await inspect()).issues, ["worker_stale"]);
  await writeWorkerHeartbeat();
  await client.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [
    userId,
    `${userId}@example.test`,
  ]);
  for (const [state, attempts] of [
    ["queued", 0],
    ["ready", 1],
    ["processing", 0],
    ["failed", 5],
  ]) {
    await client.query(
      `INSERT INTO recipe_import(id,user_id,fingerprint,input,state,save_attempts,created_at,started_at)
      VALUES ($1::uuid,$2,$1::text,'PRIVATE RECIPE https://private.test/?secret=never-log',$3,$4,now()-interval '1 hour',now()-interval '1 hour')`,
      [randomUUID(), userId, state, attempts],
    );
  }
  const aged = await inspect();
  assert.deepEqual(aged.issues.sort(), [
    "active_aged",
    "queue_aged",
    "ready_aged",
    "save_failure_aged",
  ]);
  assert.equal(aged.queue.save_failures, 2);
  assert.ok(!JSON.stringify(aged).includes("PRIVATE"));
  assert.ok(!JSON.stringify(aged).includes(userId));
  snapshots.push(aged);
  await client.query("DELETE FROM recipe_import WHERE user_id=$1", [userId]);
  await locker.query(
    "BEGIN; LOCK TABLE recipe_import IN ACCESS EXCLUSIVE MODE",
  );
  const started = Date.now();
  // Coalescing protects the database from a flood of concurrent probe requests.
  const pending = Array.from({ length: 30 }, () => operations.snapshot());
  assert.equal(pending[0], pending[29]);
  const blocked = await Promise.all(pending);
  assert.equal(blocked[0].database, false);
  assert.ok(
    Date.now() - started < 3500,
    "blocked query must be cancelled within the probe budget",
  );
  await locker.query("ROLLBACK");
  assert.equal((await inspect()).ok, true);
  const unavailable = createOperations({
    connectionString: "postgresql://probe:secret@127.0.0.1:1/unavailable",
  });
  try {
    assert.ok(
      (await unavailable.snapshot()).issues.includes("database_unavailable"),
    );
  } finally {
    await unavailable.close();
  }

  const notify = createNotifier({
    destination: `http://127.0.0.1:${receiver.address().port}`,
    token: "local-test-token",
    repeatMs: 1000,
  });
  await notify([], 1000);
  assert.equal(received.length, 0);
  reject = true;
  await assert.rejects(() => notify(["worker_stale"], 1000));
  reject = false;
  await notify(["worker_stale"], 1100);
  await notify(["worker_stale"], 1200);
  assert.equal(received.length, 2);
  await notify(["worker_stale"], 2200);
  await notify([], 2300);
  assert.equal(received.length, 4);
  assert.equal(received[3].body.event, "operations_recovered");
  assert.equal(received[1].authorization, "Bearer local-test-token");
  assert.deepEqual(received[1].body.issues, ["worker_stale"]);
  process.stdout.write(
    `${JSON.stringify({ event: "operations_smoke_passed", checks: ["missing_stale_future_corrupt_heartbeat", "queue_ready_active_save_failure_age", "private_aggregate_diagnostics", "bounded_coalesced_database_checks", "database_recovery", "webhook_retry_dedup_reminder_recovery"] })}\n`,
  );
} finally {
  await locker.query("ROLLBACK");
  await client.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await Promise.all([client.end(), locker.end(), operations.close()]);
  receiver.closeAllConnections();
  await new Promise((done) => receiver.close(done));
  await rm(directory, { recursive: true, force: true });
}
