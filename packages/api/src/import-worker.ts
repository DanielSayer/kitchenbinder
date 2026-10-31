import { setTimeout } from "node:timers/promises";
import { db } from "@prep-sheet/db";
import { z } from "zod";
import { importFailure, logImport } from "./import-diagnostics";
import { inspectImportQueue, processNextImport } from "./imports";
import { sweepRecipeMedia } from "./recipes/media";
import {
  stopWorkerHeartbeat,
  type WorkerProgress,
  workerHeartbeatPath,
  writeWorkerHeartbeat,
} from "./worker-heartbeat";
import { readWorkerHeartbeat } from "./worker-state";
import { readWorkerWakeup, waitForWorkerWakeup } from "./worker-wakeup";

let stopping = false;
const idleAbort = new AbortController();
const reconcileMs = z.coerce
  .number()
  .int()
  .min(1000)
  .max(86_400_000)
  .parse(process.env.WORKER_RECONCILE_MS ?? 30 * 60 * 1000);
let progress: WorkerProgress = {
  mode: "processing",
  progressAt: Date.now(),
  failureSince: null,
  queue: (await readWorkerHeartbeat(workerHeartbeatPath()))?.queue ?? null,
};
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
let writingHeartbeat: Promise<void> | undefined;
async function heartbeat() {
  if (writingHeartbeat) {
    await writingHeartbeat;
    return heartbeat();
  }
  if (stopping) return;
  const current = progress;
  writingHeartbeat = writeWorkerHeartbeat(current)
    .then(() =>
      logImport({ event: "import_worker_heartbeat", mode: current.mode }),
    )
    .catch((error: unknown) => {
      logImport({
        event: "import_worker_retry",
        delayMs: 30_000,
        failure: importFailure(error),
      });
    })
    .finally(() => {
      writingHeartbeat = undefined;
    });
  await writingHeartbeat;
}
let sweeping: Promise<void> | undefined;
async function refreshQueue() {
  const scan = await inspectImportQueue(reconcileMs);
  progress = { ...progress, queue: scan.queue };
  await heartbeat();
  return scan.delayMs;
}
function sweep() {
  if (sweeping || stopping) return;
  sweeping = sweepRecipeMedia()
    .then(({ scanned, deleted }) => {
      if (scanned)
        logImport({ event: "media_sweep_completed", scanned, deleted });
    })
    .catch((error: unknown) =>
      logImport({ event: "media_sweep_failed", failure: importFailure(error) }),
    )
    .finally(() => {
      sweeping = undefined;
    });
}
logImport({ event: "import_worker_started", pid: process.pid });
const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
heartbeatTimer.unref();
// Unreferenced photos (deleted recipes) are removed every six hours.
const sweepTimer = setInterval(sweep, 6 * 60 * 60 * 1000);
sweepTimer.unref();
sweep();
try {
  await heartbeat();
  while (!stopping) {
    try {
      // Capture before scanning. A submission racing with the drain changes the
      // token and prevents the worker sleeping through that new job.
      const previous = await readWorkerWakeup();
      progress = { ...progress, mode: "processing", progressAt: Date.now() };
      await heartbeat();
      const processed = await processNextImport(
        undefined,
        undefined,
        async () => {
          progress = {
            ...progress,
            mode: "processing",
            progressAt: Date.now(),
          };
          await heartbeat();
          // Stage boundaries already use the database. Keep cached queue state
          // current without adding queries to the periodic local heartbeat.
          await refreshQueue().catch((error: unknown) => {
            logImport({
              event: "import_queue_observation_failed",
              failure: importFailure(error),
            });
          });
        },
      );
      progress = {
        ...progress,
        mode: "processing",
        progressAt: Date.now(),
        failureSince: null,
      };
      if (processed) continue;
      const delayMs = await refreshQueue();
      progress = { ...progress, mode: "waiting", progressAt: Date.now() };
      await heartbeat();
      await waitForWorkerWakeup({
        previous,
        delayMs,
        signal: idleAbort.signal,
      });
    } catch (error) {
      progress = {
        ...progress,
        mode: "retrying",
        progressAt: Date.now(),
        failureSince: progress.failureSince ?? Date.now(),
      };
      await heartbeat();
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
  clearInterval(sweepTimer);
  await sweeping;
  // Wait for the in-flight writer before removing the clean-shutdown marker.
  await writingHeartbeat;
  await stopWorkerHeartbeat();
  await db.$client.end();
  clearTimeout(shutdownTimer);
  logImport({ event: "import_worker_stopped", pid: process.pid });
  process.disconnect?.();
}
