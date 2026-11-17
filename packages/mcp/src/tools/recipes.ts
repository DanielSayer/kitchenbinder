import { randomUUID } from "node:crypto";
import { z } from "zod";
import { householdScope, retryId, textLines } from "./schemas";
import { behaviour, defineTool } from "./tool";

export const searchRecipes = defineTool({
  name: "search_recipes",
  description:
    "Search titles across all recipes you can access, including shared recipes. Returns a small page with recipe IDs, names and serving/time details. Use get_recipe for ingredients and steps. Page numbers start at zero.",
  input: z.object({
    query: z.string().max(2000).default(""),
    page: z.number().int().min(0).max(1_000_000).default(0),
    pageSize: z.number().int().min(1).max(48).default(12),
  }),
  annotations: behaviour.read,
  async run({ query, page, pageSize }, { api }) {
    const found = await api.recipes.list({ search: query, page, pageSize });
    return {
      summary: `${found.total} recipe(s) found. Showing ${found.items.length}.`,
      data: found,
    };
  },
});

export const getRecipe = defineTool({
  name: "get_recipe",
  description:
    "Read an accessible recipe by its ID, including the original ingredient lines and method. This never runs recipe generation or uses AI credits.",
  input: z.object({ recipeId: z.uuid() }),
  annotations: behaviour.read,
  async run({ recipeId }, { api }) {
    const recipe = await api.recipes.get({ id: recipeId });
    const { ingredients, steps } = recipe.content;
    return {
      summary: `${recipe.title}: ${ingredients.length} ingredient lines, ${steps.length} steps.`,
      data: {
        id: recipe.id,
        ...recipe.content,
        sourceUrl: recipe.sourceUrl,
        ingredientData: recipe.ingredientData,
      },
    };
  },
});

const webUrl = z
  .url()
  .max(2000)
  .refine((url) => ["http:", "https:"].includes(new URL(url).protocol));

export const createRecipe = defineTool({
  name: "create_recipe",
  description:
    "Save a recipe written by your model or supplied by the user. Provide original ingredient text lines and method steps; never supply parsed unit objects. Uses the existing manual recipe pipeline and no Kitchenbinder AI credits. sourceUrl is retained in notes. A shared household makes the saved recipe visible there. Reuse recipeId for an identical retry; changed submissions require a new ID.",
  input: z.object({
    ...householdScope,
    recipeId: retryId(
      "Reuse for an identical retry. Use a new ID for a different recipe.",
    ),
    title: z.string().trim().min(1).max(160),
    servings: z.string().max(80).nullable().default(null),
    ingredients: textLines,
    steps: textLines,
    notes: z.string().max(2000).default(""),
    sourceUrl: webUrl.optional(),
  }),
  annotations: behaviour.create,
  async run(
    { householdId, recipeId = randomUUID(), sourceUrl, notes, ...content },
    { api },
  ) {
    // createManual has no structured source field, so keep it in the notes.
    const allNotes = [notes, sourceUrl && `Source: ${sourceUrl}`]
      .filter(Boolean)
      .join("\n\n");
    const saved = await api.recipes.createManual({
      id: recipeId,
      householdId,
      content: {
        ...content,
        notes: allNotes,
        description: "",
        prepMinutes: null,
        cookMinutes: null,
        totalMinutes: null,
      },
    });
    return {
      summary: `Saved '${saved.title}'. No AI credits used.`,
      data: {
        id: saved.id,
        title: saved.title,
        ingredients: saved.content.ingredients,
        ingredientData: saved.ingredientData,
      },
    };
  },
});
