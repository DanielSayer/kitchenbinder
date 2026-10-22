import { z } from "zod";

export const planningScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("personal") }),
  z.object({ kind: z.literal("household"), householdId: z.uuid() }),
]);
export type PlanningScope = z.infer<typeof planningScopeSchema>;
export const personalScope = { kind: "personal" } satisfies PlanningScope;
export const scopeInput = planningScopeSchema.default(personalScope);
export function planningKey(scope: PlanningScope) {
  return scope.kind === "personal"
    ? "personal"
    : `household:${scope.householdId}`;
}
