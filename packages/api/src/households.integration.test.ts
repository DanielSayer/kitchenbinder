import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import type { MealInput } from "@prep-sheet/db/meal-planner";
import { user } from "@prep-sheet/db/schema/auth";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { group, groupMember } from "@prep-sheet/db/schema/group";
import {
  household,
  householdInvite,
  householdMember,
} from "@prep-sheet/db/schema/household";
import { mealPlanner } from "@prep-sheet/db/schema/meal-planner";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { shoppingItem, shoppingPlan } from "@prep-sheet/db/schema/shopping";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeAccountDeletion } from "./account-deletion";
import type { Context } from "./context";
import { sampleRecipe } from "./recipes/fixtures";
import { appRouter } from "./routers";

const ownerId = randomUUID();
const partnerId = randomUUID();
const strangerId = randomUUID();
const secondOwnerId = randomUUID();
const ids = [ownerId, partnerId, strangerId, secondOwnerId];
const recipeId = randomUUID();
const groupId = randomUUID();
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Household test",
      email: `${id}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: randomUUID(),
      token: randomUUID(),
      userId: id,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
  return appRouter.createCaller({ auth: null, session });
}
const owner = caller(ownerId);
const partner = caller(partnerId);
const stranger = caller(strangerId);
const secondOwner = caller(secondOwnerId);
const coverage = {
  shoppingDate: "2026-10-22",
  start: "2026-10-22",
  end: "2026-10-28",
};
const recipeMeal = (): Extract<MealInput, { kind: "recipe" }> => ({
  id: randomUUID(),
  date: "2026-10-22",
  slot: "Dinner",
  kind: "recipe",
  recipeId,
  baseServings: 2,
  cook: 4,
  eat: 2,
});
async function create(shared = false) {
  const result = await owner.households.create({
    name: "Home",
    from: coverage.start,
    copyPersonalMeals: shared,
  });
  return { kind: "household", householdId: result.householdId } as const;
}
async function join(scope: Awaited<ReturnType<typeof create>>) {
  const invite = await owner.households.invite(scope);
  await partner.households.acceptInvite({ token: invite.token });
}

describe("households with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: "Household test",
        email: `${id}@example.test`,
      })),
    );
    await db
      .insert(group)
      .values({ id: groupId, name: "Unrelated collection", ownerId });
    await db.insert(groupMember).values({ groupId, userId: ownerId });
    await db.insert(recipe).values({
      id: recipeId,
      userId: ownerId,
      groupId,
      title: "Curry",
      origin: "manual",
      content: {
        ...sampleRecipe,
        ingredients: ["200 g rice", "1 onion"],
        notes: "Private recipe notes",
      },
    });
  });
  beforeEach(async () => {
    await db.delete(household).where(inArray(household.ownerId, ids));
    await db.delete(mealPlanner).where(inArray(mealPlanner.userId, ids));
    await db.delete(shoppingItem).where(inArray(shoppingItem.userId, ids));
    await db.delete(shoppingPlan).where(inArray(shoppingPlan.userId, ids));
    await db.delete(billingAccount).where(inArray(billingAccount.userId, ids));
    await db.insert(billingAccount).values(
      [ownerId, partnerId, secondOwnerId].map((userId) => ({
        userId,
        status: "active",
        validUntil: new Date(Date.now() + 86400000),
      })),
    );
  });
  afterAll(async () => {
    await db.delete(household).where(inArray(household.ownerId, ids));
    await db.delete(group).where(eq(group.id, groupId));
    await db.delete(user).where(inArray(user.id, ids));
    await db.$client.end();
  });

  it("requires authentication and applies existing Pro creation policy while joining stays free", async () => {
    await expect(
      appRouter
        .createCaller({ auth: null, session: null })
        .households.current(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      stranger.households.create({
        name: "Home",
        from: coverage.start,
        copyPersonalMeals: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const scope = await create();
    const invite = await owner.households.invite(scope);
    await stranger.households.acceptInvite(invite);
    expect((await stranger.households.current())?.id).toBe(scope.householdId);
    await expect(
      owner.households.transferOwnership({ ...scope, userId: strangerId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db
      .update(billingAccount)
      .set({ status: "free" })
      .where(eq(billingAccount.userId, ownerId));
    await expect(owner.households.invite(scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await stranger.planner.save({
      scope,
      revision: 0,
      meal: {
        id: randomUUID(),
        kind: "out",
        description: "Dinner",
        date: coverage.start,
        slot: "Dinner",
      },
    });
    expect((await owner.planner.get(scope)).meals).toHaveLength(1);
  });

  it("keeps personal plans, shopping and collection membership independent", async () => {
    const meal = recipeMeal();
    await owner.planner.save({ revision: 0, meal });
    await owner.shopping.addItem({
      id: randomUUID(),
      text: "Private groceries",
    });
    const scope = await create();
    await join(scope);
    expect((await partner.planner.get(scope)).meals).toEqual([]);
    expect(await partner.shopping.list(scope)).toEqual([]);
    expect((await owner.planner.get()).meals).toHaveLength(1);
    expect(await owner.shopping.list()).toHaveLength(1);
    expect(await partner.groups.list()).toEqual([]);
    expect(await partner.shopping.recipe({ id: recipeId })).toBeNull();
    await expect(stranger.planner.get(scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(stranger.shopping.list(scope)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("copies upcoming personal meals with earlier leftover sources without moving personal data", async () => {
    const meal = { ...recipeMeal(), date: "2026-10-21" };
    await owner.planner.save({ revision: 0, meal });
    await owner.planner.save({
      revision: 1,
      meal: {
        id: randomUUID(),
        kind: "leftovers",
        sourceId: meal.id,
        portions: 2,
        date: coverage.start,
        slot: "Lunch",
      },
    });
    const scope = await create(true);
    const shared = await owner.planner.get(scope);
    const source = shared.meals.find((entry) => entry.kind === "recipe");
    const leftovers = shared.meals.find((entry) => entry.kind === "leftovers");
    expect(source?.id).not.toBe(meal.id);
    expect(leftovers?.kind === "leftovers" && leftovers.sourceId).toBe(
      source?.id,
    );
    expect(shared.issues).toEqual([]);
    expect((await owner.planner.get()).meals).toHaveLength(2);
    expect(await owner.shopping.generated(scope)).toBeNull();
  });

  it("shares a stable cooking snapshot without exposing recipe notes or source collection", async () => {
    const scope = await create();
    await join(scope);
    const meal = recipeMeal();
    await owner.planner.save({ scope, revision: 0, meal });
    const shared = (await partner.planner.get(scope)).meals[0];
    expect(shared).toMatchObject({
      title: "Curry",
      ingredients: ["200 g rice", "1 onion"],
      recipe: { steps: sampleRecipe.steps },
    });
    expect(JSON.stringify(shared)).not.toContain("Private recipe notes");
    // A partner can change portions and duplicate the saved meal without source access.
    await partner.planner.save({
      scope,
      revision: 1,
      meal: { ...meal, cook: 6 },
    });
    await partner.planner.save({
      scope,
      revision: 2,
      copyFrom: meal.id,
      meal: { ...meal, id: randomUUID(), date: "2026-10-23" },
    });
    await expect(
      partner.planner.save({
        scope,
        revision: 3,
        meal: { ...meal, id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db
      .update(recipe)
      .set({ title: "Changed original" })
      .where(eq(recipe.id, recipeId));
    expect(
      (await owner.planner.get(scope)).meals.every(
        (entry) => entry.kind !== "recipe" || entry.title === "Curry",
      ),
    ).toBe(true);
    await db
      .update(recipe)
      .set({ title: "Curry" })
      .where(eq(recipe.id, recipeId));
  });

  it("serializes partner edits and rejects stale shopping previews after a partner purchase", async () => {
    const scope = await create();
    await join(scope);
    const meal = recipeMeal();
    const competing = await Promise.allSettled([
      owner.planner.save({ scope, revision: 0, meal }),
      partner.planner.save({
        scope,
        revision: 0,
        meal: {
          id: randomUUID(),
          date: coverage.start,
          slot: "Lunch",
          kind: "out",
          description: "Cafe",
        },
      }),
    ]);
    expect(
      competing.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const saved = await owner.planner.get(scope);
    if (!saved.meals.some((entry) => entry.id === meal.id))
      await owner.planner.save({ scope, revision: saved.revision, meal });
    const preview = await partner.planner.preview({
      scope,
      coverage,
      replace: false,
    });
    await partner.planner.applyTrip({
      scope,
      coverage,
      replace: false,
      token: preview.token,
    });
    const reviewed = await owner.planner.preview({
      scope,
      coverage,
      replace: false,
    });
    const item = (await partner.shopping.list(scope))[0];
    if (!item) throw new Error("Missing shared ingredient");
    await partner.shopping.updateItem({
      scope,
      id: item.id,
      kind: "status",
      status: "bought",
    });
    await expect(
      owner.planner.applyTrip({
        scope,
        coverage,
        replace: false,
        token: reviewed.token,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await owner.shopping.list(scope)).find((entry) => entry.id === item.id)
        ?.status,
    ).toBe("bought");
    expect(await owner.shopping.list()).toEqual([]);
    expect(await partner.shopping.list()).toEqual([]);
  });

  it("shares groceries, generated lists and clears without affecting personal shopping", async () => {
    const scope = await create();
    await join(scope);
    const privateId = randomUUID();
    const id = randomUUID();
    await owner.shopping.addItem({ id: privateId, text: "Personal" });
    await partner.shopping.addItem({ scope, id, text: "Milk" });
    await owner.shopping.generate(scope);
    const plan = await partner.shopping.generated(scope);
    if (!plan) throw new Error("Missing generated list");
    await partner.shopping.checkGroup({
      scope,
      planId: plan.id,
      groupIndex: 0,
      bought: true,
    });
    expect((await owner.shopping.list(scope))[0]?.status).toBe("bought");
    await partner.shopping.clear({ planningScope: scope, scope: "bought" });
    expect(await owner.shopping.list(scope)).toEqual([]);
    expect((await owner.shopping.list())[0]?.id).toBe(privateId);
    await owner.shopping.clear({ planningScope: scope, scope: "all" });
    expect(await partner.shopping.generated(scope)).toBeNull();
  });

  it("rejects stale grocery text edits while keeping the saved partner edit", async () => {
    const scope = await create();
    await join(scope);
    const id = randomUUID();
    await owner.shopping.addItem({ scope, id, text: "Milk" });
    await partner.shopping.updateItem({
      scope,
      id,
      kind: "text",
      expectedText: "Milk",
      text: "Oat milk",
    });
    await expect(
      owner.shopping.updateItem({
        scope,
        id,
        kind: "text",
        expectedText: "Milk",
        text: "Full cream milk",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.shopping.list(scope))[0]?.text).toBe("Oat milk");
  });

  it("stores hashed invitations and rejects revoked, expired and reused links", async () => {
    const scope = await create();
    const revoked = await owner.households.invite(scope);
    let current = await owner.households.current();
    const first = current?.invites[0];
    if (!first) throw new Error("Missing invitation");
    const [stored] = await db
      .select()
      .from(householdInvite)
      .where(eq(householdInvite.id, first.id));
    expect(stored?.tokenHash).not.toBe(revoked.token);
    await expect(
      partner.households.revokeInvite({ ...scope, inviteId: first.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.households.revokeInvite({ ...scope, inviteId: first.id });
    await expect(
      partner.households.acceptInvite(revoked),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const expired = await owner.households.invite(scope);
    current = await owner.households.current();
    const next = current?.invites[0];
    if (!next) throw new Error("Missing invitation");
    await db
      .update(householdInvite)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(householdInvite.id, next.id));
    await expect(
      partner.households.previewInvite(expired),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const valid = await owner.households.invite(scope);
    await partner.households.acceptInvite(valid);
    await expect(stranger.households.acceptInvite(valid)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect((await partner.households.current())?.invites).toEqual([]);
  });

  it("lets only one person consume an invitation under competing acceptance", async () => {
    const scope = await create();
    const invite = await owner.households.invite(scope);
    const results = await Promise.allSettled([
      partner.households.acceptInvite(invite),
      stranger.households.acceptInvite(invite),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await owner.households.current())?.members).toHaveLength(2);
  });

  it("enforces one household when a person accepts two different invitations at once", async () => {
    const scope = await create();
    const second = await secondOwner.households.create({
      name: "Other",
      from: coverage.start,
      copyPersonalMeals: false,
    });
    const invites = await Promise.all([
      owner.households.invite(scope),
      secondOwner.households.invite(second),
    ]);
    const results = await Promise.allSettled(
      invites.map((invite) => partner.households.acceptInvite(invite)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(householdMember)
        .where(eq(householdMember.userId, partnerId)),
    ).toHaveLength(1);
  });

  it("immediately denies household reads and writes after removal and retains shared meals", async () => {
    const scope = await create();
    await join(scope);
    const meal = recipeMeal();
    await owner.planner.save({ scope, revision: 0, meal });
    const id = randomUUID();
    await partner.shopping.addItem({ scope, id, text: "Milk" });
    await expect(
      partner.households.rename({ ...scope, name: "Changed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.households.removeMember({ ...scope, userId: partnerId });
    for (const operation of [
      () => partner.planner.get(scope),
      () => partner.planner.save({ scope, revision: 1, meal }),
      () => partner.planner.remove({ scope, id: meal.id, revision: 1 }),
      () => partner.planner.preview({ scope, coverage, replace: false }),
      () =>
        partner.planner.applyTrip({
          scope,
          coverage,
          replace: false,
          token: "a".repeat(64),
        }),
      () => partner.shopping.list(scope),
      () => partner.shopping.generated(scope),
      () => partner.shopping.generate(scope),
      () => partner.shopping.addItem({ scope, id: randomUUID(), text: "No" }),
      () => partner.shopping.addRecipes({ scope, recipeIds: [recipeId] }),
      () =>
        partner.shopping.updateItem({
          scope,
          id,
          kind: "status",
          status: "bought",
        }),
      () => partner.shopping.removeItem({ scope, id }),
      () => partner.shopping.clear({ planningScope: scope, scope: "all" }),
      () =>
        partner.households.copyMealsToPersonal({
          ...scope,
          from: coverage.start,
        }),
    ])
      await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await partner.households.current()).toBeNull();
    expect((await owner.planner.get(scope)).meals).toHaveLength(1);
    expect(await owner.shopping.list(scope)).toHaveLength(1);
  });

  it("copies meals on leaving without duplicates or overwriting personal changes", async () => {
    const scope = await create();
    await join(scope);
    const meal = recipeMeal();
    await owner.planner.save({ scope, revision: 0, meal });
    await owner.planner.save({
      scope,
      revision: 1,
      meal: {
        id: randomUUID(),
        kind: "leftovers",
        sourceId: meal.id,
        portions: 2,
        date: "2026-10-23",
        slot: "Lunch",
      },
    });
    expect(
      await partner.households.copyMealsToPersonal({
        ...scope,
        from: coverage.start,
      }),
    ).toEqual({ copied: 2 });
    const personal = await partner.planner.get();
    const copied = personal.meals.find((entry) => entry.kind === "recipe");
    if (!copied) throw new Error("Missing copied meal");
    await partner.planner.save({
      revision: personal.revision,
      meal: { ...copied, slot: "Lunch" },
    });
    await partner.households.removeMember({
      ...scope,
      userId: partnerId,
      copyUpcomingFrom: coverage.start,
    });
    const retained = await partner.planner.get();
    expect(retained.meals).toHaveLength(2);
    expect(retained.meals.find((entry) => entry.id === copied.id)?.slot).toBe(
      "Lunch",
    );
    expect(retained.issues).toEqual([]);
    expect((await owner.planner.get(scope)).meals).toHaveLength(2);
  });

  it("requires ownership transfer before leaving and explicit deletion preserves personal data and collections", async () => {
    const scope = await create();
    await join(scope);
    await owner.shopping.addItem({ id: randomUUID(), text: "Personal milk" });
    await owner.shopping.addItem({
      scope,
      id: randomUUID(),
      text: "Shared milk",
    });
    await expect(
      owner.households.removeMember({ ...scope, userId: ownerId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.households.transferOwnership({ ...scope, userId: partnerId });
    await expect(
      owner.households.delete({ ...scope, name: "Home" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      partner.households.delete({ ...scope, name: "Wrong" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await partner.households.delete({ ...scope, name: "Home" });
    expect(await owner.households.current()).toBeNull();
    expect(await owner.shopping.list()).toHaveLength(1);
    expect(await owner.groups.list()).toHaveLength(1);
    expect(
      await db
        .select()
        .from(shoppingItem)
        .where(eq(shoppingItem.householdId, scope.householdId)),
    ).toEqual([]);
  });
  it("blocks account deletion for household owners and keeps shared meals after a former owner's account is deleted", async () => {
    const id = randomUUID();
    const householdId = randomUUID();
    await db.insert(user).values({
      id,
      name: "Deletion household fixture",
      email: `${id}@example.test`,
    });
    try {
      await db
        .insert(household)
        .values({ id: householdId, name: "Deletion fixture", ownerId: id });
      await db.insert(householdMember).values([
        { userId: id, householdId },
        { userId: partnerId, householdId },
      ]);
      const actor = caller(id);
      await actor.planner.save({
        scope: { kind: "household", householdId },
        revision: 0,
        meal: {
          id: randomUUID(),
          date: coverage.start,
          slot: "Dinner",
          kind: "out",
          description: "Shared dinner",
        },
      });
      await actor.support.requestDeletion({ confirmation: "DELETE" });
      const deletion = await actor.support.deletion();
      expect(deletion.ownedHouseholds).toEqual([
        { id: householdId, name: "Deletion fixture" },
      ]);
      if (!deletion.request) throw new Error("Missing deletion request");
      await expect(
        completeAccountDeletion(deletion.request.id),
      ).rejects.toThrow("still owns a household");
      await actor.households.transferOwnership({
        householdId,
        userId: partnerId,
      });
      await completeAccountDeletion(deletion.request.id);
      expect(
        (await partner.planner.get({ kind: "household", householdId })).meals,
      ).toHaveLength(1);
      expect((await partner.households.current())?.members).toHaveLength(1);
    } finally {
      await db.delete(household).where(eq(household.id, householdId));
      await db.delete(user).where(eq(user.id, id));
    }
  });
});
