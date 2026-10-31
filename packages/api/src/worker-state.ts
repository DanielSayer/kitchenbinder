import { z } from "zod";

const timestamp = z.number().finite().nonnegative();
export const queueObservationSchema = z.object({
  observedAt: timestamp,
  queuedAt: timestamp.nullable(),
  readyAt: timestamp.nullable(),
  activeAt: timestamp.nullable(),
  saveFailureAt: timestamp.nullable(),
});
export type QueueObservation = z.infer<typeof queueObservationSchema>;

export const workerProgressSchema = z.object({
  mode: z.enum(["waiting", "processing", "retrying"]).default("waiting"),
  progressAt: timestamp.optional(),
  failureSince: timestamp.nullable().default(null),
  queue: queueObservationSchema.nullable().default(null),
});

export const workerHeartbeatSchema = workerProgressSchema.extend({
  version: z.literal(1),
  timestamp: timestamp.int(),
  instance: z.uuid(),
});
