import { createHash, randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { user } from "@prep-sheet/db/schema/auth";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { refreshBillingIfStale } from "./billing/polar";
import { pricing } from "./billing/policy";
import {
  checkAiAllowance,
  checkRecipeCapacity,
  reserveAiSpend,
} from "./billing/usage";
import { accessibleRecipe, type Database } from "./households/access";
import {
  applyPlacement,
  type Placement,
  preparePlacement,
} from "./households/placement";
import {
  type ImportStatus,
  recipesPerImport,
  websiteImportSchema,
} from "./import-contract";
import { importFailure, logImport } from "./import-diagnostics";
import {
  generateRecipe,
  prepareRecipeInput,
  recipeSystemPrompt,
  requireRecipeProvider,
  withImageChoices,
} from "./recipes/generate";
import { persistRecipe } from "./recipes/persist";
import { checkRecipeUsage } from "./recipes/usage";
import { availableTags } from "./routers/tags";

// Imports before multi-recipe imports saved one recipe with the import ID.
const savedRecipeIds = (job: { id: string; recipeIds: string[] | null }) =>
  job.recipeIds?.length ? job.recipeIds : [job.id];

export async function recentImports(userId: string) {
  const jobs = await db
    .select({
      id: recipeImport.id,
      state: recipeImport.state,
      sourceKind: recipeImport.sourceKind,
      sourceUrl: recipeImport.sourceUrl,
      createdAt: recipeImport.createdAt,
      error: recipeImport.error,
      recipeIds: recipeImport.recipeIds,
    })
    .from(recipeImport)
    .where(eq(recipeImport.userId, userId))
    .orderBy(
      desc(
        inArray(recipeImport.state, [
          "queued",
          "fetching",
          "processing",
          "ready",
        ]),
      ),
      desc(recipeImport.createdAt),
      desc(recipeImport.id),
    )
    .limit(50);
  const ids = jobs
    .filter((job) => job.state === "saved")
    .flatMap(savedRecipeIds);
  const recipes = ids.length
    ? await db
        .select({ id: recipe.id, title: recipe.title, photo: recipe.photo })
        .from(recipe)
        .where(and(inArray(recipe.id, ids), accessibleRecipe(userId)))
    : [];
  return jobs.map(({ recipeIds, ...job }) => {
    const saved =
      job.state === "saved"
        ? savedRecipeIds({ id: job.id, recipeIds }).flatMap((id) =>
            recipes.filter((item) => item.id === id),
          )
        : [];
    return {
      ...job,
      recipeId: saved[0]?.id ?? null,
      title: saved[0]?.title ?? null,
      photo: saved[0]?.photo ?? null,
      recipes: saved.map(({ id, title }) => ({ id, title })),
    };
  });
}

export async function importStatus(
  userId: string,
  id: string,
): Promise<ImportStatus> {
  const [job] = await db
    .select()
    .from(recipeImport)
    .where(and(eq(recipeImport.id, id), eq(recipeImport.userId, userId)));
  if (!job)
    throw new TRPCError({ code: "NOT_FOUND", message: "Import not found." });
  switch (job.state) {
    case "queued":
      return {
        kind: "queued",
        id,
        queuedForMs: Math.max(0, Date.now() - job.createdAt.getTime()),
      };
    case "fetching":
      return { kind: "processing", id, stage: "fetching" };
    case "processing":
      return { kind: "processing", id, stage: "generating" };
    case "ready":
      return { kind: "processing", id, stage: "saving" };
    case "failed":
      return {
        kind: "failed",
        id,
        message:
          job.error ?? "Import failed. Start a new attempt to try again.",
      };
    case "saved": {
      // Imported recipes are owned by the importer; a deleted recipe is not exposed.
      const ids = savedRecipeIds(job);
      const found = await db
        .select({ id: recipe.id, title: recipe.title })
        .from(recipe)
        .where(
          and(
            inArray(recipe.id, ids),
            eq(recipe.userId, userId),
            isNull(recipe.deletedAt),
          ),
        );
      const recipes = ids.flatMap((recipeId) =>
        found.filter((item) => item.id === recipeId),
      );
      const [first] = recipes;
      if (!first)
        return {
          kind: "failed",
          id,
          message:
            ids.length > 1
              ? "The saved recipes have been deleted."
              : "The saved recipe has been deleted.",
        };
      return {
        kind: "saved",
        id,
        recipeId: first.id,
        title: first.title,
        recipes,
      };
    }
  }
}

type JobInput = Placement & {
  id: string;
  content: string;
  sourceUrl: string | null;
  sourceKind: "website";
};

function fingerprintOf(input: JobInput) {
  // "groupId" keeps fingerprints of imports admitted before households stable.
  return createHash("sha256")
    .update(
      JSON.stringify({
        content: input.content,
        sourceUrl: input.sourceUrl,
        groupId: input.householdId,
        ...(input.collectionId ? { collectionId: input.collectionId } : {}),
        sourceKind: input.sourceKind,
      }),
    )
    .digest("hex");
}

async function discardJob(userId: string, input: JobInput) {
  const fingerprint = fingerprintOf(input);
  await db.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    const [existing] = await tx
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, input.id));
    if (existing) {
      if (existing.userId !== userId || existing.fingerprint !== fingerprint)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This import ID has already been used.",
        });
      if (existing.state !== "saved" && existing.state !== "failed")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Your import is still processing. Check it again shortly.",
        });
      return;
    }
    const [recent] = await tx
      .select({ total: count() })
      .from(recipeImport)
      .where(
        and(
          eq(recipeImport.userId, userId),
          gte(recipeImport.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    if ((recent?.total ?? 0) >= 60)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Please wait a minute before cancelling another request.",
      });
    // A durable tombstone prevents a delayed submission from being accepted after reset.
    await tx.insert(recipeImport).values({
      id: input.id,
      userId,
      householdId: input.householdId,
      collectionId: input.collectionId,
      fingerprint,
      sourceUrl: input.sourceUrl,
      input: "",
      state: "failed",
      usageReleased: true,
      sourceKind: input.sourceKind,
      error:
        "This import was discarded. Start another import to save the recipe.",
    });
  });
}

