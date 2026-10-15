import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { group } from "@prep-sheet/db/schema/group";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { accountDeletionRequest } from "@prep-sheet/db/schema/support";
import { and, eq, isNull } from "drizzle-orm";
import {
  billingEnabled,
  hasUnfinishedSubscription,
  syncBilling,
} from "./billing/polar";

// Operator-only. Never expose this as a public or authenticated user procedure.
export async function completeAccountDeletion(requestId: string) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(accountDeletionRequest)
      .where(eq(accountDeletionRequest.id, requestId))
      .for("update");
    if (!request)
      throw new Error("No pending deletion request with this reference.");
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, request.userId))
      .for("update");
    const owned = await tx
      .select({ id: group.id })
      .from(group)
      .where(eq(group.ownerId, request.userId));
    if (owned.length)
      throw new Error(
        "The account still owns groups. Ask the owner to transfer or explicitly delete them first.",
      );
    const [billing] = await tx
      .select()
      .from(billingAccount)
      .where(eq(billingAccount.userId, request.userId));
    // Checkout can precede the first customer-state webhook. A missing local
    // customer ID does not prove there is no subscription to resolve.
    if (
      billing &&
      (billing.customerId ||
        billing.trialUsed ||
        billing.checkoutUrl ||
        billing.status !== "free")
    ) {
      if (!billingEnabled())
        throw new Error(
          "Restore Polar configuration and verify cancellation before deleting this account.",
        );
      if (
        billing.checkoutUrl &&
        (!billing.checkoutExpiresAt || billing.checkoutExpiresAt > new Date())
      )
        throw new Error(
          "Wait for the pending Polar checkout to expire before completing account deletion.",
        );
      const current = await syncBilling(tx, request.userId);
      if (
        current?.status !== "free" ||
        (await hasUnfinishedSubscription(request.userId))
      )
        throw new Error(
          "Cancel the Polar subscription and wait for it to end before completing account deletion.",
        );
    }
    // Personal recipes use SET NULL, so remove them explicitly before the user.
    await tx
      .delete(recipe)
      .where(and(eq(recipe.userId, request.userId), isNull(recipe.groupId)));
    // Cascades remove private activity, credentials, memberships, imports and requests.
    // Shared recipes survive with their contributor and deletedBy links set to null.
    await tx.delete(user).where(eq(user.id, request.userId));
    return { deleted: true };
  });
}
