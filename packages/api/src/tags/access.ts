import { tag } from "@prep-sheet/db/schema/tag";
import { eq, isNull, or } from "drizzle-orm";
import { lockAccount } from "../billing/usage";
import type { Database } from "../households/access";

export const builtInTag = () => isNull(tag.userId);

// Custom tags are personal to the recipe owner.
export const customTagScope = (userId: string) => eq(tag.userId, userId);

export const availableTagScope = (userId: string) =>
  or(builtInTag(), customTagScope(userId));

// The account lock serializes tag writes, name checks and admission.
export async function lockTags(database: Database, userId: string) {
  await lockAccount(database, userId);
}