function websiteInput(value: unknown): JobInput {
  const input = websiteImportSchema.parse(value);
  return {
    id: input.id,
    content: input.input,
    householdId: input.householdId ?? null,
    collectionId: input.collectionId ?? null,
    sourceUrl: null,
    sourceKind: "website",
  };
}

export function submitWebsiteImport(userId: string, value: unknown) {
  return submitJob(userId, websiteInput(value));
}

export function discardWebsiteImport(userId: string, value: unknown) {
  return discardJob(userId, websiteInput(value));
}

async function submitJob(userId: string, input: JobInput) {
  const fingerprint = fingerprintOf(input);
  const [existing] = await db
    .select({ id: recipeImport.id })
    .from(recipeImport)
    .where(eq(recipeImport.id, input.id));
  // Recover admitted requests even if the billing provider is unavailable.
  if (!existing) await refreshBillingIfStale(userId);
  const admitted = await db.transaction(async (tx) => {
    // Serialize admissions and retries per account before checking the job or quota.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    const [existing] = await tx
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, input.id));
    if (existing) {
      if (existing.userId !== userId || existing.fingerprint !== fingerprint)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This import ID has already been used. Recover the original import or capture again.",
        });
      return;
    }
    await preparePlacement(tx, userId, input, { lock: false });
    await checkRecipeUsage(tx, userId);
    await checkRecipeCapacity(tx, userId);
    const usageBucket = await checkAiAllowance(tx, userId);
    const [pending] = await tx
      .select({ total: count() })
      .from(recipeImport)
      .where(
        and(
          eq(recipeImport.userId, userId),
          inArray(recipeImport.state, [
            "queued",
            "fetching",
            "processing",
            "ready",
          ]),
        ),
      );
    if ((pending?.total ?? 0) >= pricing.ai.pendingPerAccount)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Your recipe queue is full. Wait for an import to finish.",
      });
    const [recent] = await tx
      .select({ total: count() })
      .from(recipeImport)
      .where(
        and(
          eq(recipeImport.userId, userId),
          gte(recipeImport.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    if ((recent?.total ?? 0) >= 5)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Please wait a minute before starting another import.",
      });
    const [collision] = await tx
      .select({ id: recipe.id })
      .from(recipe)
      .where(eq(recipe.id, input.id));
    if (collision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This recipe ID is already in use.",
      });
    await tx.insert(recipeImport).values({
      id: input.id,
      userId,
      householdId: input.householdId,
      collectionId: input.collectionId,
      input: input.content,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl,
      fingerprint,
      usageBucket,
    });
    return true;
  });
  if (admitted)
    logImport({
      event: "import_queued",
      importId: input.id,
      sourceKind: input.sourceKind,
    });
  return importStatus(userId, input.id);
}

