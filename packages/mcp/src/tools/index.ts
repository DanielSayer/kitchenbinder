import { getAccountOverview } from "./account";
import { getMealPlan, planMeal, removePlannedMeal } from "./meal-plan";
import { createRecipe, getRecipe, searchRecipes } from "./recipes";
import {
  addRecipeToShoppingList,
  addShoppingItems,
  checkOffShoppingItem,
  getShoppingList,
} from "./shopping";
import type { Tool } from "./tool";

export { invokeTool } from "./invoke";
export { ToolError } from "./result";
export type { Tool, ToolContext, ToolOutput } from "./tool";

/** Every tool the server exposes. Add new tools here. */
export const tools: readonly Tool[] = [
  getAccountOverview,
  searchRecipes,
  getRecipe,
  createRecipe,
  getMealPlan,
  planMeal,
  removePlannedMeal,
  getShoppingList,
  addShoppingItems,
  checkOffShoppingItem,
  addRecipeToShoppingList,
];
