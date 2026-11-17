import { allowance } from "@prep-sheet/api/billing/policy";
import { db } from "@prep-sheet/db";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { eq } from "drizzle-orm";

/** Reads the same subscription state and policy as `billing.status`. */
export async function hasAssistantAccess(userId: string) {
  const [account] = await db
    .select({
      status: billingAccount.status,
      validUntil: billingAccount.validUntil,
    })
    .from(billingAccount)
    .where(eq(billingAccount.userId, userId));
  const plan = allowance(
    account?.status ?? "free",
    account?.validUntil ?? null,
  );
  return plan.tier === "pro";
}