const saveAttemptLimit = 5;
const claimTimeoutMs = 180_000;
const checkpointRecipeSchema = z.object({
  content: recipeContentSchema,
  tagIds: z.array(z.string().uuid()),
});
const checkpointSchema = z
  .union([
    z.object({
      recipes: z
        .array(checkpointRecipeSchema.extend({ id: z.string().uuid() }))
        .min(1)
        .max(recipesPerImport),
    }),
    // Written before multi-recipe imports; the recipe uses the import ID.
    checkpointRecipeSchema,
  ])
  .and(
    z.object({
      origin: z.enum(["imported", "generated"]).optional(),
      imageUrl: z.string().url().nullable().optional(),
    }),
  );

function checkpointRecipes(
  id: string,
  checkpoint: z.infer<typeof checkpointSchema>,
) {
  return "recipes" in checkpoint
    ? checkpoint.recipes
    : [{ id, content: checkpoint.content, tagIds: checkpoint.tagIds }];
}

type SaveClaim = Pick<
  typeof recipeImport.$inferSelect,
  "id" | "saveAttempts"
> & {
  workerToken: string;
};

async function retrySave(
  database: Database,
  claim: SaveClaim,
  error: unknown,
  started: number,
) {
  const exhausted = claim.saveAttempts >= saveAttemptLimit;
  const delayMs = exhausted ? 0 : 5000 * 2 ** (claim.saveAttempts - 1);
  const updated = await database
    .update(recipeImport)
    .set({
      state: exhausted ? "failed" : "ready",
      saveClaimedAt: null,
      workerToken: null,
      nextSaveAttemptAt: new Date(Date.now() + delayMs),
      error: exhausted
        ? "The generated recipe could not be saved after five attempts. Start a new import or contact support with this import reference."
        : null,
      // Keep generated output and spent usage even when the retry budget is exhausted.
    })
    .where(
      and(
        eq(recipeImport.id, claim.id),
        eq(recipeImport.state, "ready"),
        eq(recipeImport.workerToken, claim.workerToken),
      ),
    )
    .returning({ id: recipeImport.id })
    .catch((retryError: unknown) => {
      logImport({
        event: "import_save_retry_failed",
        importId: claim.id,
        attempt: claim.saveAttempts,
        saveFailure: importFailure(error),
        failure: importFailure(retryError),
      });
      throw retryError;
    });
  if (!updated.length) return;
  if (exhausted)
    logImport({
      event: "import_failed",
      importId: claim.id,
      stage: "saving",
      elapsedMs: Date.now() - started,
      usageReleased: false,
      failure: importFailure(error),
    });
  else
    logImport({
      event: "import_save_retry",
      importId: claim.id,
      attempt: claim.saveAttempts,
      delayMs,
      elapsedMs: Date.now() - started,
      failure: importFailure(error),
    });
}

