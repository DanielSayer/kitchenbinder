import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import {
  accountDeletionRequest,
  supportRequest,
} from "@prep-sheet/db/schema/support";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { householdSuccession } from "../account-deletion";
import { protectedProcedure, router } from "../index";

export const supportRouter = router({
  reports: protectedProcedure.query(({ ctx }) =>
    db
      .select()
      .from(supportRequest)
      .where(eq(supportRequest.userId, ctx.session.user.id))
      .orderBy(desc(supportRequest.createdAt))
      .limit(20),
  ),
  report: protectedProcedure
    .input(z.object({ message: z.string().trim().min(10).max(4000) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        // Serialize submissions for this account, including concurrent requests.
        await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, ctx.session.user.id))
          .for("update");
        const recent = await tx
          .select({ id: supportRequest.id })
          .from(supportRequest)
          .where(
            and(
              eq(supportRequest.userId, ctx.session.user.id),
              gt(supportRequest.createdAt, new Date(Date.now() - 3600000)),
            ),
          );
        if (recent.length >= 5)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message:
              "You've sent five reports in the last hour. Please try again later.",
          });
        const [saved] = await tx
          .insert(supportRequest)
          .values({
            id: randomUUID(),
            userId: ctx.session.user.id,
            message: input.message,
          })
          .returning();
        if (!saved) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return saved;
      }),
    ),
  deletion: protectedProcedure.query(async ({ ctx }) => {
    const [request] = await db
      .select()
      .from(accountDeletionRequest)
      .where(eq(accountDeletionRequest.userId, ctx.session.user.id));
    // Shared households pass to their longest-standing member, else are deleted.
    const ownedHouseholds = await householdSuccession(db, ctx.session.user.id);
    return { request: request ?? null, ownedHouseholds };
  }),
  requestDeletion: protectedProcedure
    .input(z.object({ confirmation: z.literal("DELETE") }))
    .mutation(async ({ ctx }) => {
      await db
        .insert(accountDeletionRequest)
        .values({ userId: ctx.session.user.id, id: randomUUID() })
        .onConflictDoNothing();
      return { success: true };
    }),
  cancelDeletion: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .delete(accountDeletionRequest)
      .where(eq(accountDeletionRequest.userId, ctx.session.user.id));
    return { success: true };
  }),
});
