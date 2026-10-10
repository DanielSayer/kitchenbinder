import { createHash, randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { group, groupMember } from "@prep-sheet/db/schema/group";
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
  sql,
} from "drizzle-orm";
import { refreshBillingIfStale } from "./billing/polar";
import { pricing } from "./billing/policy";
import {
  checkAiAllowance,
  checkRecipeCapacity,
  reserveAiSpend,
} from "./billing/usage";
import { accessibleRecipe, lockGroup, requireGroup } from "./groups/access";
import {
  type ImportStatus,
  importInputSchema,
  websiteImportSchema,
} from "./import-contract";
import { importFailure, logImport } from "./import-diagnostics";
import {
  generateRecipe,
  prepareRecipeInput,
  requireRecipeProvider,
} from "./recipes/generate";
import { persistRecipe } from "./recipes/persist";
import { checkRecipeUsage } from "./recipes/usage";
import { availableTags } from "./routers/tags";

export async function importCollections(userId: string) {
  const groups = await db
    .select({ id: group.id, name: group.name })
    .from(group)
    .innerJoin(groupMember, eq(groupMember.groupId, group.id))
    .where(eq(groupMember.userId, userId))
    .orderBy(asc(group.name));
  return [{ id: null, name: "My recipes" }, ...groups];
}

export async function recentImports(userId: string) {
  return db
    .select({
      id: recipeImport.id,
      state: recipeImport.state,
      sourceKind: recipeImport.sourceKind,
      sourceUrl: recipeImport.sourceUrl,
      createdAt: recipeImport.createdAt,
      error: recipeImport.error,
      recipeId: recipe.id,
      title: recipe.title,
    })
    .from(recipeImport)
    .leftJoin(
      recipe,
      and(eq(recipe.id, recipeImport.id), accessibleRecipe(userId)),
    )
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
      // A recovered link must not expose a recipe after membership loss or deletion.
      if (job.groupId) await requireGroup(db, job.groupId, userId);
      const [saved] = await db
        .select({ title: recipe.title })
        .from(recipe)
        .where(
          and(
            eq(recipe.id, id),
            eq(recipe.userId, userId),
            isNull(recipe.deletedAt),
          ),
        );
      if (!saved)
        return {
          kind: "failed",
          id,
          message: "The saved recipe has been deleted.",
        };
      return { kind: "saved", id, recipeId: id, title: saved.title };
    }
  }
}

type JobInput = {
  id: string;
  content: string;
  sourceUrl: string | null;
  groupId: string | null;
  sourceKind: "captured" | "website";
};

function fingerprintOf(input: JobInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        content: input.content,
        sourceUrl: input.sourceUrl,
        groupId: input.groupId,
        ...(input.sourceKind === "website"
          ? { sourceKind: input.sourceKind }
          : {}),
      }),
    )
    .digest("hex");
}

