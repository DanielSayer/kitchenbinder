import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { recipeImport, recipeImportPhoto } from "@prep-sheet/db/schema/import";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { pricing } from "../billing/policy";
import { reserveAiSpend } from "../billing/usage";
import { preparePlacement } from "../households/placement";
import {
  generateRecipe,
  prepareRecipeInput,
  recipeSystemPrompt,
  requireRecipeProvider,
  withImageChoices,
} from "../recipes/generate";
import { availableTags } from "../routers/tags";
import type { QueueObservation } from "../worker-state";
import { type Generated, writeCheckpoint } from "./checkpoint";
import { importFailure, logImport, type Stage } from "./diagnostics";
import { sourceOf } from "./legacy";
import {
  activeStates,
  type Claim,
  inFlightStates,
  transition,
} from "./lifecycle";
import type { ProcessResult } from "./result";
import { retrySave, type SaveClaim, saveCheckpoint } from "./save";
import { timing } from "./timing";

export type ProcessOptions = {
  generate?: (...args: Parameters<typeof generateRecipe>) => Promise<Generated>;
  /** Fails before spend is reserved when the AI provider cannot be called. */
  requireProvider?: () => void;
  reportProgress?: (stage: Stage) => Promise<void>;
};

// A dedicated process awaits this function. No work is launched by HTTP handlers.
export async function processNext({
  generate = generateRecipe,
  requireProvider = requireRecipeProvider,
  reportProgress = async () => {},
}: ProcessOptions = {}): Promise<ProcessResult> {
  await resetExpiredClaims();
  const job = await claimNext();
  if (!job) return { kind: "idle" };
  if (job.kind === "save") return saveCheckpoint(job, reportProgress);
  return generateCheckpoint(job, { generate, requireProvider, reportProgress });
}

async function resetExpiredClaims() {
  const { activeExpired } = timing();
  // Do not replay an AI call whose outcome was lost with its worker. Keep the ID terminal.
  await transition(db, { expired: activeExpired }, "processing", "failed", {
    input: "",
    imageCandidates: null,
    error:
      "Processing was interrupted. Start a new attempt to try again; this import will not run twice.",
  });
  // Backstop for any path that ended generation without deleting its photos.
  await db.execute(
    sql`delete from ${recipeImportPhoto} using ${recipeImport} where ${recipeImportPhoto.importId} = ${recipeImport.id} and ${recipeImport.state} not in ('queued', 'fetching', 'processing')`,
  );
  // Fetching is safe to repeat; a call that reached AI is never replayed.
  await transition(db, { expired: activeExpired }, "fetching", "queued", {
    startedAt: null,
    workerToken: null,
  });
}

