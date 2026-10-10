import { z } from "zod";

// Captures deliberately omit query strings and fragments, which may contain secrets.
export const importSourceSchema = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!url.port || ["80", "443"].includes(url.port))
    );
  }, "Use a public HTTP source link without credentials, query or fragment.");
export const importInputSchema = z.strictObject({
  id: z.uuid(),
  content: z.string().trim().min(80).max(32_000),
  sourceUrl: importSourceSchema,
  groupId: z.uuid().nullable(),
});
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
export const collectionsSchema = z.array(
  z.object({ id: z.uuid().nullable(), name: z.string() }),
);

export const websiteImportSchema = z.object({
  id: z.uuid(),
  input: z.string().trim().min(3).max(20000),
  groupId: z.uuid().nullable().optional(),
});
