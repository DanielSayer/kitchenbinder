import { z } from "zod";

// Stored WebP widths. Objects live at `${url}-${width}.webp`.
export const recipePhotoWidths = [480, 1200] as const;

export const recipePhotoSchema = z.object({
  // Object key prefix shared by every width; copies reuse the same objects.
  key: z.string().min(1).max(200),
  // Public URL prefix for the key.
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
});

export type RecipePhoto = z.infer<typeof recipePhotoSchema>;
