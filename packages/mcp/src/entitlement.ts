import { allowance } from "@prep-sheet/api/billing/policy";
import { db } from "@prep-sheet/db";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { eq } from "drizzle-orm";

// Read the same subscription state as billing.status, on EVERY tool invocation.
export async function accountPlan(userId: string) {
  const [account] = await db
    .select({
      status: billingAccount.status,
      validUntil: billingAccount.validUntil,
    })
    .from(billingAccount)
    .where(eq(billingAccount.userId, userId));
  return allowance(account?.status ?? "free", account?.validUntil ?? null);
}
