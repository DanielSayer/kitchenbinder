import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { ensurePersonalHousehold } from "@prep-sheet/db/households";
import { user } from "@prep-sheet/db/schema/auth";
import {
  household,
  householdColors,
  householdInvite,
  householdMember,
} from "@prep-sheet/db/schema/household";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireHouseholdPlan } from "../billing/usage";
import {
  deleteOrphanedRecipes,
  lockHousehold,
  requireHousehold,
} from "../households/access";
import { protectedProcedure, router } from "../index";

const householdInput = z.object({ householdId: z.uuid() });
const nameInput = z.string().trim().min(1).max(80);
const colorInput = z.enum(householdColors);
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
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

export async function listHouseholds(userId: string) {
  await ensurePersonalHousehold(db, userId);
  const households = await db
    .select({
      id: household.id,
      name: household.name,
      color: household.color,
      personal: household.personal,
      ownerId: household.ownerId,
      createdAt: household.createdAt,
    })
    .from(household)
    .innerJoin(householdMember, eq(householdMember.householdId, household.id))
    .where(eq(householdMember.userId, userId))
    .orderBy(
      desc(household.personal),
      asc(household.createdAt),
      asc(household.id),
    );
  const members = households.length
    ? await db
        .select({
          householdId: householdMember.householdId,
          id: user.id,
          name: user.name,
          image: user.image,
          joinedAt: householdMember.joinedAt,
        })
        .from(householdMember)
        .innerJoin(user, eq(user.id, householdMember.userId))
        .where(
          inArray(
            householdMember.householdId,
            households.map((item) => item.id),
          ),
        )
        .orderBy(asc(householdMember.joinedAt), asc(user.id))
    : [];
  return households.map((item) => ({
    ...item,
    isOwner: item.ownerId === userId,
    members: members
      .filter((member) => member.householdId === item.id)
      .map(({ householdId: _, ...member }) => member),
  }));
}

