import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { calendarDate } from "@prep-sheet/db/meal-planner";
import { user } from "@prep-sheet/db/schema/auth";
import {
  household,
  householdInvite,
  householdMember,
} from "@prep-sheet/db/schema/household";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireHouseholdPlan } from "../billing/usage";
import type { Database } from "../groups/access";
import {
  lockAccount,
  lockHousehold,
  requireHousehold,
  scopeOwner,
} from "../households/access";
import { copyMeals } from "../households/copy-meals";
import { protectedProcedure, router } from "../index";
import { plannerState, savePlannerState } from "./planner";

const householdInput = z.object({ householdId: z.uuid() });
const nameInput = z.string().trim().min(1).max(80);
const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const liveInvite = (token: string) =>
  and(
    eq(householdInvite.tokenHash, hash(token)),
    isNull(householdInvite.revokedAt),
    isNull(householdInvite.acceptedAt),
    gt(householdInvite.expiresAt, new Date()),
  );
const invalidInvite = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message:
      "This invitation has expired, was revoked or has already been used. Ask for a new link.",
  });
async function membership(tx: Database, userId: string) {
  const [member] = await tx
    .select()
    .from(householdMember)
    .where(eq(householdMember.userId, userId));
  return member;
}
function alreadyJoined() {
  return new TRPCError({
    code: "CONFLICT",
    message:
      "You already belong to a household. Leave it before joining or creating another.",
  });
}
async function copyToPersonal(
  tx: Database,
  householdId: string,
  userId: string,
  from: string,
) {
  await lockAccount(tx, userId);
  const source = await plannerState(
    tx,
    scopeOwner({ kind: "household", householdId }, userId),
  );
  const destination = await plannerState(
    tx,
    scopeOwner({ kind: "personal" }, userId),
  );
  const result = copyMeals(
    source.meals,
    destination.meals,
    from,
    `personal:${userId}:household:${householdId}`,
  );
  if (result.copied)
    await savePlannerState(tx, {
      ...destination,
      meals: result.meals,
      revision: destination.revision + 1,
    });
  return { copied: result.copied };
}

