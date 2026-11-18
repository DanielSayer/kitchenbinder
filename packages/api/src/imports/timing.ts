import { recipeImport } from "@prep-sheet/db/schema/import";
import { and, isNull, lt, type SQL, sql } from "drizzle-orm";

// Claim eligibility and deadlines, used by the claim, the stale-claim reset
// and the queue scan. Every rule reads the worker's clock, never the
// database's, so claims, scheduling and tests agree.

export const saveAttemptLimit = 5;
const claimTimeoutMs = 180_000;
// Queued work waits for a free generation slot; look again shortly.
const queuedRecheckMs = 2000;

const ms = (value: number) => sql`(${value} * interval '1 millisecond')`;
const activeSince = sql`coalesce(${recipeImport.startedAt}, ${recipeImport.createdAt})`;

/** The first retry waits five seconds, then each wait doubles. */
export const saveRetryDelayMs = (attempt: number) => 5000 * 2 ** (attempt - 1);
export const saveAttemptsExhausted = (attempt: number) =>
  attempt >= saveAttemptLimit;

export function timing(now = Date.now()) {
  const current = sql`${new Date(now).toISOString()}::timestamptz`;
  return {
    current,
    /** A fetch or generation whose worker stopped before finishing. */
    activeExpired: sql`${activeSince} + ${ms(claimTimeoutMs)} < ${current}`,
    /** A save claim whose worker stopped before finishing. */
    saveClaimExpired: sql`${recipeImport.saveClaimedAt} + ${ms(claimTimeoutMs)} < ${current}`,
    /** A checkpoint whose next save attempt may start now. */
    saveDue: and(
      isNull(recipeImport.saveClaimedAt),
      lt(recipeImport.saveAttempts, saveAttemptLimit),
      sql`${recipeImport.nextSaveAttemptAt} <= ${current}`,
    ) as SQL,
    /** When the worker next needs to look at an unfinished import. */
    dueAt: sql`case
      when ${recipeImport.state} = 'queued' then ${current} + ${ms(queuedRecheckMs)}
      when ${recipeImport.state} = 'ready' and ${recipeImport.saveClaimedAt} is not null
        then ${recipeImport.saveClaimedAt} + ${ms(claimTimeoutMs)}
      when ${recipeImport.state} = 'ready' and ${recipeImport.saveAttempts} < ${saveAttemptLimit}
        then ${recipeImport.nextSaveAttemptAt}
      when ${recipeImport.state} in ('fetching', 'processing')
        then ${activeSince} + ${ms(claimTimeoutMs)}
      end`,
  };
}
