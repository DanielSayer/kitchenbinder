import { recipeImport } from "@prep-sheet/db/schema/import";
import { and, eq, gte, inArray, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "../households/access";
import { inFlightStates } from "./lifecycle";

/** The plan period AI attempts are charged to. */
export type AiPeriod = {
  bucket: "free" | "trial" | "pro";
  since: Date | null;
};

const tally = (where: SQL | undefined) =>
  sql<number>`count(*) filter (where ${where ?? sql`false`})`.mapWith(Number);

/**
 * Every count of one account's imports, in one query. An AI attempt counts
 * until it is released; failed attempts that reached AI stay spent.
 */
export async function importCounts(
  database: Database,
  userId: string,
  period?: AiPeriod,
) {
  const now = Date.now();
  const unreleased = eq(recipeImport.usageReleased, false);
  const inFlight = inArray(recipeImport.state, inFlightStates);
  const [counts] = await database
    .select({
      inFlight: tally(inFlight),
      aiAttempts: tally(
        period &&
          and(
            unreleased,
            eq(recipeImport.usageBucket, period.bucket),
            period.since
              ? gte(recipeImport.createdAt, period.since)
              : undefined,
          ),
      ),
      // Job records outlive recipes, so deleting a recipe frees no attempt.
      dailyAttempts: tally(
        and(
          unreleased,
          or(
            gte(
              sql`coalesce(${recipeImport.startedAt}, ${recipeImport.createdAt})`,
              new Date(now - 86_400_000),
            ),
            inFlight,
          ),
        ),
      ),
      recentSubmissions: tally(
        gte(recipeImport.createdAt, new Date(now - 60_000)),
      ),
    })
    .from(recipeImport)
    .where(eq(recipeImport.userId, userId));
  return {
    inFlight: counts?.inFlight ?? 0,
    aiAttempts: counts?.aiAttempts ?? 0,
    dailyAttempts: counts?.dailyAttempts ?? 0,
    recentSubmissions: counts?.recentSubmissions ?? 0,
  };
}
