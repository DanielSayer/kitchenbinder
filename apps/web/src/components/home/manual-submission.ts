import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { z } from "zod";
import type { Destination } from "./destination";

// Drafts saved before households stored the share target as groupId.
const withHousehold = (value: unknown) => {
  if (!value || typeof value !== "object" || !("groupId" in value))
    return value;
  const { groupId, ...rest } = value as Record<string, unknown>;
  return { householdId: groupId, ...rest };
};
const submissionSchema = z.preprocess(
  withHousehold,
  z.object({
    id: z.uuid(),
    // First share target; sent with the save so it is part of its identity.
    householdId: z.uuid().nullable(),
    collectionId: z.uuid().nullable().optional(),
    // Every share target, including householdId. Extras are shared after save.
    householdIds: z.array(z.uuid()).optional(),
    content: recipeContentSchema,
  }),
);
export type ManualSubmission = z.infer<typeof submissionSchema>;

export function submissionDestination(value: ManualSubmission): Destination {
  return {
    collectionId: value.collectionId ?? null,
    householdIds:
      value.householdIds ?? (value.householdId ? [value.householdId] : []),
  };
}

export function readManualSubmission(key: string): ManualSubmission | null {
  // An unreadable submission must block a new ID: the earlier save may exist.
  const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
  return value === null ? null : submissionSchema.parse(value);
}

export function writeManualSubmission(key: string, value: ManualSubmission) {
  sessionStorage.setItem(key, JSON.stringify(value));
}
