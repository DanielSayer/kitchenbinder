import { imageCandidatesSchema } from "@prep-sheet/api/import-contract";
import { z } from "zod";

const sourceUrlSchema = z
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
      !url.hash
    );
  });
const capturedRecipeSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(32_000),
  format: z.enum(["json-ld", "text"]),
  images: imageCandidatesSchema.optional(),
});
export const captureResultSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("captured"),
      sourceUrl: sourceUrlSchema,
      recipes: z.array(capturedRecipeSchema).min(1).max(10),
    }),
    z.strictObject({
      kind: z.literal("error"),
      code: z.enum([
        "challenge",
        "unsupported",
        "missing",
        "too-large",
        "unavailable",
      ]),
    }),
  ])
  .refine((value) => JSON.stringify(value).length <= 128_000);
export type CaptureResult = z.infer<typeof captureResultSchema>;
export const captureErrors = {
  challenge:
    "Finish opening the recipe in this tab, including any browser check, then try again.",
  unsupported:
    "Open a recipe on a regular website, then try again. Browser pages and PDF viewers aren't supported.",
  missing:
    "No complete recipe found. Open the recipe page and make sure its ingredients and instructions are loaded, then try again.",
  "too-large":
    "This page contains too much recipe content. Open an individual recipe page and try again.",
  unavailable:
    "Couldn't read this tab. Reload the recipe page, reopen the extension and try again.",
} satisfies Record<Extract<CaptureResult, { kind: "error" }>["code"], string>;
