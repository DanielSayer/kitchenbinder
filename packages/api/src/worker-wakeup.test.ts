import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import {
  notifyImportWorker,
  readWorkerWakeup,
  waitForWorkerWakeup,
} from "./worker-wakeup";

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup() {
  directory = await mkdtemp(join(tmpdir(), "worker-wakeup-"));
  const path = join(directory, "request");
  vi.stubEnv("WORKER_WAKE_PATH", path);
  return path;
}

it("retains notifications before a wait and wakes a sleeping worker using only local files", async () => {
  const path = await setup();
  expect(await readWorkerWakeup()).toBeNull();
  expect(await notifyImportWorker()).toBe(true);
  const previous = await readWorkerWakeup();
  expect(await readFile(path, "utf8")).toMatch(/^[a-f0-9-]{36}$/);
  const started = Date.now();
  await waitForWorkerWakeup({
    previous: null,
    delayMs: 10_000,
    signal: new AbortController().signal,
  });
  expect(Date.now() - started).toBeLessThan(1000);
  const waiting = waitForWorkerWakeup({
    previous,
    delayMs: 10_000,
    signal: new AbortController().signal,
  });
  await notifyImportWorker();
  await waiting;
  expect(await readWorkerWakeup()).not.toBe(previous);
});

it("coalesces concurrent submissions without partial tokens and cancels waits on shutdown", async () => {
  await setup();
  expect(
    await Promise.all(Array.from({ length: 8 }, () => notifyImportWorker())),
  ).not.toContain(false);
  const previous = await readWorkerWakeup();
  const stop = new AbortController();
  const waiting = waitForWorkerWakeup({
    previous,
    delayMs: 30_000,
    signal: stop.signal,
  });
  stop.abort();
  await waiting;
  const started = Date.now();
  await waitForWorkerWakeup({
    previous,
    delayMs: 30,
    signal: new AbortController().signal,
  });
  expect(Date.now() - started).toBeLessThan(1000);
});

it("keeps notification failure best effort after bounded retries", async () => {
  const path = await setup();
  await mkdir(path);
  expect(await notifyImportWorker()).toBe(false);
  await setTimeout(1);
});

it("allows recovery scans when an advisory token is damaged", async () => {
  const path = await setup();
  await writeFile(path, "incomplete token");
  expect(await readWorkerWakeup()).toBeNull();
  expect(await notifyImportWorker()).toBe(true);
  expect(await readWorkerWakeup()).not.toBeNull();
});
