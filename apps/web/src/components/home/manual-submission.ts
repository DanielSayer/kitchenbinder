import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { z } from "zod";

const submissionSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid().nullable(),
  content: recipeContentSchema,
});
export type ManualSubmission = z.infer<typeof submissionSchema>;

export function readManualSubmission(key: string): ManualSubmission | null {
  // An unreadable submission must block a new ID: the earlier save may exist.
  const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
  return value === null ? null : submissionSchema.parse(value);
}

export function writeManualSubmission(key: string, value: ManualSubmission) {
  sessionStorage.setItem(key, JSON.stringify(value));
}
