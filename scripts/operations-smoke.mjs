import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkerHeartbeat } from "../packages/api/src/worker-state.ts";
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
const { writeWorkerHeartbeat, stopWorkerHeartbeat } = await import(
  "../packages/api/src/worker-heartbeat.ts"
);
const userId = randomUUID();
const operations = createOperations();
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
  // Fresh heartbeats must still expose stuck work and sustained database errors.
  await writeWorkerHeartbeat({
    mode: "processing",
    progressAt: Date.now() - 400_000,
    failureSince: null,
  });
  assert.deepEqual((await workerStatus()).issues, ["worker_stalled"]);
  await writeWorkerHeartbeat({
    mode: "retrying",
    progressAt: Date.now(),
    failureSince: Date.now() - 400_000,
  });
  assert.deepEqual((await workerStatus()).issues, ["worker_retrying"]);
  await writeWorkerHeartbeat({
    mode: "waiting",
    progressAt: Date.now() - 3_600_000,
    failureSince: null,
  });
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
  await stopWorkerHeartbeat();
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
  await client.query(
    `INSERT INTO recipe_import(id,user_id,fingerprint,input,state,save_attempts,save_claimed_at)
    VALUES ($1::uuid,$2,$1::text,'first save in progress','ready',1,now())`,
    [randomUUID(), userId],
  );
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
  const observedAt = Date.now();
  const queue = {
    observedAt,
    queuedAt: observedAt - aged.queue.queued_ms,
    readyAt: observedAt - aged.queue.ready_ms,
    activeAt: observedAt - aged.queue.active_ms,
    saveFailureAt: observedAt - aged.queue.save_failure_ms,
  };
  await writeWorkerHeartbeat({
    mode: "waiting",
    progressAt: observedAt,
    failureSince: null,
    queue,
  });
  const cachedQueue = await workerStatus();
  assert.deepEqual(cachedQueue.issues.sort(), aged.issues.sort());
  assert.equal(
    cachedQueue.ok,
    true,
    "queue alerts must not take healthy recipe reads offline",
  );
  assert.deepEqual(cachedQueue.healthIssues, []);
  const queueNotify = createNotifier({
    destination: `http://127.0.0.1:${receiver.address().port}`,
  });
  await queueNotify(cachedQueue.issues);
  assert.deepEqual(received[0].body.issues.sort(), aged.issues.sort());
  await stopWorkerHeartbeat();
  const stopped = await workerStatus();
  assert.equal(stopped.ok, false);
  for (const issue of aged.issues) assert.ok(stopped.issues.includes(issue));
  await queueNotify(stopped.issues);
  const previous = await readWorkerHeartbeat(process.env.WORKER_HEARTBEAT_PATH);
  assert.equal(previous.stopped, true);
  await writeWorkerHeartbeat({
    mode: "processing",
    progressAt: Date.now(),
    failureSince: null,
    queue: previous.queue,
  });
  await queueNotify((await workerStatus()).issues);
  assert.ok(
    received.every(({ body }) => body.event !== "operations_recovered"),
    "restarting must not recover unresolved queue alerts",
  );
  await writeWorkerHeartbeat({
    mode: "waiting",
    progressAt: Date.now(),
    failureSince: null,
    queue: {
      observedAt: Date.now(),
      queuedAt: null,
      readyAt: null,
      activeAt: null,
      saveFailureAt: null,
    },
  });
  await queueNotify((await workerStatus()).issues);
  assert.equal(received.at(-1).body.event, "operations_recovered");
  received.length = 0;

  // Age known rows locally while Neon is asleep; an empty category stays empty.
  await writeWorkerHeartbeat({
    mode: "waiting",
    progressAt: observedAt,
    failureSince: null,
    queue: {
      observedAt,
      queuedAt: observedAt - 299_900,
      readyAt: null,
      activeAt: null,
      saveFailureAt: null,
    },
  });
  assert.deepEqual((await workerStatus(observedAt + 500)).issues, [
    "queue_aged",
  ]);
  await client.query("DELETE FROM recipe_import WHERE user_id=$1", [userId]);
  await locker.query(
    "BEGIN; LOCK TABLE recipe_import IN ACCESS EXCLUSIVE MODE",
  );
  const started = Date.now();
  assert.deepEqual(
    (await workerStatus(observedAt + 500)).issues,
    ["queue_aged"],
    "local alert checks must not query the locked database",
  );
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
  // Explicit diagnostics use fresh database state, not old heartbeat queue ages.
  assert.equal((await inspect()).ok, true);
  await writeWorkerHeartbeat();
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
