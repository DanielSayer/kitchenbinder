import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const require = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { Pool } = require("pg");
export const heartbeatPath = () =>
  process.env.WORKER_HEARTBEAT_PATH ?? resolve("tmp/operations/worker.json");
const heartbeatSchema = z.object({
  version: z.literal(1),
  timestamp: z.number().int().nonnegative(),
  instance: z.uuid(),
});
const positive = (name, fallback) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(86_400_000)
    .parse(process.env[name] ?? fallback);

export function thresholds() {
  return {
    heartbeatMs: positive("OPS_HEARTBEAT_MAX_MS", 90_000),
    queuedMs: positive("OPS_QUEUED_MAX_MS", 300_000),
    readyMs: positive("OPS_READY_MAX_MS", 600_000),
    activeMs: positive("OPS_ACTIVE_MAX_MS", 300_000),
    saveFailureMs: positive("OPS_SAVE_FAILURE_MAX_MS", 300_000),
  };
}

export async function workerStatus(now = Date.now()) {
  try {
    const record = heartbeatSchema.parse(
      JSON.parse(await readFile(heartbeatPath(), "utf8")),
    );
    const ageMs = now - record.timestamp;
    return {
      ok: ageMs >= -5000 && ageMs <= thresholds().heartbeatMs,
      ageMs: Math.max(0, ageMs),
    };
  } catch {
    return { ok: false, ageMs: null };
  }
}

// Separate from request pools: probes cannot queue behind application transactions.
// Both server-side cancellation and client/connection deadlines are required.
export function createOperations({
  connectionString = process.env.DATABASE_URL,
} = {}) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
    query_timeout: 1500,
    idleTimeoutMillis: 5000,
    application_name: "prep-sheet-readiness",
  });
  pool.on("error", () => {}); // Idle connection failures are reflected in the next probe.
  let cached;
  let expires = 0;
  let pending;
  async function inspect() {
    const worker = await workerStatus();
    const issues = worker.ok ? [] : ["worker_stale"];
    try {
      const result = await pool.query(`SELECT
        count(*) FILTER (WHERE state='queued')::int AS queued,
        count(*) FILTER (WHERE state='ready')::int AS ready,
        count(*) FILTER (WHERE state IN ('fetching','processing'))::int AS active,
        count(*) FILTER (WHERE save_attempts>0 AND state IN ('ready','failed'))::int AS save_failures,
        coalesce(extract(epoch FROM (now()-min(created_at) FILTER (WHERE state='queued')))*1000,0)::float8 AS queued_ms,
        coalesce(extract(epoch FROM (now()-min(coalesce(started_at,created_at)) FILTER (WHERE state='ready')))*1000,0)::float8 AS ready_ms,
        coalesce(extract(epoch FROM (now()-min(coalesce(started_at,created_at)) FILTER (WHERE state IN ('fetching','processing'))))*1000,0)::float8 AS active_ms,
        coalesce(extract(epoch FROM (now()-min(created_at) FILTER (WHERE save_attempts>0 AND state IN ('ready','failed'))))*1000,0)::float8 AS save_failure_ms
        FROM recipe_import WHERE state IN ('queued','ready','fetching','processing','failed')`);
      const queue = result.rows[0];
      const limits = thresholds();
      for (const [column, limit, issue] of [
        ["queued_ms", limits.queuedMs, "queue_aged"],
        ["ready_ms", limits.readyMs, "ready_aged"],
        ["active_ms", limits.activeMs, "active_aged"],
        ["save_failure_ms", limits.saveFailureMs, "save_failure_aged"],
      ])
        if (queue[column] > limit) issues.push(issue);
      return { ok: issues.length === 0, database: true, worker, queue, issues };
    } catch {
      issues.push("database_unavailable");
      return { ok: false, database: false, worker, issues };
    }
  }
  return {
    snapshot() {
      if (cached && Date.now() < expires) return Promise.resolve(cached);
      if (!pending)
        pending = inspect()
          .then((value) => {
            cached = value;
            expires = Date.now() + 5000;
            return value;
          })
          .finally(() => {
            pending = undefined;
          });
      return pending;
    },
    close: () => pool.end(),
  };
}

export async function healthcheck(mode) {
  if (mode === "worker") return (await workerStatus()).ok;
  if (mode !== "web") throw new Error("Expected web or worker");
  const response = await fetch(
    `http://127.0.0.1:${process.env.PORT ?? 3001}/health/ready`,
    { signal: AbortSignal.timeout(4000) },
  );
  await response.body?.cancel();
  return response.ok;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const mode = process.argv[2] ?? "inspect";
    if (mode === "inspect") {
      const operations = createOperations();
      try {
        const status = await operations.snapshot();
        process.stdout.write(
          `${JSON.stringify({ event: "operations_status", ...status })}\n`,
        );
        process.exitCode = status.ok ? 0 : 1;
      } finally {
        await operations.close();
      }
    } else process.exitCode = (await healthcheck(mode)) ? 0 : 1;
  } catch {
    process.stderr.write('{"event":"operations_check_failed"}\n');
    process.exitCode = 1;
  }
}
