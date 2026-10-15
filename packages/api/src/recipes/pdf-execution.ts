import { Worker } from "node:worker_threads";
import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import { AccountRequestLimit } from "../account-request-limit";

export type PdfPayload = {
  content: RecipeContent;
  sourceUrl: string | null;
  origin: string;
};

export class PdfResourceError extends Error {
  constructor(
    readonly kind: "rate" | "busy" | "deadline" | "aborted" | "failed",
    readonly retryAfter = 1,
  ) {
    super(`PDF export ${kind}`);
  }
}

function runWorker({
  workerUrl,
  payload,
  signal,
  deadlineMs,
}: {
  workerUrl: URL;
  payload: PdfPayload;
  signal: AbortSignal;
  deadlineMs: number;
}): Promise<Uint8Array> {
  if (signal.aborted) return Promise.reject(new PdfResourceError("aborted"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: payload,
      // The worker gets recipe data only; it needs no provider or DB credentials.
      env: { NODE_ENV: "production" },
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
      },
    });
    let finishing = false;
    const finish = (result: Uint8Array | PdfResourceError) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      // Keep the admission slot until termination confirms the CPU work stopped.
      void worker.terminate().then(
        () => {
          if (result instanceof PdfResourceError) reject(result);
          else resolve(result);
        },
        () => reject(new PdfResourceError("failed")),
      );
    };
    const onAbort = () => finish(new PdfResourceError("aborted"));
    const timer = setTimeout(
      () => finish(new PdfResourceError("deadline")),
      deadlineMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (data: unknown) => {
      if (!(data instanceof Uint8Array) || data.byteLength > 10_485_760) {
        finish(new PdfResourceError("failed"));
        return;
      }
      finish(data);
    });
    worker.once("error", () => finish(new PdfResourceError("failed")));
    worker.once("exit", () => finish(new PdfResourceError("failed")));
    if (signal.aborted) onAbort();
  });
}

export class PdfExporter {
  private readonly accounts = new AccountRequestLimit(6);
  private readonly active = new Set<string>();

  constructor(
    private readonly workerUrl: URL,
    private readonly deadlineMs = 10_000,
    private readonly concurrency = 2,
  ) {}

  async export({
    accountId,
    signal,
    load,
  }: {
    accountId: string;
    signal: AbortSignal;
    load: () => Promise<PdfPayload>;
  }): Promise<Uint8Array> {
    const retryAfter = this.accounts.take(accountId);
    if (retryAfter !== null) throw new PdfResourceError("rate", retryAfter);
    if (this.active.has(accountId) || this.active.size >= this.concurrency)
      throw new PdfResourceError("busy");
    if (signal.aborted) throw new PdfResourceError("aborted");
    this.active.add(accountId);
    try {
      const payload = await load();
      return await runWorker({
        workerUrl: this.workerUrl,
        payload,
        signal,
        deadlineMs: this.deadlineMs,
      });
    } finally {
      this.active.delete(accountId);
    }
  }
}
