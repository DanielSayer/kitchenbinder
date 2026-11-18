import { randomUUID } from "node:crypto";
import { ingredientLineSchema } from "@prep-sheet/db/ingredients";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import type { recipeImport } from "@prep-sheet/db/schema/import";
import { z } from "zod";
import type { generateRecipe } from "../recipes/generate";
import { recipesPerImport } from "./contract";
import { singleRecipeCheckpointRecipes } from "./legacy";

// Generated recipes stored before saving. Saves retry from here and never call AI again.

const details = z.object({
  origin: z.enum(["imported", "generated"]).optional(),
  imageUrl: z.string().url().nullable().optional(),
});
const recipes = z.object({
  recipes: z
    .array(
      z.object({
        id: z.string().uuid(),
        content: recipeContentSchema,
        // Missing from checkpoints written before ingredients were parsed.
        ingredientData: z.array(ingredientLineSchema).optional(),
        tagIds: z.array(z.string().uuid()),
      }),
    )
    .min(1)
    .max(recipesPerImport),
});

export type Generated = Omit<
  Awaited<ReturnType<typeof generateRecipe>>,
  "imageUrl"
> & { imageUrl?: string | null };

export function writeCheckpoint(
  id: string,
  result: Generated,
): NonNullable<typeof recipeImport.$inferInsert.generated> {
  return {
    // IDs are fixed here so save retries never duplicate a recipe.
    recipes: result.recipes.map((item, index) => ({
      id: index ? randomUUID() : id,
      content: item.content,
      ingredientData: item.ingredientData,
      tagIds: item.tagIds,
    })),
    origin: result.origin,
    imageUrl: result.imageUrl ?? null,
  };
}

/** Null when the checkpoint is missing or invalid. */
export function readCheckpoint(id: string, generated: unknown) {
  const meta = details.safeParse(generated);
  if (!meta.success) return null;
  const current = recipes.safeParse(generated);
  const found = current.success
    ? current.data.recipes
    : singleRecipeCheckpointRecipes(id, generated);
  if (!found) return null;
  return {
    recipes: found,
    origin: meta.data.origin ?? "imported",
    imageUrl: meta.data.imageUrl ?? null,
  };
}
