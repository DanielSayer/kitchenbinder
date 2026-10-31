import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { QueueObservation } from "./worker-state";

// One supervised worker per heartbeat path. Compose shares this directory read-only
// with web/monitor. Atomic rename prevents probes observing a partial write.
const instance = randomUUID();
const path =
  process.env.WORKER_HEARTBEAT_PATH ?? resolve("tmp/operations/worker.json");
export type WorkerProgress = {
  mode: "waiting" | "processing" | "retrying";
  progressAt: number;
  failureSince: number | null;
  queue: QueueObservation | null;
};

export async function writeWorkerHeartbeat(
  progress: WorkerProgress = {
    mode: "waiting",
    progressAt: Date.now(),
    failureSince: null,
    queue: null,
  },
) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${instance}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        instance,
        ...progress,
      }),
      { mode: 0o644 },
    );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function clearWorkerHeartbeat() {
  await rm(path, { force: true });
}
