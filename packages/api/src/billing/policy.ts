import { aiPolicy } from "@prep-sheet/env/ai-policy";

// Product policy lives here. Polar owns the actual recurring price and coupons.
export const pricing = {
  free: { recipes: 10, aiCredits: 3, createHousehold: false },
  pro: { recipes: null, aiCredits: 50, createHousehold: true },
  trial: { days: 7, aiCredits: 3 },
  ai: {
    enabled: true,
    dailyAttemptsPerAccount: 50,
    pendingPerAccount: 5,
    concurrentAttempts: 2,
    // Reserve this conservative cost before each provider call. See BILLING.md.
    reserveCentsPerAttempt: aiPolicy.reserveCentsPerAttempt,
    dailyBudgetCents: aiPolicy.dailyBudgetCents,
  },
} satisfies {
  free: { recipes: number | null; aiCredits: number; createHousehold: boolean };
  pro: { recipes: number | null; aiCredits: number; createHousehold: boolean };
  trial: { days: number; aiCredits: number };
  ai: {
    enabled: boolean;
    dailyAttemptsPerAccount: number;
    pendingPerAccount: number;
    concurrentAttempts: number;
    reserveCentsPerAttempt: number;
    dailyBudgetCents: number;
  };
};

export function allowance(
  status: string,
  validUntil: Date | null,
  now = new Date(),
) {
  const pro =
    (status === "active" || status === "trialing") &&
    validUntil !== null &&
    validUntil > now;
  if (!pro)
    return {
      tier: "free",
      bucket: "free",
      credits: pricing.free.aiCredits,
      since: null,
      resetsAt: null,
      recipes: pricing.free.recipes,
      createHousehold: pricing.free.createHousehold,
    } as const;
  if (status === "trialing")
    return {
      tier: "pro",
      bucket: "trial",
      credits: pricing.trial.aiCredits,
      since: null,
      resetsAt: validUntil,
      recipes: pricing.pro.recipes,
      createHousehold: pricing.pro.createHousehold,
    } as const;
  return {
    tier: "pro",
    bucket: "pro",
    credits: pricing.pro.aiCredits,
    since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    resetsAt: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ),
    recipes: pricing.pro.recipes,
    createHousehold: pricing.pro.createHousehold,
  } as const;
}
