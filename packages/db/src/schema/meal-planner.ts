import { integer, jsonb, pgTable, uuid } from "drizzle-orm/pg-core";
import type { Meal, MealTrip } from "../meal-planner";
import { household } from "./household";

export const mealPlanner = pgTable("meal_planner", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  meals: jsonb("meals").$type<Meal[]>().notNull().default([]),
  trip: jsonb("trip").$type<MealTrip>(),
});