function claimNext() {
  return db.transaction(async (tx) => {
    // Serialize claims across every worker, not just this process.
    await tx.execute(sql`select pg_advisory_xact_lock(728193041)`);
    const { saveClaimExpired, saveDue } = timing();
    // A terminated saver leaves a durable lease. Skip rows held by live save transactions.
    const abandoned = await tx
      .select()
      .from(recipeImport)
      .where(and(eq(recipeImport.state, "ready"), saveClaimExpired))
      .limit(100)
      .for("update", { skipLocked: true });
    for (const claim of abandoned) {
      if (claim.workerToken)
        await retrySave(
          tx,
          { ...claim, workerToken: claim.workerToken },
          Object.assign(new Error(), { name: "SaveClaimExpired" }),
          Date.now(),
        );
    }
    const [active] = await tx
      .select({ total: count() })
      .from(recipeImport)
      .where(inArray(recipeImport.state, activeStates));
    const queuedEligible = (active?.total ?? 0) < pricing.ai.concurrentAttempts;
    const [next] = await tx
      .select()
      .from(recipeImport)
      .where(
        or(
          and(eq(recipeImport.state, "ready"), saveDue),
          ...(queuedEligible ? [eq(recipeImport.state, "queued")] : []),
        ),
      )
      // Retries rejoin behind work that was already eligible, including queued work.
      .orderBy(
        asc(
          sql`case when ${recipeImport.state} = 'ready' then ${recipeImport.nextSaveAttemptAt} else ${recipeImport.createdAt} end`,
        ),
        asc(recipeImport.createdAt),
        asc(recipeImport.id),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const workerToken = randomUUID();
    if (next.state === "ready") {
      const saveAttempts = next.saveAttempts + 1;
      await transition(tx, { locked: next.id }, "ready", "ready", {
        workerToken,
        saveClaimedAt: new Date(),
        saveAttempts,
      });
      return {
        kind: "save",
        id: next.id,
        workerToken,
        saveAttempts,
      } as const;
    }
    await transition(tx, { locked: next.id }, "queued", "fetching", {
      startedAt: new Date(),
      workerToken,
    });
    return { kind: "generate", ...next, workerToken } as const;
  });
}

type GenerateJob = typeof recipeImport.$inferSelect & { workerToken: string };

async function generateCheckpoint(
  job: GenerateJob,
  { generate, requireProvider, reportProgress }: Required<ProcessOptions>,
): Promise<ProcessResult> {
  const claim: Claim = { id: job.id, workerToken: job.workerToken };
  const started = Date.now();
  let stage: "fetching" | "generating" = "fetching";
  let stageStarted = started;
  await reportProgress(stage);
  logImport({
    event: "import_claimed",
    importId: job.id,
    sourceKind: job.sourceKind,
    queueMs: Math.max(0, started - job.createdAt.getTime()),
  });
  logImport({ event: "import_stage_started", importId: job.id, stage });
  let generationStarted = false;
  let saveClaim: SaveClaim | undefined;
  try {
    await preparePlacement(db, job.userId, job, { lock: false });
    const photos =
      sourceOf(job.sourceKind) === "photo"
        ? await promptPhotos(job.id)
        : undefined;
    // Photo imports never fetch, even when the text holds a URL.
    const prepared = photos
      ? { content: job.input, sourceUrl: null, images: [] }
      : await prepareRecipeInput(job.input, job.sourceUrl ?? undefined, job.id);
    if (!prepared.images.length && job.imageCandidates)
      prepared.images = job.imageCandidates;
    const tags = await availableTags(job.userId);
    // A missing provider key must fail before reserving spend or consuming AI usage.
    requireProvider();
    recipeSystemPrompt(
      withImageChoices(prepared.content, prepared.images),
      tags,
      prepared.sourceUrl,
      !!photos,
    );
    // Persist the exact input before crossing the AI boundary.
    const claimed = await db.transaction(async (tx) => {
      const claimed = await transition(
        tx,
        { held: claim },
        "fetching",
        "processing",
        {
          input: prepared.content,
          sourceUrl: prepared.sourceUrl,
          imageCandidates: prepared.images.length ? prepared.images : null,
          startedAt: new Date(),
        },
      );
      if (claimed.length) await reserveAiSpend(tx, job.id);
      return claimed;
    });
    if (!claimed.length) return { kind: "lost", importId: job.id };
    logImport({
      event: "import_stage_completed",
      importId: job.id,
      stage,
      elapsedMs: Date.now() - stageStarted,
    });
    stage = "generating";
    stageStarted = Date.now();
    await reportProgress(stage);
    logImport({ event: "import_stage_started", importId: job.id, stage });
    generationStarted = true;
    const args: Parameters<typeof generateRecipe> = [
      prepared.content,
      tags,
      prepared.sourceUrl ?? undefined,
      prepared.images,
    ];
    if (photos) args.push({ photos });
    const result = await generate(...args);
    logImport({
      event: "import_stage_completed",
      importId: job.id,
      stage,
      elapsedMs: Date.now() - stageStarted,
    });
    // A save failure retries this checkpoint, never generation.
    const checkpointed = await db.transaction((tx) =>
      transition(tx, { held: claim }, "processing", "ready", {
        saveAttempts: 1,
        saveClaimedAt: new Date(),
        nextSaveAttemptAt: new Date(),
        input: "",
        sourceUrl: result.sourceUrl,
        imageCandidates: null,
        generated: writeCheckpoint(job.id, result),
      }),
    );
    if (!checkpointed.length) return { kind: "lost", importId: job.id };
    saveClaim = { ...claim, saveAttempts: 1 };
  } catch (error) {
    await transition(db, { held: claim }, activeStates, "failed", {
      input: "",
      imageCandidates: null,
      usageReleased: !generationStarted,
      error:
        error instanceof TRPCError
          ? error.message
          : "Processing failed. Start a new attempt to try again.",
    });
    logImport({
      event: "import_failed",
      importId: job.id,
      stage,
      elapsedMs: Date.now() - stageStarted,
      usageReleased: !generationStarted,
      failure: importFailure(error),
    });
    return {
      kind: "failed",
      importId: job.id,
      stage,
      usageReleased: !generationStarted,
    };
  }
  return saveCheckpoint(saveClaim, reportProgress);
}

// Re-encode uploads before they reach the provider, dropping metadata and
// anything that is not a plain raster image.
async function promptPhotos(id: string) {
  const rows = await db
    .select({ data: recipeImportPhoto.data })
    .from(recipeImportPhoto)
    .where(eq(recipeImportPhoto.importId, id))
    .orderBy(asc(recipeImportPhoto.position));
  if (!rows.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The photos for this import are missing. Add them again.",
    });
  // Loaded lazily: sharp's native binary must stay out of the web server bundle.
  const { promptPhoto } = await import("../recipes/media");
  const photos = [];
  for (const row of rows) {
    try {
      photos.push(await promptPhoto(row.data));
    } catch (cause) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "One of the photos couldn't be read. Try a JPEG, PNG or WebP photo.",
        cause,
      });
    }
  }
  return photos;
}