type Generated = Awaited<ReturnType<typeof generateRecipe>>;
type Generate = (
  ...args: Parameters<typeof generateRecipe>
) => Promise<Omit<Generated, "imageUrl"> & { imageUrl?: string | null }>;

// A dedicated process awaits this function. No work is launched by HTTP handlers.
export async function processNextImport(
  generate: Generate = generateRecipe,
  ensureProviderReady: () => void = generate === generateRecipe
    ? requireRecipeProvider
    : () => {},
) {
  // Do not replay an AI call whose outcome was lost with its worker. Keep the ID terminal.
  await db
    .update(recipeImport)
    .set({
      state: "failed",
      input: "",
      imageCandidates: null,
      error:
        "Processing was interrupted. Start a new attempt to try again; this import will not run twice.",
    })
    .where(
      and(
        eq(recipeImport.state, "processing"),
        lt(recipeImport.startedAt, new Date(Date.now() - claimTimeoutMs)),
      ),
    );
  // Fetching is safe to repeat; a call that reached AI is never replayed.
  await db
    .update(recipeImport)
    .set({ state: "queued", startedAt: null, workerToken: null })
    .where(
      and(
        eq(recipeImport.state, "fetching"),
        lt(recipeImport.startedAt, new Date(Date.now() - claimTimeoutMs)),
      ),
    );
  const job = await db.transaction(async (tx) => {
    // Serialize claims across every worker, not just this process.
    await tx.execute(sql`select pg_advisory_xact_lock(728193041)`);
    // A terminated saver leaves a durable lease. Skip rows held by live save transactions.
    const abandoned = await tx
      .select()
      .from(recipeImport)
      .where(
        and(
          eq(recipeImport.state, "ready"),
          lt(recipeImport.saveClaimedAt, new Date(Date.now() - claimTimeoutMs)),
        ),
      )
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
      .where(inArray(recipeImport.state, ["fetching", "processing"]));
    const queuedEligible = (active?.total ?? 0) < pricing.ai.concurrentAttempts;
    const [next] = await tx
      .select()
      .from(recipeImport)
      .where(
        or(
          and(
            eq(recipeImport.state, "ready"),
            isNull(recipeImport.saveClaimedAt),
            lt(recipeImport.saveAttempts, saveAttemptLimit),
            lte(recipeImport.nextSaveAttemptAt, new Date()),
          ),
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
    const claimToken = randomUUID();
    if (next.state === "ready") {
      await tx
        .update(recipeImport)
        .set({
          workerToken: claimToken,
          saveClaimedAt: new Date(),
          saveAttempts: next.saveAttempts + 1,
        })
        .where(eq(recipeImport.id, next.id));
      return {
        kind: "save",
        id: next.id,
        workerToken: claimToken,
        saveAttempts: next.saveAttempts + 1,
      } as const;
    }
    await tx
      .update(recipeImport)
      .set({
        state: "fetching",
        startedAt: new Date(),
        workerToken: claimToken,
      })
      .where(eq(recipeImport.id, next.id));
    return { kind: "generate", ...next, workerToken: claimToken } as const;
  });
  if (!job) return false;
  if (job.kind === "save") {
    await saveReady(job);
    return true;
  }
  const started = Date.now();
  let stage: "fetching" | "generating" = "fetching";
  let stageStarted = started;
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
    const prepared = await prepareRecipeInput(
      job.input,
      job.sourceUrl ?? undefined,
      job.id,
    );
    if (!prepared.images.length && job.imageCandidates)
      prepared.images = job.imageCandidates;
    const tags = await availableTags(job.userId);
    // A missing provider key must fail before reserving spend or consuming AI usage.
    ensureProviderReady();
    recipeSystemPrompt(
      withImageChoices(prepared.content, prepared.images),
      tags,
      prepared.sourceUrl,
    );
    // Persist the exact input before crossing the AI boundary.
    const claimed = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(recipeImport)
        .set({
          state: "processing",
          input: prepared.content,
          sourceUrl: prepared.sourceUrl,
          imageCandidates: prepared.images.length ? prepared.images : null,
          startedAt: new Date(),
        })
        .where(
          and(
            eq(recipeImport.id, job.id),
            eq(recipeImport.workerToken, job.workerToken),
            eq(recipeImport.state, "fetching"),
          ),
        )
        .returning({ id: recipeImport.id });
      if (claimed.length) await reserveAiSpend(tx, job.id);
      return claimed;
    });
    if (!claimed.length) return true;
    logImport({
      event: "import_stage_completed",
      importId: job.id,
      stage,
      elapsedMs: Date.now() - stageStarted,
    });
    stage = "generating";
    stageStarted = Date.now();
    logImport({ event: "import_stage_started", importId: job.id, stage });
    generationStarted = true;
    const result = await generate(
      prepared.content,
      tags,
      prepared.sourceUrl ?? undefined,
      prepared.images,
    );
    logImport({
      event: "import_stage_completed",
      importId: job.id,
      stage,
      elapsedMs: Date.now() - stageStarted,
    });
    // A save failure retries this checkpoint, never generation.
    const [checkpointed] = await db
      .update(recipeImport)
      .set({
        state: "ready",
        saveAttempts: 1,
        saveClaimedAt: new Date(),
        nextSaveAttemptAt: new Date(),
        input: "",
        sourceUrl: result.sourceUrl,
        imageCandidates: null,
        // IDs are fixed here so save retries never duplicate a recipe.
        generated: {
          recipes: result.recipes.map((item, index) => ({
            id: index ? randomUUID() : job.id,
            content: item.content,
            tagIds: item.tagIds,
          })),
          origin: result.origin,
          imageUrl: result.imageUrl ?? null,
        },
      })
      .where(
        and(
          eq(recipeImport.id, job.id),
          eq(recipeImport.workerToken, job.workerToken),
          eq(recipeImport.state, "processing"),
        ),
      )
      .returning({ id: recipeImport.id });
    if (checkpointed)
      saveClaim = { id: job.id, workerToken: job.workerToken, saveAttempts: 1 };
  } catch (error) {
    await failImport(job.id, job.workerToken, error, !generationStarted);
    logImport({
      event: "import_failed",
      importId: job.id,
      stage,
      elapsedMs: Date.now() - stageStarted,
      usageReleased: !generationStarted,
      failure: importFailure(error),
    });
    return true;
  }
  if (saveClaim) await saveReady(saveClaim);
  return true;
}

