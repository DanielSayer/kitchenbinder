import { setTimeout } from "node:timers/promises";
import { db } from "@prep-sheet/db";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { count, inArray, min } from "drizzle-orm";
import { importFailure, logImport } from "./import-diagnostics";
import { processNextImport } from "./imports";

let stopping = false;
const idleAbort = new AbortController();
const shutdownTimeout = Number(
  process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? 180_000,
);
if (!Number.isInteger(shutdownTimeout) || shutdownTimeout < 1) {
  throw new Error("Invalid WORKER_SHUTDOWN_TIMEOUT_MS");
}
let shutdownTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
function stop() {
  if (stopping) return;
  stopping = true;
  idleAbort.abort();
  shutdownTimer = globalThis.setTimeout(() => {
    process.stderr.write('{"event":"import_worker_shutdown_timeout"}\n');
    process.exit(1);
  }, shutdownTimeout);
  shutdownTimer.unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("message", (message) => {
  if (message === "shutdown") stop();
});
async function idle(delay: number) {
  try {
    await setTimeout(delay, undefined, { signal: idleAbort.signal });
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) throw error;
  }
}
let checkingQueue = false;
async function heartbeat() {
  if (checkingQueue || stopping) return;
  checkingQueue = true;
  try {
    const states = await db
      .select({
        state: recipeImport.state,
        total: count(),
        oldest: min(recipeImport.createdAt),
      })
      .from(recipeImport)
      .where(
        inArray(recipeImport.state, [
          "queued",
          "fetching",
          "processing",
          "ready",
        ]),
      )
      .groupBy(recipeImport.state);
    const queued = states.find((row) => row.state === "queued");
    logImport({
      event: "import_worker_heartbeat",
      queued: queued?.total ?? 0,
      active: states
        .filter((row) => row.state !== "queued")
        .reduce((total, row) => total + row.total, 0),
      oldestQueuedMs: queued?.oldest
        ? Math.max(0, Date.now() - new Date(queued.oldest).getTime())
        : 0,
    });
  } catch (error) {
    logImport({
      event: "import_worker_retry",
      delayMs: 30_000,
      failure: importFailure(error),
    });
  } finally {
    checkingQueue = false;
  }
}
logImport({ event: "import_worker_started", pid: process.pid });
const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
heartbeatTimer.unref();
try {
  await heartbeat();
  while (!stopping) {
    try {
      if (!(await processNextImport())) await idle(2000);
    } catch (error) {
      logImport({
        event: "import_worker_retry",
        delayMs: 5000,
        failure: importFailure(error),
      });
      await idle(5000);
    }
  }
} finally {
  clearInterval(heartbeatTimer);
  await db.$client.end();
  clearTimeout(shutdownTimer);
  logImport({ event: "import_worker_stopped", pid: process.pid });
  process.disconnect?.();
}
