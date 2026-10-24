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
export const imageCandidatesSchema = z.array(imageCandidateSchema).max(10);
export const importStatusSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("queued"),
    id: z.uuid(),
    queuedForMs: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("processing"),
    id: z.uuid(),
    stage: z.enum(["fetching", "generating", "saving"]).optional(),
  }),
  z.object({
    kind: z.literal("saved"),
    id: z.uuid(),
    recipeId: z.uuid(),
    title: z.string(),
  }),
  z.object({ kind: z.literal("failed"), id: z.uuid(), message: z.string() }),
]);
export type ImportStatus = z.infer<typeof importStatusSchema>;
export const websiteImportSchema = z.object({
  id: z.uuid(),
  input: z.string().trim().min(3).max(20000),
  householdId: z.uuid().nullable().optional(),
  collectionId: z.uuid().nullable().optional(),
});
