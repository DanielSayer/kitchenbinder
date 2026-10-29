import { z } from "zod";

type Stage = "fetching" | "generating" | "saving";
type ImportEvent =
  | { event: "import_worker_started" | "import_worker_stopped"; pid: number }
  | { event: "import_worker_retry"; delayMs: number; failure: Failure }
  | {
      event: "import_worker_heartbeat";
      queued: number;
      active: number;
      oldestQueuedMs: number;
    }
  | { event: "import_queued"; importId: string; sourceKind: string }
  | {
      event: "import_claimed";
      importId: string;
      sourceKind: string;
      queueMs: number;
    }
  | { event: "import_stage_started"; importId: string; stage: Stage }
  | {
      event: "import_stage_completed";
      importId: string;
      stage: Stage;
      elapsedMs: number;
    }
  | {
      event: "import_failed";
      importId: string;
      stage: Stage;
      elapsedMs: number;
      usageReleased: boolean;
      failure: Failure;
    }
  | {
      event: "import_saved";
      importId: string;
      recipes: number;
      elapsedMs: number;
    }
  | {
      event: "import_save_retry";
      importId: string;
      elapsedMs: number;
      attempt: number;
      delayMs: number;
      failure: Failure;
    }
  | {
      event: "import_save_retry_failed";
      importId: string;
      attempt: number;
      failure: Failure;
      saveFailure: Failure;
    }
  | {
      event: "import_photo_saved" | "import_photo_skipped";
      importId: string;
      elapsedMs: number;
    }
  | {
      event: "import_photo_failed";
      importId: string;
      elapsedMs: number;
      failure: Failure;
    }
  | { event: "media_sweep_completed"; scanned: number; deleted: number }
  | { event: "media_sweep_failed"; failure: Failure }
  | {
      event: "import_page_response";
      importId: string;
      hostname: string;
      status: number;
      redirect: number;
    };

// Never serialise provider exceptions: they can contain prompts, URLs and keys.
const failureSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
});
type Failure = z.infer<typeof failureSchema> & { type: string };

export function importFailure(error: unknown): Failure {
  const parsed = failureSchema.safeParse(error);
  const type =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
      ? error.name
      : "UnknownError";
  const cause = error instanceof Error && error.cause ? error.cause : error;
  const detail = failureSchema.safeParse(cause);
  return {
    type,
    ...(parsed.success ? parsed.data : {}),
    ...(detail.success ? detail.data : {}),
  };
}

export function logImport(event: ImportEvent) {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
  );
}
