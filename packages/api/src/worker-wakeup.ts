import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { importFailure, logImport } from "./import-diagnostics";

function defaultWakeupPath() {
  let directory = process.cwd();
  while (!existsSync(resolve(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) return resolve("tmp/worker-wake/request");
    directory = parent;
  }
  return resolve(directory, "tmp/worker-wake/request");
}
const defaultPath = defaultWakeupPath();
const wakeupPath = () => process.env.WORKER_WAKE_PATH ?? defaultPath;

export async function readWorkerWakeup() {
  try {
    const token = z.uuid().safeParse(await readFile(wakeupPath(), "utf8"));
    // A damaged advisory signal must not prevent startup/reconciliation scans.
    return token.success ? token.data : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

// Called only after the queue transaction commits. A coalesced local signal
// contains no job data; the durable database queue remains authoritative.
export async function notifyImportWorker() {
  const path = wakeupPath();
  const token = randomUUID();
  const temporary = `${path}.${token}.tmp`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, token, { mode: 0o644 });
      await rename(temporary, path);
      return true;
    } catch (error) {
      if (attempt === 2) {
        logImport({
          event: "import_worker_wakeup_failed",
          failure: importFailure(error),
        });
        return false;
      }
      await setTimeout(100 * (attempt + 1));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  return false;
}

export async function waitForWorkerWakeup({
  previous,
  delayMs,
  signal,
}: {
  previous: string | null;
  delayMs: number;
  signal: AbortSignal;
}) {
  const deadline = Date.now() + delayMs;
  while (!signal.aborted) {
    // Read before sleeping so a notification during the queue scan is retained.
    if ((await readWorkerWakeup()) !== previous) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    try {
      await setTimeout(Math.min(1000, remaining), undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
