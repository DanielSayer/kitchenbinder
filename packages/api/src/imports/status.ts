import { db } from "@prep-sheet/db";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { accessibleRecipe } from "../households/access";
import type { ImportStatus } from "./contract";
import { savedRecipeIds } from "./legacy";
import { inFlightStates } from "./lifecycle";

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
      desc(inArray(recipeImport.state, inFlightStates)),
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