async function failImport(
  id: string,
  workerToken: string,
  error: unknown,
  release = false,
) {
  await db
    .update(recipeImport)
    .set({
      state: "failed",
      input: "",
      imageCandidates: null,
      usageReleased: release,
      error:
        error instanceof TRPCError
          ? error.message
          : "Processing failed. Start a new attempt to try again.",
    })
    .where(
      and(
        eq(recipeImport.id, id),
        eq(recipeImport.workerToken, workerToken),
        inArray(recipeImport.state, ["fetching", "processing"]),
      ),
    );
}

async function saveReady(claim: SaveClaim) {
  const { id } = claim;
  const started = Date.now();
  logImport({ event: "import_stage_started", importId: id, stage: "saving" });
  const saved = await db
    .transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(recipeImport)
        .where(
          and(
            eq(recipeImport.id, id),
            eq(recipeImport.state, "ready"),
            eq(recipeImport.workerToken, claim.workerToken),
          ),
        )
        .for("update");
      if (!job) return;
      const checkpoint = checkpointSchema.safeParse(job.generated);
      if (!checkpoint.success) {
        await tx
          .update(recipeImport)
          .set({
            state: "failed",
            saveClaimedAt: null,
            workerToken: null,
            error:
              "The generated recipe checkpoint is missing or invalid. Start a new import or contact support with this import reference.",
          })
          .where(eq(recipeImport.id, id));
        return {
          kind: "failed",
          failure: { type: "InvalidCheckpoint" },
        } as const;
      }
      let placement: Awaited<ReturnType<typeof preparePlacement>>;
      try {
        placement = await preparePlacement(tx, job.userId, job);
      } catch (error) {
        await tx
          .update(recipeImport)
          .set({
            state: "failed",
            saveClaimedAt: null,
            workerToken: null,
            generated: null,
            error:
              "Household or collection access changed. Start a new attempt and choose a destination you can use.",
          })
          .where(eq(recipeImport.id, id));
        return { kind: "failed", failure: importFailure(error) } as const;
      }
      const recipes = checkpointRecipes(id, checkpoint.data);
      const ids = recipes.map((item) => item.id);
      const [existing] = await tx
        .select({ id: recipe.id })
        .from(recipe)
        .where(inArray(recipe.id, ids));
      if (existing) {
        await tx
          .update(recipeImport)
          .set({
            state: "failed",
            saveClaimedAt: null,
            workerToken: null,
            generated: null,
            error: "This recipe ID is already in use. Start another import.",
          })
          .where(eq(recipeImport.id, id));
        return {
          kind: "failed",
          failure: { type: "RecipeIdConflict" },
        } as const;
      }
      let inserted = true;
      for (const [index, item] of recipes.entries()) {
        inserted = await persistRecipe(
          tx,
          {
            id: item.id,
            userId: job.userId,
            title: item.content.title,
            content: item.content,
            sourceUrl: job.sourceUrl,
            origin: checkpoint.data.origin ?? "imported",
          },
          item.tagIds,
        );
        // Roll back earlier inserts; the retry finds the conflict and fails cleanly.
        if (!inserted && index)
          throw Object.assign(new Error(), { name: "RecipeIdConflict" });
        if (!inserted) break;
        await applyPlacement(tx, item.id, placement);
      }
      await tx
        .update(recipeImport)
        .set({
          state: inserted ? "saved" : "failed",
          saveClaimedAt: null,
          workerToken: null,
          generated: null,
          recipeIds: inserted ? ids : null,
          error: inserted
            ? null
            : "This recipe ID is already in use. Start another import.",
        })
        .where(eq(recipeImport.id, id));
      return inserted
        ? ({
            kind: "saved",
            imageUrl: checkpoint.data.imageUrl ?? null,
            sourceUrl: job.sourceUrl,
            count: ids.length,
          } as const)
        : ({ kind: "failed", failure: { type: "RecipeIdConflict" } } as const);
    })
    .catch(async (error: unknown) => {
      // The failed recipe transaction rolled back; release only our durable claim.
      await retrySave(db, claim, error, started);
    });
  if (saved?.kind === "saved") {
    logImport({
      event: "import_saved",
      importId: id,
      recipes: saved.count,
      elapsedMs: Date.now() - started,
    });
    if (saved.imageUrl)
      await savePhoto(id, saved.imageUrl, saved.sourceUrl ?? undefined);
  } else if (saved?.kind === "failed")
    logImport({
      event: "import_failed",
      importId: id,
      stage: "saving",
      elapsedMs: Date.now() - started,
      usageReleased: false,
      failure: saved.failure,
    });
}

// Best effort: a missing or broken photo never fails the saved import.
async function savePhoto(id: string, imageUrl: string, sourceUrl?: string) {
  const started = Date.now();
  try {
    // Loaded lazily: sharp's native binary must stay out of the web server bundle.
    const { attachRecipePhoto } = await import("./recipes/media");
    const attached = await attachRecipePhoto(id, imageUrl, sourceUrl);
    logImport({
      event: attached ? "import_photo_saved" : "import_photo_skipped",
      importId: id,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    logImport({
      event: "import_photo_failed",
      importId: id,
      elapsedMs: Date.now() - started,
      failure: importFailure(error),
    });
  }
}
