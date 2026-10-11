import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { tripIsStale } from "@prep-sheet/db/meal-planner";
import { user } from "@prep-sheet/db/schema/auth";
import { mealPlanner } from "@prep-sheet/db/schema/meal-planner";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { shoppingItem, shoppingPlan } from "@prep-sheet/db/schema/shopping";
import { generateShoppingPlan } from "@prep-sheet/db/shopping-plan";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { accessibleRecipe, type Database } from "../groups/access";
import { protectedProcedure, router } from "../index";
import { pickerInput, pickerRecipe, shoppingRecipePage } from "../recipes/list";

const itemText = z.string().trim().min(1).max(2000);
const itemId = z.object({ id: z.uuid() });
async function lockList(tx: Database, userId: string) {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update");
}
function checkCapacity(count: number) {
  if (count > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Your list can hold up to 1,000 items. Clear some items before adding more.",
    });
}
async function requireCurrentMeals(tx: Database, userId: string) {
  const [planner] = await tx
    .select()
    .from(mealPlanner)
    .where(eq(mealPlanner.userId, userId));
  if (planner?.trip && tripIsStale(planner.meals, planner.trip))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your meals have changed. Review meal-plan changes before updating or checking off this trip.",
    });
}

export const shoppingRouter = router({
  generate: protectedProcedure.mutation(({ ctx }) =>
    db.transaction(async (tx) => {
      const userId = ctx.session.user.id;
      await lockList(tx, userId);
      await requireCurrentMeals(tx, userId);
      const items = await tx
        .select()
        .from(shoppingItem)
        .where(
          and(
            eq(shoppingItem.userId, userId),
            eq(shoppingItem.status, "needed"),
          ),
        )
        .for("update");
      if (!items.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add some items you still need before generating a list.",
        });
      const saved = {
        id: randomUUID(),
        userId,
        content: generateShoppingPlan(items),
        sources: items.map(({ id, text }) => ({ id, text })),
        generatedAt: new Date(),
      };
      await tx
        .insert(shoppingPlan)
        .values(saved)
        .onConflictDoUpdate({ target: shoppingPlan.userId, set: saved });
      return { id: saved.id };
    }),
  ),
  generated: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [plan] = await db
      .select()
      .from(shoppingPlan)
      .where(eq(shoppingPlan.userId, userId));
    if (!plan) return null;
    const items = await db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.userId, userId));
    const current = new Map(items.map((item) => [item.id, item]));
    const sources = new Set(plan.sources.map((item) => item.id));
    const stale =
      plan.sources.some((source) => {
        const item = current.get(source.id);
        return !item || item.text !== source.text || item.status === "owned";
      }) ||
      items.some((item) => item.status === "needed" && !sources.has(item.id));
    return { ...plan, items, stale };
  }),
  checkGroup: protectedProcedure
    .input(
      z.object({
        planId: z.uuid(),
        groupIndex: z.number().int().min(0),
        bought: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await lockList(tx, userId);
        await requireCurrentMeals(tx, userId);
        const [plan] = await tx
          .select()
          .from(shoppingPlan)
          .where(
            and(
              eq(shoppingPlan.userId, userId),
              eq(shoppingPlan.id, input.planId),
            ),
          );
        const selected = plan?.content.groups[input.groupIndex];
        if (!plan || !selected)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This generated list has changed. Refresh the page to continue.",
          });
        const items = await tx
          .select()
          .from(shoppingItem)
          .where(eq(shoppingItem.userId, userId))
          .for("update");
        const current = new Map(items.map((item) => [item.id, item]));
        const sourceIds = new Set(plan.sources.map((source) => source.id));
        if (
          plan.sources.some(
            (source) =>
              current.get(source.id)?.text !== source.text ||
              current.get(source.id)?.status === "owned",
          ) ||
          items.some(
            (item) => item.status === "needed" && !sourceIds.has(item.id),
          )
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Your ingredients have changed. Generate the list again before checking off items.",
          });
        }
        await tx
          .update(shoppingItem)
          .set({ status: input.bought ? "bought" : "needed" })
          .where(
            and(
              eq(shoppingItem.userId, userId),
              inArray(shoppingItem.id, selected.itemIds),
            ),
          );
      }),
    ),
  list: protectedProcedure.query(async ({ ctx }) => {
    const [planner] = await db
      .select()
      .from(mealPlanner)
      .where(eq(mealPlanner.userId, ctx.session.user.id));
    const plannedSources = new Map(
      planner?.trip?.allocations.map((allocation) => [
        allocation.itemId,
        allocation.key.split(":")[0] ?? null,
      ]),
    );
    const items = await db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.userId, ctx.session.user.id))
      .orderBy(
        asc(shoppingItem.createdAt),
        asc(shoppingItem.recipeId),
        asc(shoppingItem.position),
        asc(shoppingItem.id),
      );
    return items.map((item) => ({
      ...item,
      plannedMealId: plannedSources.get(item.id) ?? null,
    }));
  }),
  recipes: protectedProcedure
    .input(pickerInput)
    .query(({ ctx, input }) => shoppingRecipePage(ctx.session.user.id, input)),
  recipe: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) => pickerRecipe(ctx.session.user.id, input.id)),
  addRecipes: protectedProcedure
    .input(z.object({ recipeIds: z.array(z.uuid()).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await lockList(tx, userId);
        const ids = [...new Set(input.recipeIds)];
        const sources = await tx
          .select()
          .from(recipe)
          .where(and(inArray(recipe.id, ids), accessibleRecipe(userId)));
        if (sources.length !== ids.length)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "A selected recipe is no longer available. Review your selection and try again.",
          });
        const existing = await tx
          .select()
          .from(shoppingItem)
          .where(eq(shoppingItem.userId, userId));
        const alreadyAdded = new Set(existing.map((item) => item.recipeId));
        const additions = sources.filter(
          (source) => !alreadyAdded.has(source.id),
        );
        const items = additions.flatMap((source) =>
          source.content.ingredients.map((text, position) => ({
            id: randomUUID(),
            userId,
            text,
            recipeId: source.id,
            recipeTitle: source.title,
            servings: source.content.servings,
            position,
          })),
        );
        checkCapacity(existing.length + items.length);
        if (items.length) await tx.insert(shoppingItem).values(items);
        return { addedRecipes: additions.length, addedItems: items.length };
      }),
    ),
  addItem: protectedProcedure
    .input(itemId.extend({ text: itemText }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        await lockList(tx, userId);
        const existing = await tx
          .select({ id: shoppingItem.id })
          .from(shoppingItem)
          .where(eq(shoppingItem.userId, userId));
        if (existing.some((item) => item.id === input.id)) return;
        checkCapacity(existing.length + 1);
        await tx.insert(shoppingItem).values({ ...input, userId });
      }),
    ),
  updateItem: protectedProcedure
    .input(
      z.discriminatedUnion("kind", [
        itemId.extend({ kind: z.literal("text"), text: itemText }),
        itemId.extend({
          kind: z.literal("status"),
          status: z.enum(["needed", "bought", "owned"]),
        }),
      ]),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockList(tx, ctx.session.user.id);
        const updated = await tx
          .update(shoppingItem)
          .set(
            input.kind === "text"
              ? { text: input.text }
              : { status: input.status },
          )
          .where(
            and(
              eq(shoppingItem.id, input.id),
              eq(shoppingItem.userId, ctx.session.user.id),
            ),
          )
          .returning({ id: shoppingItem.id });
        if (!updated.length)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "This item is no longer on your list. Refresh the list to continue.",
          });
      }),
    ),
  removeItem: protectedProcedure.input(itemId).mutation(({ ctx, input }) =>
    db.transaction(async (tx) => {
      await lockList(tx, ctx.session.user.id);
      await tx
        .delete(shoppingItem)
        .where(
          and(
            eq(shoppingItem.id, input.id),
            eq(shoppingItem.userId, ctx.session.user.id),
          ),
        );
    }),
  ),
  clear: protectedProcedure
    .input(z.object({ scope: z.enum(["bought", "all"]) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        await lockList(tx, ctx.session.user.id);
        const removed = await tx
          .delete(shoppingItem)
          .where(
            and(
              eq(shoppingItem.userId, ctx.session.user.id),
              input.scope === "bought"
                ? eq(shoppingItem.status, "bought")
                : undefined,
            ),
          )
          .returning({ id: shoppingItem.id });
        if (input.scope === "bought") {
          const [planner] = await tx
            .select()
            .from(mealPlanner)
            .where(eq(mealPlanner.userId, ctx.session.user.id));
          if (planner?.trip) {
            const removedIds = new Set(removed.map((item) => item.id));
            await tx
              .update(mealPlanner)
              .set({
                trip: {
                  ...planner.trip,
                  allocations: planner.trip.allocations.map((allocation) =>
                    removedIds.has(allocation.itemId)
                      ? { ...allocation, clearedBought: true }
                      : allocation,
                  ),
                },
              })
              .where(eq(mealPlanner.userId, ctx.session.user.id));
          }
        }
        if (input.scope === "all") {
          await tx
            .delete(shoppingPlan)
            .where(eq(shoppingPlan.userId, ctx.session.user.id));
          await tx
            .update(mealPlanner)
            .set({ trip: null })
            .where(eq(mealPlanner.userId, ctx.session.user.id));
        }
      }),
    ),
});
