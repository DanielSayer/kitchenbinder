import { setTimeout } from "node:timers/promises";
import { db } from "@prep-sheet/db";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { count, inArray, min } from "drizzle-orm";
import { importFailure, logImport } from "./import-diagnostics";
import { processNextImport } from "./imports";

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
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
      if (!(await processNextImport())) await setTimeout(2000);
    } catch (error) {
      logImport({
        event: "import_worker_retry",
        delayMs: 5000,
        failure: importFailure(error),
      });
      await setTimeout(5000);
    }
  }
} finally {
  clearInterval(heartbeatTimer);
  await db.$client.end();
  logImport({ event: "import_worker_stopped", pid: process.pid });
}
