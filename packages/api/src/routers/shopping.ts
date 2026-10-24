import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { tripIsStale } from "@prep-sheet/db/meal-planner";
import { mealPlanner } from "@prep-sheet/db/schema/meal-planner";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { shoppingItem, shoppingPlan } from "@prep-sheet/db/schema/shopping";
import { generateShoppingPlan } from "@prep-sheet/db/shopping-plan";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accessibleRecipe,
  type Database,
  resolveHousehold,
} from "../households/access";
import { protectedProcedure, router } from "../index";
import { pickerInput, pickerRecipe, shoppingRecipePage } from "../recipes/list";

const itemText = z.string().trim().min(1).max(2000);
// Omitted householdId = the caller's personal household.
const householdInput = { householdId: z.uuid().optional() };
const householdOnly = z.object(householdInput).prefault({});
const itemId = z.object({ ...householdInput, id: z.uuid() });
// Verifies membership and serializes writes to this household's list.
function lockList(tx: Database, userId: string, householdId?: string) {
  return resolveHousehold(tx, userId, householdId, { lock: true });
}
function checkCapacity(count: number) {
  if (count > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Your list can hold up to 1,000 items. Clear some items before adding more.",
    });
}
async function requireCurrentMeals(tx: Database, householdId: string) {
  const [planner] = await tx
    .select()
    .from(mealPlanner)
    .where(eq(mealPlanner.householdId, householdId));
  if (planner?.trip && tripIsStale(planner.meals, planner.trip))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your meals have changed. Review meal-plan changes before updating or checking off this trip.",
    });
}

export const shoppingRouter = router({
  generate: protectedProcedure.input(householdOnly).mutation(({ ctx, input }) =>
    db.transaction(async (tx) => {
      const userId = ctx.session.user.id;
      const householdId = await lockList(tx, userId, input.householdId);
      await requireCurrentMeals(tx, householdId);
      const items = await tx
        .select()
        .from(shoppingItem)
        .where(
          and(
            eq(shoppingItem.householdId, householdId),
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
        householdId,
        content: generateShoppingPlan(items),
        sources: items.map(({ id, text }) => ({ id, text })),
        generatedAt: new Date(),
      };
      await tx
        .insert(shoppingPlan)
        .values(saved)
        .onConflictDoUpdate({ target: shoppingPlan.householdId, set: saved });
      return { id: saved.id };
    }),
  ),
  generated: protectedProcedure
    .input(householdOnly)
    .query(async ({ ctx, input }) => {
      const householdId = await resolveHousehold(
        db,
        ctx.session.user.id,
        input.householdId,
      );
      const [plan] = await db
        .select()
        .from(shoppingPlan)
        .where(eq(shoppingPlan.householdId, householdId));
      if (!plan) return null;
      const items = await db
        .select()
        .from(shoppingItem)
        .where(eq(shoppingItem.householdId, householdId));
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
        ...householdInput,
        planId: z.uuid(),
        groupIndex: z.number().int().min(0),
        bought: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        const householdId = await lockList(tx, userId, input.householdId);
        await requireCurrentMeals(tx, householdId);
        const [plan] = await tx
          .select()
          .from(shoppingPlan)
          .where(
            and(
              eq(shoppingPlan.householdId, householdId),
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
          .where(eq(shoppingItem.householdId, householdId))
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
              eq(shoppingItem.householdId, householdId),
              inArray(shoppingItem.id, selected.itemIds),
            ),
          );
      }),
    ),
  list: protectedProcedure
    .input(householdOnly)
    .query(async ({ ctx, input }) => {
      const householdId = await resolveHousehold(
        db,
        ctx.session.user.id,
        input.householdId,
      );
      const [planner] = await db
        .select()
        .from(mealPlanner)
        .where(eq(mealPlanner.householdId, householdId));
      const plannedSources = new Map(
        planner?.trip?.allocations.map((allocation) => [
          allocation.itemId,
          allocation.key.split(":")[0] ?? null,
        ]),
      );
      const items = await db
        .select()
        .from(shoppingItem)
        .where(eq(shoppingItem.householdId, householdId))
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
    .input(
      z.object({
        ...householdInput,
        recipeIds: z.array(z.uuid()).min(1).max(100),
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        const householdId = await lockList(tx, userId, input.householdId);
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
          .where(eq(shoppingItem.householdId, householdId));
        const alreadyAdded = new Set(existing.map((item) => item.recipeId));
        const additions = sources.filter(
          (source) => !alreadyAdded.has(source.id),
        );
        const items = additions.flatMap((source) =>
          source.content.ingredients.map((text, position) => ({
            id: randomUUID(),
            householdId,
            addedBy: userId,
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
        const householdId = await lockList(tx, userId, input.householdId);
        const existing = await tx
          .select({
            id: shoppingItem.id,
            householdId: shoppingItem.householdId,
          })
          .from(shoppingItem)
          .where(eq(shoppingItem.id, input.id));
        if (existing.some((item) => item.householdId === householdId)) return;
        if (existing.length)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This item ID has already been used.",
          });
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(shoppingItem)
          .where(eq(shoppingItem.householdId, householdId));
        checkCapacity((count?.total ?? 0) + 1);
        await tx.insert(shoppingItem).values({
          id: input.id,
          text: input.text,
          householdId,
          addedBy: userId,
        });
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
        const householdId = await lockList(
          tx,
          ctx.session.user.id,
          input.householdId,
        );
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
              eq(shoppingItem.householdId, householdId),
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
      const householdId = await lockList(
        tx,
        ctx.session.user.id,
        input.householdId,
      );
      await tx
        .delete(shoppingItem)
        .where(
          and(
            eq(shoppingItem.id, input.id),
            eq(shoppingItem.householdId, householdId),
          ),
        );
    }),
  ),
  clear: protectedProcedure
    .input(z.object({ ...householdInput, scope: z.enum(["bought", "all"]) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const householdId = await lockList(
          tx,
          ctx.session.user.id,
          input.householdId,
        );
        const removed = await tx
          .delete(shoppingItem)
          .where(
            and(
              eq(shoppingItem.householdId, householdId),
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
            .where(eq(mealPlanner.householdId, householdId));
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
              .where(eq(mealPlanner.householdId, householdId));
          }
        }
        if (input.scope === "all") {
          await tx
            .delete(shoppingPlan)
            .where(eq(shoppingPlan.householdId, householdId));
          await tx
            .update(mealPlanner)
            .set({ trip: null })
            .where(eq(mealPlanner.householdId, householdId));
        }
      }),
    ),
});
