import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import {
  accountDeletionRequest,
  supportRequest,
} from "@prep-sheet/db/schema/support";
import { asc, count, eq } from "drizzle-orm";

// Private operator access only. Each queue is bounded and oldest-first.
export async function listSupportQueue(offset: number) {
  const [reports, deletions, reportCount, deletionCount] = await Promise.all([
    db
      .select({ request: supportRequest, email: user.email })
      .from(supportRequest)
      .innerJoin(user, eq(user.id, supportRequest.userId))
      .orderBy(asc(supportRequest.createdAt), asc(supportRequest.id))
      .limit(100)
      .offset(offset),
    db
      .select({ request: accountDeletionRequest, email: user.email })
      .from(accountDeletionRequest)
      .innerJoin(user, eq(user.id, accountDeletionRequest.userId))
      .orderBy(
        asc(accountDeletionRequest.createdAt),
        asc(accountDeletionRequest.id),
      )
      .limit(100)
      .offset(offset),
    db.select({ total: count() }).from(supportRequest),
    db.select({ total: count() }).from(accountDeletionRequest),
  ]);
  return {
    reports,
    deletions,
    reportCount: reportCount[0]?.total ?? 0,
    deletionCount: deletionCount[0]?.total ?? 0,
    offset,
    limit: 100,
  };
}

export async function resolveSupportReport(reference: string) {
  const removed = await db
    .delete(supportRequest)
    .where(eq(supportRequest.id, reference))
    .returning({ id: supportRequest.id });
  if (!removed.length) throw new Error("No open report with this reference.");
}
