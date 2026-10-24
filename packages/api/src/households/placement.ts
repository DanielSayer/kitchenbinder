import { collectionRecipe } from "@prep-sheet/db/schema/collection";
import { recipeShare } from "@prep-sheet/db/schema/recipe";
import {
  type Database,
  lockHousehold,
  nextCollectionPosition,
  requireCollection,
  requireHousehold,
} from "./access";

// Where a newly saved recipe goes: shared with a household and/or added to a collection.
export type Placement = {
  householdId: string | null;
  collectionId: string | null;
};
export type PreparedPlacement = {
  shareWith: string | null;
  collectionId: string | null;
};

// Validates the destination. Sharing with "Just me" is a no-op.
export async function preparePlacement(
  database: Database,
  userId: string,
  placement: Placement,
  { lock = true } = {},
): Promise<PreparedPlacement> {
  let shareWith: string | null = null;
  if (placement.householdId) {
    if (lock) await lockHousehold(database, placement.householdId);
    const target = await requireHousehold(
      database,
      placement.householdId,
      userId,
    );
    if (!target.personal) shareWith = target.id;
  }
  if (placement.collectionId)
    await requireCollection(database, placement.collectionId, userId, {
      ownerOnly: true,
      lock,
    });
  return { shareWith, collectionId: placement.collectionId };
}

export async function applyPlacement(
  database: Database,
  recipeId: string,
  prepared: PreparedPlacement,
) {
  if (prepared.shareWith)
    await database
      .insert(recipeShare)
      .values({ recipeId, householdId: prepared.shareWith })
      .onConflictDoNothing();
  if (prepared.collectionId)
    await database
      .insert(collectionRecipe)
      .values({
        collectionId: prepared.collectionId,
        recipeId,
        position: nextCollectionPosition(prepared.collectionId),
      })
      .onConflictDoNothing();
}