const millis = (value: SQL) =>
  sql<number | null>`(extract(epoch from ${value})*1000)::float8`;

// Scheduling and cached alert timestamps share one query while the worker is
// already awake. The periodic local heartbeat never invokes this scan.
export async function inspectQueue(maximumMs: number) {
  const { current, dueAt } = timing();
  const state = recipeImport.state;
  const activeSince = sql`coalesce(${recipeImport.startedAt},${recipeImport.createdAt})`;
  // A save that failed at least once; a first save holding its claim is not a failure yet.
  const failedSave = sql`${recipeImport.saveAttempts}>0 AND (${state}='failed' OR (${state}='ready' AND (${recipeImport.saveClaimedAt} IS NULL OR ${recipeImport.saveAttempts}>1)))`;
  const [next] = await db
    .select({
      queuedAt: millis(
        sql`min(${recipeImport.createdAt}) filter (where ${state}='queued')`,
      ),
      readyAt: millis(sql`min(${activeSince}) filter (where ${state}='ready')`),
      activeAt: millis(
        sql`min(${activeSince}) filter (where ${inArray(state, activeStates)})`,
      ),
      saveFailureAt: millis(
        sql`min(${recipeImport.createdAt}) filter (where ${failedSave})`,
      ),
      delayMs: millis(sql`min(${dueAt}) - ${current}`),
    })
    .from(recipeImport)
    .where(
      or(
        inArray(state, inFlightStates),
        and(eq(state, "failed"), sql`${recipeImport.saveAttempts} > 0`),
      ),
    );
  const queue: QueueObservation = {
    observedAt: Date.now(),
    queuedAt: next?.queuedAt ?? null,
    readyAt: next?.readyAt ?? null,
    activeAt: next?.activeAt ?? null,
    saveFailureAt: next?.saveFailureAt ?? null,
  };
  return {
    delayMs: Math.max(100, Math.min(maximumMs, next?.delayMs ?? maximumMs)),
    queue,
  };
}
