import { db } from "@prep-sheet/db";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { providerConfiguration } from "@prep-sheet/env/server";
import { eq } from "drizzle-orm";
import {
  billingEnabled,
  customerPortal,
  startCheckout,
  syncBilling,
} from "../billing/polar";
import { pricing } from "../billing/policy";
import { usageSummary } from "../billing/usage";
import { protectedProcedure, router } from "../index";

export const billingRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [account] = await db
      .select()
      .from(billingAccount)
      .where(eq(billingAccount.userId, userId));
    return {
      ...(await usageSummary(db, userId)),
      available: billingEnabled(),
      hasCustomer: Boolean(account?.customerId),
      cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
      validUntil: account?.validUntil ?? null,
      trialEligible: !account?.trialUsed,
      pricing: {
        ...pricing,
        ai: {
          ...pricing.ai,
          enabled: pricing.ai.enabled && providerConfiguration.aiEnabled,
        },
      },
    };
  }),
  refresh: protectedProcedure.mutation(({ ctx }) =>
    db.transaction(async (tx) => {
      await syncBilling(tx, ctx.session.user.id);
      return { success: true };
    }),
  ),
  checkout: protectedProcedure.mutation(({ ctx }) =>
    startCheckout(ctx.session.user),
  ),
  portal: protectedProcedure.mutation(({ ctx }) =>
    customerPortal(ctx.session.user.id),
  ),
});
