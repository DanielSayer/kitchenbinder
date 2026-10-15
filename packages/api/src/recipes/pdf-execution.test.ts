import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { expect, it } from "vitest";
import { sampleRecipe } from "./fixtures";
import { PdfExporter, PdfResourceError } from "./pdf-execution";

const workerUrl = new URL("./fixtures/pdf-worker.mjs", import.meta.url);
const payload = { content: sampleRecipe, sourceUrl: null, origin: "manual" };
const signal = () => new AbortController().signal;

it("rejects saturation before loading data, keeps health responsive, kills CPU work and recovers slots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prep-sheet-pdf-"));
  const markers = [join(directory, "a.txt"), join(directory, "b.txt")];
  const exporter = new PdfExporter(workerUrl, 1_000);
  const server = createServer((_request, response) => response.end("OK"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected listening server");
  let rejectedLoads = 0;
  const blockedLoad = async () => {
    rejectedLoads++;
    return payload;
  };
  const run = (accountId: string) =>
    exporter
      .export({
        accountId,
        signal: signal(),
        load: async () => ({
          ...payload,
          origin: "spin",
          sourceUrl: join(directory, `${accountId}.txt`),
        }),
      })
      .catch((error: unknown) => error);
  try {
    const first = run("a");
    const second = run("b");
    await expect(
      exporter.export({ accountId: "a", signal: signal(), load: blockedLoad }),
    ).rejects.toMatchObject({ kind: "busy" });
    await expect(
      exporter.export({ accountId: "c", signal: signal(), load: blockedLoad }),
    ).rejects.toMatchObject({ kind: "busy" });
    expect(rejectedLoads).toBe(0);
    // Workers are doing synchronous CPU work while the web event loop responds.
    for (let attempt = 0; attempt < 30; attempt++) {
      if (markers.every((marker) => existsSync(`${marker}.started`))) break;
      await setTimeout(25);
    }
    expect(markers.every((marker) => existsSync(`${marker}.started`))).toBe(
      true,
    );
    const health = await fetch(`http://127.0.0.1:${address.port}`, {
      signal: AbortSignal.timeout(500),
    });
    expect(await health.text()).toBe("OK");
    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      expect.objectContaining({ kind: "deadline" }),
      expect.objectContaining({ kind: "deadline" }),
    ]);
    expect(
      await exporter.export({
        accountId: "c",
        signal: signal(),
        load: async () => payload,
      }),
    ).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
    // A Promise.race-only timeout would leave both workers alive to write this.
    await setTimeout(1_600);
    expect(markers.some((marker) => existsSync(marker))).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

it("releases slots after aborts, lookup failures and renderer crashes", async () => {
  const exporter = new PdfExporter(workerUrl);
  const directory = await mkdtemp(join(tmpdir(), "prep-sheet-abort-"));
  try {
    const abort = new AbortController();
    const active = exporter.export({
      accountId: "a",
      signal: abort.signal,
      load: async () => ({
        ...payload,
        origin: "spin",
        sourceUrl: join(directory, "survived.txt"),
      }),
    });
    const failed = expect(active).rejects.toMatchObject({ kind: "aborted" });
    await setTimeout(100);
    abort.abort();
    await failed;
    await expect(
      exporter.export({
        accountId: "a",
        signal: signal(),
        load: async () => {
          throw new Error("Lookup failed");
        },
      }),
    ).rejects.toThrow("Lookup failed");
    await expect(
      exporter.export({
        accountId: "a",
        signal: signal(),
        load: async () => ({ ...payload, origin: "fail" }),
      }),
    ).rejects.toMatchObject({ kind: "failed" });
    expect(
      await exporter.export({
        accountId: "a",
        signal: signal(),
        load: async () => payload,
      }),
    ).toHaveLength(5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("limits repeated account attempts and leaves other accounts available", async () => {
  const exporter = new PdfExporter(workerUrl);
  for (let i = 0; i < 6; i++) {
    await expect(
      exporter.export({
        accountId: "a",
        signal: signal(),
        load: async () => {
          throw new Error("Missing recipe");
        },
      }),
    ).rejects.toThrow("Missing recipe");
  }
  const rejected = exporter.export({
    accountId: "a",
    signal: signal(),
    load: async () => payload,
  });
  await expect(rejected).rejects.toBeInstanceOf(PdfResourceError);
  await expect(rejected).rejects.toMatchObject({
    kind: "rate",
    retryAfter: 60,
  });
  expect(
    await exporter.export({
      accountId: "b",
      signal: signal(),
      load: async () => payload,
    }),
  ).toHaveLength(5);
});
