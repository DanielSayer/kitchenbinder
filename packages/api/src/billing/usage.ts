import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { recipeImport } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { providerConfiguration } from "@prep-sheet/env/server";
import { TRPCError } from "@trpc/server";
import { and, count, eq, gte, inArray, isNull, sql, sum } from "drizzle-orm";
import type { Database } from "../groups/access";
import { allowance, pricing } from "./policy";

export async function lockAccount(tx: Database, userId: string) {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update");
}

async function getAllowance(tx: Database, userId: string) {
  const [account] = await tx
    .select()
    .from(billingAccount)
    .where(eq(billingAccount.userId, userId));
  return allowance(account?.status ?? "free", account?.validUntil ?? null);
}

export async function usageSummary(tx: Database, userId: string) {
  const plan = await getAllowance(tx, userId);
  const [used] = await tx
    .select({ total: count() })
    .from(recipeImport)
    .where(
      and(
        eq(recipeImport.userId, userId),
        eq(recipeImport.usageReleased, false),
        eq(recipeImport.usageBucket, plan.bucket),
        plan.since ? gte(recipeImport.createdAt, plan.since) : undefined,
      ),
    );
  const [saved] = await tx
    .select({ total: count() })
    .from(recipe)
    .where(and(eq(recipe.userId, userId), isNull(recipe.deletedAt)));
  return { ...plan, used: used?.total ?? 0, saved: saved?.total ?? 0 };
}

// Caller holds the account lock until its insert or restore commits.
export async function checkRecipeCapacity(tx: Database, userId: string) {
  await lockAccount(tx, userId);
  const plan = await usageSummary(tx, userId);
  if (plan.recipes === null) return;
  const [pending] = await tx
    .select({ total: count() })
    .from(recipeImport)
    .where(
      and(
        eq(recipeImport.userId, userId),
        inArray(recipeImport.state, [
          "queued",
          "fetching",
          "processing",
          "ready",
        ]),
      ),
    );
  if (plan.saved + (pending?.total ?? 0) >= plan.recipes)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${plan.tier === "free" ? "Free" : "Pro"} plan allows ${plan.recipes} saved recipes, including imports in progress. Upgrade in Settings or remove a recipe to make room.`,
    });
}

export async function checkAiAllowance(tx: Database, userId: string) {
  const plan = await usageSummary(tx, userId);
  if (!pricing.ai.enabled || !providerConfiguration.aiEnabled)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "AI recipe creation is paused. You can still add recipes manually.",
    });
  if (plan.used >= plan.credits)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        plan.bucket === "pro"
          ? "You've used your monthly AI credits. They reset on the first of next month, UTC."
          : `You've used your ${plan.bucket === "trial" ? "trial" : "Free"} AI credits. Manage your plan in Settings.`,
    });
  return plan.bucket;
}

export async function requireHouseholdPlan(tx: Database, userId: string) {
  if (!(await getAllowance(tx, userId)).createHousehold)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Upgrade to Pro in Settings to create or invite people to a household. Joining is free.",
    });
}

// Global, cross-worker reservation immediately before calling AI, retained on errors.
export async function reserveAiSpend(tx: Database, importId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(728193042)`);
  const [existing] = await tx
    .select()
    .from(aiSpend)
    .where(eq(aiSpend.importId, importId));
  if (existing)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This AI attempt has already been started.",
    });
  const [spent] = await tx
    .select({ total: sum(aiSpend.reservedCents) })
    .from(aiSpend)
    .where(
      gte(
        aiSpend.createdAt,
        sql`date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`,
      ),
    );
  if (
    !pricing.ai.enabled ||
    !providerConfiguration.aiEnabled ||
    Number(spent?.total ?? 0) + pricing.ai.reserveCentsPerAttempt >
      pricing.ai.dailyBudgetCents
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "AI recipe creation has reached today's service limit. Please try again tomorrow or add a recipe manually.",
    });
  await tx
    .insert(aiSpend)
    .values({ importId, reservedCents: pricing.ai.reserveCentsPerAttempt });
}
