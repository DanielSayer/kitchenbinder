import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { providerConfiguration } from "@prep-sheet/env/server";
import { TRPCError } from "@trpc/server";
import { and, count, eq, gte, isNull, sql, sum } from "drizzle-orm";
import type { Database } from "../households/access";
import { allowance, pricing } from "./policy";

// Plan rules only. Import counts come from the import module (see ./summary).

export async function lockAccount(tx: Database, userId: string) {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update");
}

export type AccountPlan = ReturnType<typeof allowance>;

export async function accountPlan(
  tx: Database,
  userId: string,
): Promise<AccountPlan> {
  const [account] = await tx
    .select()
    .from(billingAccount)
    .where(eq(billingAccount.userId, userId));
  return allowance(account?.status ?? "free", account?.validUntil ?? null);
}

export async function savedRecipeCount(tx: Database, userId: string) {
  const [saved] = await tx
    .select({ total: count() })
    .from(recipe)
    .where(and(eq(recipe.userId, userId), isNull(recipe.deletedAt)));
  return saved?.total ?? 0;
}

/** Imports in progress hold a place, so they count as saved recipes. */
export function requireRecipeRoom(
  plan: AccountPlan,
  saved: number,
  inFlight: number,
) {
  if (plan.recipes !== null && saved + inFlight >= plan.recipes)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${plan.tier === "free" ? "Free" : "Pro"} plan allows ${plan.recipes} saved recipes, including imports in progress. Upgrade in Settings or remove a recipe to make room.`,
    });
}

/** Returns the bucket a new AI attempt is charged to. */
export function requireAiCredit(plan: AccountPlan, used: number) {
  if (!pricing.ai.enabled || !providerConfiguration.aiEnabled)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "AI recipe creation is paused. You can still add recipes manually.",
    });
  if (used >= plan.credits)
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
  if (!(await accountPlan(tx, userId)).createHousehold)
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
