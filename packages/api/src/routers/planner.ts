import { db } from "@prep-sheet/db";
import {
  coverageInput,
  type Meal,
  mealInput,
  mealIssues,
} from "@prep-sheet/db/meal-planner";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import { and, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { resolveHousehold } from "../households/access";
import { protectedProcedure, router } from "../index";
import { addMeal, addMealInput } from "../planner/add-meal";
import {
  conflict,
  recipeSnapshot,
  saveState,
  state,
  withMeal,
} from "../planner/state";
import { mealSuggestions, suggestionsInput } from "../recipes/suggestions";
import { applyTrip, previewTrip, tripIsStale } from "../shopping/trip";

// Omitted householdId = the caller's personal household.
const householdInput = { householdId: z.uuid().optional() };
const tripInput = z.object({
  ...householdInput,
  coverage: coverageInput,
});
export const plannerRouter = router({
  get: protectedProcedure
    .input(z.object(householdInput).prefault({}))
    .query(async ({ ctx, input }) => {
      const householdId = await resolveHousehold(
        db,
        ctx.session.user.id,
        input.householdId,
      );
      const saved = await state(db, householdId);
      // Meals are snapshots; covers come from the live recipe.
      const recipeIds = [
        ...new Set(
          saved.meals.flatMap((meal) =>
            meal.kind === "recipe" ? [meal.recipeId] : [],
          ),
        ),
      ];
      const covers = recipeIds.length
        ? await db
            .select({ id: recipe.id, photo: recipe.photo })
            .from(recipe)
            .where(
              and(
                inArray(recipe.id, recipeIds),
                isNull(recipe.deletedAt),
                isNotNull(recipe.photo),
              ),
            )
        : [];
      return {
        ...saved,
        // Line parses are for trips only; callers read the text.
        meals: saved.meals.map((meal) => {
          if (meal.kind !== "recipe") return meal;
          const { ingredientData: _, ...rest } = meal;
          return rest;
        }),
        photos: Object.fromEntries(
          covers.flatMap(({ id, photo }) => (photo ? [[id, photo]] : [])),
        ),
        issues: mealIssues(saved.meals),
        stale: tripIsStale(saved.meals, saved.trip),
      };
    }),
  suggestions: protectedProcedure
    .input(suggestionsInput)
    .query(async ({ ctx, input }) => {
      const householdId = await resolveHousehold(
        db,
        ctx.session.user.id,
        input.householdId,
      );
      const saved = await state(db, householdId);
      return mealSuggestions(
        db,
        ctx.session.user.id,
        householdId,
        saved.meals,
        input,
      );
    }),
  save: protectedProcedure
    .input(
      z.object({
        ...householdInput,
        revision: z.number().int().min(0),
        meal: mealInput,
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        const householdId = await resolveHousehold(
          tx,
          userId,
          input.householdId,
          { lock: true },
        );
        const saved = await state(tx, householdId);
        if (saved.revision !== input.revision) throw conflict();
        const old = saved.meals.find((meal) => meal.id === input.meal.id);
        let meal: Meal;
        if (input.meal.kind === "recipe") {
          if (old?.kind === "recipe" && old.recipeId === input.meal.recipeId)
            meal = {
              ...input.meal,
              title: old.title,
              ingredients: old.ingredients,
              ...(old.ingredientData && {
                ingredientData: old.ingredientData,
              }),
            };
          else
            meal = {
              ...input.meal,
              ...(await recipeSnapshot(tx, userId, input.meal.recipeId))
                .snapshot,
            };
        } else {
          meal = input.meal;
          if (meal.kind === "leftovers") {
            const sourceId = meal.sourceId;
            const source = saved.meals.find(
              (entry) => entry.id === sourceId && entry.kind === "recipe",
            );
            if (!source)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Choose an existing cooking session for these leftovers.",
              });
          }
        }
        const meals = withMeal(saved.meals, meal);
        await saveState(tx, { ...saved, meals, revision: saved.revision + 1 });
      }),
    ),
  addMeal: protectedProcedure
    .input(addMealInput)
    .mutation(({ ctx, input }) =>
      db.transaction((tx) => addMeal(tx, ctx.session.user.id, input)),
    ),
  remove: protectedProcedure
    .input(
      z.object({
        ...householdInput,
        id: z.uuid(),
        revision: z.number().int().min(0),
      }),
    )
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const householdId = await resolveHousehold(
          tx,
          ctx.session.user.id,
          input.householdId,
          { lock: true },
        );
        const saved = await state(tx, householdId);
        if (saved.revision !== input.revision) throw conflict();
        await saveState(tx, {
          ...saved,
          revision: saved.revision + 1,
          meals: saved.meals.filter((meal) => meal.id !== input.id),
        });
      }),
    ),
  preview: protectedProcedure.input(tripInput).query(async ({ ctx, input }) => {
    const householdId = await resolveHousehold(
      db,
      ctx.session.user.id,
      input.householdId,
    );
    return previewTrip(db, householdId, ctx.session.user.id, input.coverage);
  }),
  applyTrip: protectedProcedure
    .input(tripInput.extend({ token: z.string().length(64) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (tx) => {
        const userId = ctx.session.user.id;
        const householdId = await resolveHousehold(
          tx,
          userId,
          input.householdId,
          { lock: true },
        );
        await applyTrip(tx, householdId, userId, input);
      }),
    ),
});