export const householdsRouter = router({
  current: protectedProcedure.query(({ ctx }) =>
    db.transaction(async (tx) => {
      const member = await membership(tx, ctx.session.user.id);
      if (!member) return null;
      await lockHousehold(tx, member.householdId);
      // Recheck after acquiring the lock, including when another member just removed us.
      if (!(await membership(tx, ctx.session.user.id))) return null;
      const current = await requireHousehold(
        tx,
        member.householdId,
        ctx.session.user.id,
      );
      const members = await tx
        .select({ id: user.id, name: user.name })
        .from(householdMember)
        .innerJoin(user, eq(user.id, householdMember.userId))
        .where(eq(householdMember.householdId, current.id))
        .orderBy(asc(householdMember.joinedAt), asc(user.id));
      const invites =
        current.ownerId === ctx.session.user.id
          ? await tx
              .select({
                id: householdInvite.id,
                expiresAt: householdInvite.expiresAt,
              })
              .from(householdInvite)
              .where(
                and(
                  eq(householdInvite.householdId, current.id),
                  isNull(householdInvite.revokedAt),
                  isNull(householdInvite.acceptedAt),
                  gt(householdInvite.expiresAt, new Date()),
                ),
              )
              .orderBy(asc(householdInvite.createdAt))
          : [];
      return { ...current, members, invites };
    }),
  ),
  create: protectedProcedure
    .input(
      z.object({
        name: nameInput,
        copyPersonalMeals: z.boolean(),
        from: calendarDate,
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await lockAccount(tx, userId);
        if (await membership(tx, userId)) throw alreadyJoined();
        await requireHouseholdPlan(tx, userId);
        const id = randomUUID();
        await tx
          .insert(household)
          .values({ id, name: input.name, ownerId: userId });
        await tx.insert(householdMember).values({ householdId: id, userId });
        if (input.copyPersonalMeals) {
          const source = await plannerState(
            tx,
            scopeOwner({ kind: "personal" }, userId),
          );
          const destination = await plannerState(
            tx,
            scopeOwner({ kind: "household", householdId: id }, userId),
          );
          const result = copyMeals(
            source.meals,
            [],
            input.from,
            `household:${id}:personal:${userId}`,
          );
          await savePlannerState(tx, {
            ...destination,
            meals: result.meals,
            revision: 1,
          });
        }
        return { householdId: id };
      }),
    ),
  rename: protectedProcedure
    .input(householdInput.extend({ name: nameInput }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(
          tx,
          input.householdId,
          ctx.session.user.id,
          true,
        );
        await tx
          .update(household)
          .set({ name: input.name })
          .where(eq(household.id, input.householdId));
      }),
    ),
  invite: protectedProcedure.input(householdInput).mutation(({ ctx, input }) =>
    db.transaction(async (tx) => {
      await lockHousehold(tx, input.householdId);
      await requireHousehold(tx, input.householdId, ctx.session.user.id, true);
      await requireHouseholdPlan(tx, ctx.session.user.id);
      const active = await tx
        .select({ id: householdInvite.id })
        .from(householdInvite)
        .where(
          and(
            eq(householdInvite.householdId, input.householdId),
            isNull(householdInvite.acceptedAt),
            isNull(householdInvite.revokedAt),
            gt(householdInvite.expiresAt, new Date()),
          ),
        );
      if (active.length >= 10)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Revoke an unused invitation before creating another. You can have up to 10 active links.",
        });
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 86400000);
      await tx
        .insert(householdInvite)
        .values({
          id: randomUUID(),
          householdId: input.householdId,
          tokenHash: hash(token),
          expiresAt,
        });
      return { token, expiresAt };
    }),
  ),
  revokeInvite: protectedProcedure
    .input(householdInput.extend({ inviteId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(
          tx,
          input.householdId,
          ctx.session.user.id,
          true,
        );
        await tx
          .update(householdInvite)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(householdInvite.householdId, input.householdId),
              eq(householdInvite.id, input.inviteId),
            ),
          );
      }),
    ),
  previewInvite: protectedProcedure
    .input(tokenInput)
    .query(async ({ input }) => {
      const [invite] = await db
        .select({ name: household.name, householdId: household.id })
        .from(householdInvite)
        .innerJoin(household, eq(household.id, householdInvite.householdId))
        .where(liveInvite(input.token));
      if (!invite) throw invalidInvite();
      return invite;
    }),
  acceptInvite: protectedProcedure
    .input(tokenInput)
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(householdInvite)
          .where(liveInvite(input.token));
        if (!candidate) throw invalidInvite();
        // Shared operations always acquire household before account locks.
        await lockHousehold(tx, candidate.householdId);
        await lockAccount(tx, ctx.session.user.id);
        const [invite] = await tx
          .select()
          .from(householdInvite)
          .where(liveInvite(input.token));
        if (!invite) throw invalidInvite();
        const existing = await membership(tx, ctx.session.user.id);
        if (existing?.householdId === invite.householdId)
          return { householdId: invite.householdId };
        if (existing) throw alreadyJoined();
        const members = await tx
          .select({ id: householdMember.userId })
          .from(householdMember)
          .where(eq(householdMember.householdId, invite.householdId));
        if (members.length >= 20)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This household has reached its 20-member limit.",
          });
        await tx
          .insert(householdMember)
          .values({
            userId: ctx.session.user.id,
            householdId: invite.householdId,
          });
        await tx
          .update(householdInvite)
          .set({ acceptedAt: new Date() })
          .where(eq(householdInvite.id, invite.id));
        return { householdId: invite.householdId };
      }),
    ),
  copyMealsToPersonal: protectedProcedure
    .input(householdInput.extend({ from: calendarDate }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(tx, input.householdId, ctx.session.user.id);
        return copyToPersonal(
          tx,
          input.householdId,
          ctx.session.user.id,
          input.from,
        );
      }),
    ),
  removeMember: protectedProcedure
    .input(
      householdInput.extend({
        userId: z.string().min(1),
        copyUpcomingFrom: calendarDate.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        const self = input.userId === ctx.session.user.id;
        const current = await requireHousehold(
          tx,
          input.householdId,
          ctx.session.user.id,
          !self,
        );
        if (input.userId === current.ownerId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Transfer ownership before leaving, or delete the household.",
          });
        if (!self && input.copyUpcomingFrom)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only you can copy meals into your personal planner.",
          });
        if (self && input.copyUpcomingFrom)
          await copyToPersonal(
            tx,
            input.householdId,
            ctx.session.user.id,
            input.copyUpcomingFrom,
          );
        await tx
          .delete(householdMember)
          .where(
            and(
              eq(householdMember.householdId, input.householdId),
              eq(householdMember.userId, input.userId),
            ),
          );
      }),
    ),
  transferOwnership: protectedProcedure
    .input(householdInput.extend({ userId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(
          tx,
          input.householdId,
          ctx.session.user.id,
          true,
        );
        const target = await membership(tx, input.userId);
        if (target?.householdId !== input.householdId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose an existing household member.",
          });
        await requireHouseholdPlan(tx, input.userId);
        await tx
          .update(household)
          .set({ ownerId: input.userId })
          .where(eq(household.id, input.householdId));
      }),
    ),
  delete: protectedProcedure
    .input(householdInput.extend({ name: z.string() }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        const current = await requireHousehold(
          tx,
          input.householdId,
          ctx.session.user.id,
          true,
        );
        if (input.name !== current.name)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Enter the household name exactly to confirm deletion.",
          });
        await tx.delete(household).where(eq(household.id, input.householdId));
      }),
    ),
});
