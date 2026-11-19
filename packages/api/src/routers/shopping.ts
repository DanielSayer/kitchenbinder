import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { ingredientLines } from "@prep-sheet/db/ingredient-line";
import { parseIngredient } from "@prep-sheet/db/ingredients";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { shoppingItem } from "@prep-sheet/db/schema/shopping";
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
import {
  aisleList,
  checkAisleGroup,
  checkCapacity,
  clearList,
  generateAisleList,
  plannedMeals,
  removeListItem,
} from "../shopping/trip";

const itemText = z.string().trim().min(1).max(2000);
// Omitted householdId = the caller's personal household.
const householdInput = { householdId: z.uuid().optional() };
const householdOnly = z.object(householdInput).prefault({});
const itemId = z.object({ ...householdInput, id: z.uuid() });
// Verifies membership and serializes writes to this household's list.
function lockList(tx: Database, userId: string, householdId?: string) {
  return resolveHousehold(tx, userId, householdId, { lock: true });
}
export const shoppingRouter = router({
  generate: protectedProcedure.input(householdOnly).mutation(({ ctx, input }) =>
    db.transaction(async (tx) => {
      const userId = ctx.session.user.id;
      const householdId = await lockList(tx, userId, input.householdId);
      return generateAisleList(tx, householdId);
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
      return aisleList(db, householdId);
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
        await checkAisleGroup(tx, householdId, input);
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
      const plannedSources = await plannedMeals(db, householdId);
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
          ingredientLines(
            source.content.ingredients,
            source.ingredientData,
          ).flatMap((line, position) =>
            line.heading
              ? []
              : [
                  {
                    id: randomUUID(),
                    householdId,
                    addedBy: userId,
                    text: line.text,
                    ingredient: line.parsed,
                    recipeId: source.id,
                    recipeTitle: source.title,
                    servings: source.content.servings,
                    position,
                  },
                ],
          ),
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
          ingredient: parseIngredient(input.text),
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
              ? { text: input.text, ingredient: parseIngredient(input.text) }
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
      await removeListItem(tx, householdId, input.id);
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
        await clearList(tx, householdId, input.scope);
      }),
    ),
});
