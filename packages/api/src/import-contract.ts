import { z } from "zod";

// Photos found on the source page. "recipe" comes from the recipe's own
// metadata and is used as-is; "page" and "content" images are chosen by the AI.
export const imageCandidateSchema = z.strictObject({
  url: z
    .string()
    .max(2048)
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    }),
  alt: z.string().max(200),
  source: z.enum(["recipe", "page", "content"]),
});
export type ImageCandidate = z.infer<typeof imageCandidateSchema>;
// Pasted input may hold several recipes; a web page gives one.
export const recipesPerImport = 5;
export type ImportStatus =
  | { kind: "queued"; id: string; queuedForMs?: number }
  | {
      kind: "processing";
      id: string;
      stage?: "fetching" | "generating" | "saving";
    }
  | {
      kind: "saved";
      id: string;
      // The first saved recipe; "recipes" lists every recipe from this import.
      recipeId: string;
      title: string;
      recipes: { id: string; title: string }[];
    }
  | { kind: "failed"; id: string; message: string };
export const websiteImportSchema = z.object({
  id: z.uuid(),
  input: z.string().trim().min(3).max(20000),
  householdId: z.uuid().nullable().optional(),
  collectionId: z.uuid().nullable().optional(),
});
