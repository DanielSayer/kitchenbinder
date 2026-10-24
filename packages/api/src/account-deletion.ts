import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { household, householdMember } from "@prep-sheet/db/schema/household";
import { recipe, recipeShare } from "@prep-sheet/db/schema/recipe";
import { accountDeletionRequest } from "@prep-sheet/db/schema/support";
import { and, asc, eq, exists, inArray, ne, not } from "drizzle-orm";
import {
  billingEnabled,
  hasUnfinishedSubscription,
  syncBilling,
} from "./billing/polar";
import { type Database, deleteOrphanedRecipes } from "./households/access";

// Shared households the user owns and who would inherit each (null = deleted).
export async function householdSuccession(database: Database, userId: string) {
  const owned = await database
    .select({ id: household.id, name: household.name })
    .from(household)
    .where(and(eq(household.ownerId, userId), eq(household.personal, false)))
    .orderBy(asc(household.createdAt), asc(household.id));
  if (!owned.length) return [];
  const members = await database
    .select({
      householdId: householdMember.householdId,
      id: user.id,
      name: user.name,
    })
    .from(householdMember)
    .innerJoin(user, eq(user.id, householdMember.userId))
    .where(
      and(
        inArray(
          householdMember.householdId,
          owned.map((item) => item.id),
        ),
        ne(householdMember.userId, userId),
      ),
    )
    .orderBy(asc(householdMember.joinedAt), asc(user.id));
  return owned.map((item) => {
    const next = members.find((member) => member.householdId === item.id);
    return {
      ...item,
      transferTo: next ? { id: next.id, name: next.name } : null,
    };
  });
}

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
    // Shared households pass to the longest-standing member; empty ones are deleted.
    for (const item of await householdSuccession(tx, request.userId)) {
      if (item.transferTo)
        await tx
          .update(household)
          .set({ ownerId: item.transferTo.id })
          .where(eq(household.id, item.id));
      else {
        await deleteOrphanedRecipes(tx, item.id);
        await tx.delete(household).where(eq(household.id, item.id));
      }
    }
    // "Just me" takes its plan and shopping list with it.
    await tx
      .delete(household)
      .where(
        and(
          eq(household.ownerId, request.userId),
          eq(household.personal, true),
        ),
      );
    // Recipes shared with a surviving household stay there without an owner
    // (recipe.user_id is SET NULL). Everything else the user owns is removed.
    await tx
      .delete(recipe)
      .where(
        and(
          eq(recipe.userId, request.userId),
          not(
            exists(
              tx
                .select({ id: recipeShare.recipeId })
                .from(recipeShare)
                .where(eq(recipeShare.recipeId, recipe.id)),
            ),
          ),
        ),
      );
    // Cascades remove private activity, collections, tags, credentials,
    // memberships, imports and requests.
    await tx.delete(user).where(eq(user.id, request.userId));
    return { deleted: true };
  });
}
