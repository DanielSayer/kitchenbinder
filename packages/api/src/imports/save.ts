import { db } from "@prep-sheet/db";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../households/access";
import { applyPlacement, preparePlacement } from "../households/placement";
import { ingredientColumns } from "../recipes/ingredient-data";
import { persistRecipe } from "../recipes/persist";
import { readCheckpoint } from "./checkpoint";
import { importFailure, logImport, type Stage } from "./diagnostics";
import { type Claim, transition } from "./lifecycle";
import type { ProcessResult } from "./result";
import { saveAttemptsExhausted, saveRetryDelayMs } from "./timing";

export type SaveClaim = Claim & { saveAttempts: number };

const released = { saveClaimedAt: null, workerToken: null } as const;

/** Releases a failed save claim to retry later, or fails it after the last attempt. */
export async function retrySave(
  database: Database,
  claim: SaveClaim,
  error: unknown,
  started: number,
): Promise<ProcessResult> {
  const exhausted = saveAttemptsExhausted(claim.saveAttempts);
  const delayMs = exhausted ? 0 : saveRetryDelayMs(claim.saveAttempts);
  const moved = await transition(
    database,
    { held: claim },
    "ready",
    exhausted ? "failed" : "ready",
    {
      ...released,
      nextSaveAttemptAt: new Date(Date.now() + delayMs),
      error: exhausted
        ? "The generated recipe could not be saved after five attempts. Start a new import or contact support with this import reference."
        : null,
      // Keep generated output and spent usage even when the retry budget is exhausted.
    },
  ).catch((retryError: unknown) => {
    logImport({
      event: "import_save_retry_failed",
      importId: claim.id,
      attempt: claim.saveAttempts,
      saveFailure: importFailure(error),
      failure: importFailure(retryError),
    });
    throw retryError;
  });
  if (!moved.length) return { kind: "lost", importId: claim.id };
  if (exhausted) {
    logImport({
      event: "import_failed",
      importId: claim.id,
      stage: "saving",
      elapsedMs: Date.now() - started,
      usageReleased: false,
      failure: importFailure(error),
    });
    return {
      kind: "failed",
      importId: claim.id,
      stage: "saving",
      usageReleased: false,
    };
  }
  logImport({
    event: "import_save_retry",
    importId: claim.id,
    attempt: claim.saveAttempts,
    delayMs,
    elapsedMs: Date.now() - started,
    failure: importFailure(error),
  });
  return {
    kind: "retrying",
    importId: claim.id,
    attempt: claim.saveAttempts,
    delayMs,
  };
}

export async function saveCheckpoint(
  claim: SaveClaim,
  reportProgress: (stage: Stage) => Promise<void>,
): Promise<ProcessResult> {
  const { id } = claim;
  const started = Date.now();
  await reportProgress("saving");
  logImport({ event: "import_stage_started", importId: id, stage: "saving" });
  let saved: Awaited<ReturnType<typeof saveRecipes>>;
  try {
    saved = await saveRecipes(claim);
  } catch (error) {
    // The failed recipe transaction rolled back; release only our durable claim.
    return retrySave(db, claim, error, started);
  }
  switch (saved.kind) {
    case "saved":
      logImport({
        event: "import_saved",
        importId: id,
        recipes: saved.count,
        elapsedMs: Date.now() - started,
      });
      if (saved.imageUrl)
        await savePhoto(id, saved.imageUrl, saved.sourceUrl ?? undefined);
      return { kind: "saved", importId: id, recipes: saved.count };
    case "failed":
      logImport({
        event: "import_failed",
        importId: id,
        stage: "saving",
        elapsedMs: Date.now() - started,
        usageReleased: false,
        failure: saved.failure,
      });
      return {
        kind: "failed",
        importId: id,
        stage: "saving",
        usageReleased: false,
      };
    case "lost":
      return { kind: "lost", importId: id };
  }
}

// Throws on any database failure, so the caller can retry the whole save.
function saveRecipes(claim: SaveClaim) {
  const { id } = claim;
  const fail = (tx: Database, error: string, clearOutput = true) =>
    transition(tx, { held: claim }, "ready", "failed", {
      ...released,
      ...(clearOutput ? { generated: null } : {}),
      error,
    });
  return db.transaction(async (tx) => {
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
    if (!job) return { kind: "lost" } as const;
    const checkpoint = readCheckpoint(id, job.generated);
    if (!checkpoint) {
      await fail(
        tx,
        "The generated recipe checkpoint is missing or invalid. Start a new import or contact support with this import reference.",
        false,
      );
      return {
        kind: "failed",
        failure: { type: "InvalidCheckpoint" },
      } as const;
    }
    let placement: Awaited<ReturnType<typeof preparePlacement>>;
    try {
      placement = await preparePlacement(tx, job.userId, job);
    } catch (error) {
      await fail(
        tx,
        "Household or collection access changed. Start a new attempt and choose a destination you can use.",
      );
      return { kind: "failed", failure: importFailure(error) } as const;
    }
    const ids = checkpoint.recipes.map((item) => item.id);
    const conflict = "This recipe ID is already in use. Start another import.";
    const [existing] = await tx
      .select({ id: recipe.id })
      .from(recipe)
      .where(inArray(recipe.id, ids));
    if (existing) {
      await fail(tx, conflict);
      return {
        kind: "failed",
        failure: { type: "RecipeIdConflict" },
      } as const;
    }
    for (const [index, item] of checkpoint.recipes.entries()) {
      const inserted = await persistRecipe(
        tx,
        {
          id: item.id,
          userId: job.userId,
          title: item.content.title,
          content: item.content,
          ...ingredientColumns(item.content.ingredients, item.ingredientData),
          sourceUrl: job.sourceUrl,
          origin: checkpoint.origin,
        },
        item.tagIds,
      );
      // Roll back earlier inserts; the retry finds the conflict and fails cleanly.
      if (!inserted && index)
        throw Object.assign(new Error(), { name: "RecipeIdConflict" });
      if (!inserted) {
        await fail(tx, conflict);
        return {
          kind: "failed",
          failure: { type: "RecipeIdConflict" },
        } as const;
      }
      await applyPlacement(tx, item.id, placement);
    }
    await transition(tx, { held: claim }, "ready", "saved", {
      ...released,
      generated: null,
      recipeIds: ids,
      error: null,
    });
    return {
      kind: "saved",
      imageUrl: checkpoint.imageUrl,
      sourceUrl: job.sourceUrl,
      count: ids.length,
    } as const;
  });
}

// Best effort: a missing or broken photo never fails the saved import.
async function savePhoto(id: string, imageUrl: string, sourceUrl?: string) {
  const started = Date.now();
  try {
    // Loaded lazily: sharp's native binary must stay out of the web server bundle.
    const { attachRecipePhoto } = await import("../recipes/media");
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
