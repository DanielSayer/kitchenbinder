import {
  collectionsSchema,
  importRequestSchema,
} from "@prep-sheet/api/import-contract";
import { z } from "zod";

// Pending imports stored before households used groupId for the destination.
const withHousehold = (value: unknown) => {
  if (!value || typeof value !== "object" || !("groupId" in value))
    return value;
  const { groupId, ...rest } = value as Record<string, unknown>;
  return { householdId: groupId, ...rest };
};
export const pendingSchema = z.preprocess(
  withHousehold,
  importRequestSchema.extend({
    title: z.string().max(300).optional(),
    collectionName: z.string().optional(),
  }),
);
export const destinationSchema = z.object({
  collections: collectionsSchema,
  householdId: z.uuid().nullable(),
  changed: z.boolean(),
});
export const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    reconnect: z.boolean().optional(),
  }),
]);

export class PopupError extends Error {
  constructor(
    message: string,
    readonly reconnect = false,
  ) {
    super(message);
  }
}
