import { tag } from "@prep-sheet/db/schema/tag";
import { and, eq, isNull, or } from "drizzle-orm";
import { lockAccount } from "../billing/usage";
import { type Database, lockGroup, requireGroup } from "../groups/access";

export const builtInTag = () => and(isNull(tag.userId), isNull(tag.groupId));

export const customTagScope = (userId: string, groupId: string | null) =>
  groupId ? eq(tag.groupId, groupId) : eq(tag.userId, userId);

export const collectionTagScope = (userId: string, groupId: string | null) =>
  or(builtInTag(), customTagScope(userId, groupId));

export async function lockTagCollection(
  database: Database,
  userId: string,
  groupId: string | null,
) {
  if (groupId) {
    await lockGroup(database, groupId);
    await requireGroup(database, groupId, userId);
  } else {
    await lockAccount(database, userId);
  }
}