export const householdsRouter = router({
  // Households I belong to, "Just me" first, with members.
  list: protectedProcedure.query(({ ctx }) =>
    listHouseholds(ctx.session.user.id),
  ),
  create: protectedProcedure
    .input(z.object({ name: nameInput, color: colorInput.optional() }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await requireHouseholdPlan(tx, userId);
        const [existing] = await tx
          .select({ total: count() })
          .from(household)
          .where(
            and(eq(household.ownerId, userId), eq(household.personal, false)),
          );
        // Round-robin colours, leaving sage for "Just me" until the palette wraps.
        const color =
          input.color ??
          householdColors[(existing?.total ?? 0) % householdColors.length] ??
          "tomato";
        const [created] = await tx
          .insert(household)
          .values({
            id: randomUUID(),
            name: input.name,
            ownerId: userId,
            color,
          })
          .returning();
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await tx
          .insert(householdMember)
          .values({ householdId: created.id, userId });
        return created;
      }),
    ),
  details: protectedProcedure
    .input(householdInput)
    .query(async ({ input, ctx }) => {
      const current = await requireHousehold(
        db,
        input.householdId,
        ctx.session.user.id,
      );
      const members = await db
        .select({ id: user.id, name: user.name, image: user.image })
        .from(householdMember)
        .innerJoin(user, eq(user.id, householdMember.userId))
        .where(eq(householdMember.householdId, current.id))
        .orderBy(asc(householdMember.joinedAt), asc(user.id));
      const invites =
        current.ownerId === ctx.session.user.id && !current.personal
          ? await db
              .select({
                id: householdInvite.id,
                expiresAt: householdInvite.expiresAt,
              })
              .from(householdInvite)
              .where(
                and(
                  eq(householdInvite.householdId, current.id),
                  isNull(householdInvite.acceptedAt),
                  isNull(householdInvite.revokedAt),
                  gt(householdInvite.expiresAt, new Date()),
                ),
              )
          : [];
      return {
        ...current,
        isOwner: current.ownerId === ctx.session.user.id,
        members,
        invites,
      };
    }),
  rename: protectedProcedure
    .input(householdInput.extend({ name: nameInput }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(tx, input.householdId, ctx.session.user.id, {
          ownerOnly: true,
          allowPersonal: false,
        });
        await tx
          .update(household)
          .set({ name: input.name })
          .where(eq(household.id, input.householdId));
        return { success: true };
      }),
    ),
  recolor: protectedProcedure
    .input(householdInput.extend({ color: colorInput }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(tx, input.householdId, ctx.session.user.id, {
          ownerOnly: true,
        });
        await tx
          .update(household)
          .set({ color: input.color })
          .where(eq(household.id, input.householdId));
        return { success: true };
      }),
    ),
  invite: protectedProcedure.input(householdInput).mutation(({ input, ctx }) =>
    db.transaction(async (tx) => {
      await lockHousehold(tx, input.householdId);
      await requireHousehold(tx, input.householdId, ctx.session.user.id, {
        ownerOnly: true,
        allowPersonal: false,
      });
      const token = randomBytes(32).toString("hex");
      await requireHouseholdPlan(tx, ctx.session.user.id);
      const expiresAt = new Date(Date.now() + 7 * 86400000);
      await tx.insert(householdInvite).values({
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
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(tx, input.householdId, ctx.session.user.id, {
          ownerOnly: true,
        });
        await tx
          .update(householdInvite)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(householdInvite.id, input.inviteId),
              eq(householdInvite.householdId, input.householdId),
            ),
          );
        return { success: true };
      }),
    ),
  previewInvite: protectedProcedure
    .input(tokenInput)
    .query(async ({ input }) => {
      const [invite] = await db
        .select({ name: household.name, color: household.color })
        .from(householdInvite)
        .innerJoin(household, eq(household.id, householdInvite.householdId))
        .where(and(liveInvite(input.token), eq(household.personal, false)));
      if (!invite) throw invalidInvite();
      return invite;
    }),
  acceptInvite: protectedProcedure
    .input(tokenInput)
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(householdInvite)
          .where(liveInvite(input.token));
        if (!candidate) throw invalidInvite();
        await lockHousehold(tx, candidate.householdId);
        const [invite] = await tx
          .select({ invite: householdInvite, personal: household.personal })
          .from(householdInvite)
          .innerJoin(household, eq(household.id, householdInvite.householdId))
          .where(liveInvite(input.token));
        if (!invite || invite.personal) throw invalidInvite();
        const { householdId } = invite.invite;
        const [existing] = await tx
          .select()
          .from(householdMember)
          .where(
            and(
              eq(householdMember.householdId, householdId),
              eq(householdMember.userId, ctx.session.user.id),
            ),
          );
        if (existing) return { householdId };
        await tx
          .insert(householdMember)
          .values({ householdId, userId: ctx.session.user.id });
        await tx
          .update(householdInvite)
          .set({ acceptedAt: new Date() })
          .where(eq(householdInvite.id, invite.invite.id));
        return { householdId };
      }),
    ),
  // Members leave; owners transfer ownership or delete the household instead.
  leave: protectedProcedure.input(householdInput).mutation(({ input, ctx }) =>
    db.transaction(async (tx) => {
      const userId = ctx.session.user.id;
      await lockHousehold(tx, input.householdId);
      const current = await requireHousehold(tx, input.householdId, userId, {
        allowPersonal: false,
      });
      if (current.ownerId === userId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Transfer ownership to another member or delete the household before leaving.",
        });
      await tx
        .delete(householdMember)
        .where(
          and(
            eq(householdMember.householdId, input.householdId),
            eq(householdMember.userId, userId),
          ),
        );
      return { success: true };
    }),
  ),
  removeMember: protectedProcedure
    .input(householdInput.extend({ userId: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        const current = await requireHousehold(
          tx,
          input.householdId,
          ctx.session.user.id,
          {
            ownerOnly: input.userId !== ctx.session.user.id,
            allowPersonal: false,
          },
        );
        if (input.userId === current.ownerId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The owner must stay in the household.",
          });
        await tx
          .delete(householdMember)
          .where(
            and(
              eq(householdMember.householdId, input.householdId),
              eq(householdMember.userId, input.userId),
            ),
          );
        return { success: true };
      }),
    ),
  transferOwnership: protectedProcedure
    .input(householdInput.extend({ userId: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await requireHousehold(tx, input.householdId, ctx.session.user.id, {
          ownerOnly: true,
          allowPersonal: false,
        });
        const [member] = await tx
          .select()
          .from(householdMember)
          .where(
            and(
              eq(householdMember.householdId, input.householdId),
              eq(householdMember.userId, input.userId),
            ),
          );
        if (!member)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose someone who is already a member.",
          });
        await requireHouseholdPlan(tx, input.userId);
        await tx
          .update(household)
          .set({ ownerId: input.userId })
          .where(eq(household.id, input.householdId));
        return { success: true };
      }),
    ),
  // Recipes stay with their owners; shares, plan and list are removed.
  delete: protectedProcedure
    .input(householdInput.extend({ name: z.string() }))
    .mutation(({ input, ctx }) =>
      db.transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        const current = await requireHousehold(
          tx,
          input.householdId,
          ctx.session.user.id,
          { ownerOnly: true, allowPersonal: false },
        );
        if (input.name !== current.name)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Enter the household name exactly to confirm deletion.",
          });
        await deleteOrphanedRecipes(tx, input.householdId);
        await tx.delete(household).where(eq(household.id, input.householdId));
        return { success: true };
      }),
    ),
});
