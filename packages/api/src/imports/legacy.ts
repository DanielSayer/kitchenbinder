import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { z } from "zod";

// Formats written by earlier versions. Rows keep them until they age out;
// there is no data migration.

/** Imports before multi-recipe imports saved one recipe with the import ID. */
export const savedRecipeIds = (job: {
  id: string;
  recipeIds: string[] | null;
}) => (job.recipeIds?.length ? job.recipeIds : [job.id]);

// Checkpoints before multi-recipe imports held one recipe that uses the import ID.
const singleRecipeCheckpoint = z.object({
  content: recipeContentSchema,
  tagIds: z.array(z.string().uuid()),
});

export function singleRecipeCheckpointRecipes(id: string, generated: unknown) {
  const parsed = singleRecipeCheckpoint.safeParse(generated);
  // Also written before ingredients were parsed.
  return parsed.success
    ? [{ id, ...parsed.data, ingredientData: undefined }]
    : null;
}

/**
 * "captured" imports came from the removed browser extension, which sent the
 * page URL and its images. They run like website imports.
 */
export const sourceOf = (sourceKind: "captured" | "website" | "photo") =>
  sourceKind === "photo" ? "photo" : "website";