export async function discardImport(userId: string, value: unknown) {
  const input = importInputSchema.parse(value);
  return discardJob(userId, { ...input, sourceKind: "captured" });
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
      groupId: input.groupId,
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

export async function submitImport(userId: string, value: unknown) {
  return submitJob(userId, {
    ...importInputSchema.parse(value),
    sourceKind: "captured",
  });
}

function websiteInput(value: unknown): JobInput {
  const input = websiteImportSchema.parse(value);
  return {
    id: input.id,
    content: input.input,
    groupId: input.groupId ?? null,
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
    if (input.groupId) await requireGroup(tx, input.groupId, userId);
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
      groupId: input.groupId,
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

// A dedicated process awaits this function. No work is launched by HTTP handlers.
export async function processNextImport(
  generate = generateRecipe,
  ensureProviderReady: () => void = generate === generateRecipe
    ? requireRecipeProvider
    : () => {},
) {
  const [ready] = await db
    .select({ id: recipeImport.id })
    .from(recipeImport)
    .where(eq(recipeImport.state, "ready"))
    .limit(1);
  if (ready) {
    await saveReady(ready.id);
    return true;
  }
  // Do not replay an AI call whose outcome was lost with its worker. Keep the ID terminal.
  await db
    .update(recipeImport)
    .set({
      state: "failed",
      input: "",
      error:
        "Processing was interrupted. Start a new attempt to try again; this import will not run twice.",
    })
    .where(
      and(
        eq(recipeImport.state, "processing"),
        lt(recipeImport.startedAt, new Date(Date.now() - 180_000)),
      ),
    );
  // Fetching is safe to repeat; a call that reached AI is never replayed.
  await db
    .update(recipeImport)
    .set({ state: "queued", startedAt: null })
    .where(
      and(
        eq(recipeImport.state, "fetching"),
        lt(recipeImport.startedAt, new Date(Date.now() - 180_000)),
      ),
    );
  const job = await db.transaction(async (tx) => {
    // Serialize claims across every worker, not just this process.
    await tx.execute(sql`select pg_advisory_xact_lock(728193041)`);
    const [active] = await tx
      .select({ total: count() })
      .from(recipeImport)
      .where(inArray(recipeImport.state, ["fetching", "processing"]));
    if ((active?.total ?? 0) >= pricing.ai.concurrentAttempts) return null;
    const [next] = await tx
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.state, "queued"))
      .orderBy(asc(recipeImport.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const claimToken = randomUUID();
    await tx
      .update(recipeImport)
      .set({
        state: "fetching",
        startedAt: new Date(),
        workerToken: claimToken,
      })
      .where(eq(recipeImport.id, next.id));
    return { ...next, workerToken: claimToken };
  });
  if (!job) return false;
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
  try {
    if (job.groupId) await requireGroup(db, job.groupId, job.userId);
    const prepared =
      job.sourceKind === "website"
        ? await prepareRecipeInput(
            job.input,
            job.sourceUrl ?? undefined,
            job.id,
          )
        : { content: job.input, sourceUrl: job.sourceUrl };
    const tags = await availableTags(job.userId);
    // A missing provider key must fail before reserving spend or consuming AI usage.
    ensureProviderReady();
    // Persist the exact input before crossing the AI boundary.
    const claimed = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(recipeImport)
        .set({
          state: "processing",
          input: prepared.content,
          sourceUrl: prepared.sourceUrl,
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
    );
    logImport({
      event: "import_stage_completed",
      importId: job.id,
      stage,
      elapsedMs: Date.now() - stageStarted,
    });
    // A save failure retries this checkpoint, never generation.
    await db
      .update(recipeImport)
      .set({
        state: "ready",
        input: "",
        sourceUrl: result.sourceUrl,
        generated: {
          content: result.content,
          tagIds: result.tagIds,
          origin: result.origin,
        },
      })
      .where(
        and(
          eq(recipeImport.id, job.id),
          eq(recipeImport.workerToken, job.workerToken),
          eq(recipeImport.state, "processing"),
        ),
      );
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
  await saveReady(job.id);
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

async function saveReady(id: string) {
  const started = Date.now();
  logImport({ event: "import_stage_started", importId: id, stage: "saving" });
  const saved = await db
    .transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(recipeImport)
        .where(and(eq(recipeImport.id, id), eq(recipeImport.state, "ready")))
        .for("update");
      if (!job?.generated) return;
      if (job.groupId) {
        await lockGroup(tx, job.groupId);
        try {
          await requireGroup(tx, job.groupId, job.userId);
        } catch (error) {
          await tx
            .update(recipeImport)
            .set({
              state: "failed",
              generated: null,
              error:
                "Group access changed. Start a new attempt and choose a collection you can write to.",
            })
            .where(eq(recipeImport.id, id));
          return { kind: "failed", failure: importFailure(error) } as const;
        }
      }
      const [existing] = await tx
        .select({ id: recipe.id })
        .from(recipe)
        .where(eq(recipe.id, id));
      if (existing) {
        await tx
          .update(recipeImport)
          .set({
            state: "failed",
            generated: null,
            error: "This recipe ID is already in use. Start another import.",
          })
          .where(eq(recipeImport.id, id));
        return {
          kind: "failed",
          failure: { type: "RecipeIdConflict" },
        } as const;
      }
      const inserted = await persistRecipe(
        tx,
        {
          id,
          userId: job.userId,
          groupId: job.groupId,
          title: job.generated.content.title,
          content: job.generated.content,
          sourceUrl: job.sourceUrl,
          origin: job.generated.origin ?? "imported",
        },
        job.generated.tagIds,
      );
      await tx
        .update(recipeImport)
        .set({
          state: inserted ? "saved" : "failed",
          generated: null,
          error: inserted
            ? null
            : "This recipe ID is already in use. Start another import.",
        })
        .where(eq(recipeImport.id, id));
      return inserted
        ? ({ kind: "saved" } as const)
        : ({ kind: "failed", failure: { type: "RecipeIdConflict" } } as const);
    })
    .catch((error: unknown) => {
      logImport({
        event: "import_save_retry",
        importId: id,
        elapsedMs: Date.now() - started,
        failure: importFailure(error),
      });
      throw error;
    });
  if (saved?.kind === "saved")
    logImport({
      event: "import_saved",
      importId: id,
      elapsedMs: Date.now() - started,
    });
  else if (saved?.kind === "failed")
    logImport({
      event: "import_failed",
      importId: id,
      stage: "saving",
      elapsedMs: Date.now() - started,
      usageReleased: false,
      failure: saved.failure,
    });
}
