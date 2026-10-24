import { user } from "@prep-sheet/db/schema/auth";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { TRPCError } from "@trpc/server";
import { and, count, eq, gte, inArray, or, sql } from "drizzle-orm";
import { pricing } from "../billing/policy";
import type { Database } from "../households/access";

// Admission and reservation must share this transaction and account lock.
// Job records outlive recipes. Failed AI calls remain spent attempts.
export async function checkRecipeUsage(tx: Database, userId: string) {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update");
  const [usage] = await tx
    .select({ total: count() })
    .from(recipeImport)
    .where(
      and(
        eq(recipeImport.userId, userId),
        eq(recipeImport.usageReleased, false),
        or(
          gte(
            sql`coalesce(${recipeImport.startedAt}, ${recipeImport.createdAt})`,
            new Date(Date.now() - 86_400_000),
          ),
          inArray(recipeImport.state, [
            "queued",
            "fetching",
            "processing",
            "ready",
          ]),
        ),
      ),
    );
  if ((usage?.total ?? 0) >= pricing.ai.dailyAttemptsPerAccount)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `You've used your ${pricing.ai.dailyAttemptsPerAccount} AI attempts in the last 24 hours. Try again when an attempt expires.`,
    });
}
