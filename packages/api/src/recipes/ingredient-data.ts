import {
  type Ingredient,
  type IngredientLine,
  needsAiParse,
  parseIngredient,
  parseIngredientLines,
} from "@prep-sheet/db/ingredients";

/**
 * Recipe columns for its ingredient lines. Unchanged lines keep their earlier
 * result; new lines are code-parsed, and any it can't read wait for the AI.
 */
export function ingredientColumns(
  texts: readonly string[],
  previous: readonly IngredientLine[] | null = null,
) {
  const ingredientData = parseIngredientLines(texts, previous);
  return {
    ingredientData,
    ingredientsPendingAt: needsAiParse(ingredientData) ? new Date() : null,
  };
}

/** The parsed form of one recipe line, for a shopping list copy. */
export function ingredientFor(
  text: string,
  lines: readonly IngredientLine[] | null,
): Ingredient | null {
  const line = lines?.find((candidate) => candidate.text === text);
  return line ? line.parsed : parseIngredient(text);
}
