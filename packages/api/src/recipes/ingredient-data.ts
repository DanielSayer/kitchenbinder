import {
  type Ingredient,
  type IngredientLine,
  ingredientSchema,
  isIngredientHeading,
  needsAiParse,
  normaliseItem,
  parseIngredient,
  parseIngredientLines,
  unitIds,
} from "@prep-sheet/db/ingredients";
import { z } from "zod";

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

/** Whether a recipe line is a heading such as "For the sauce:". */
export function isHeadingLine(
  text: string,
  lines: readonly IngredientLine[] | null,
) {
  const line = lines?.find((candidate) => candidate.text === text);
  return line ? line.heading : isIngredientHeading(text);
}

/** The parsed form of one recipe line, for a shopping list copy. */
export function ingredientFor(
  text: string,
  lines: readonly IngredientLine[] | null,
): Ingredient | null {
  const line = lines?.find((candidate) => candidate.text === text);
  return line ? line.parsed : parseIngredient(text);
}

// Loose shape for the model; results are checked against ingredientSchema.
export const aiIngredientSchema = z.object({
  heading: z.boolean(),
  quantity: z.number().nullable(),
  quantityMax: z.number().nullable(),
  unit: z.enum(unitIds).nullable(),
  sizeQuantity: z.number().nullable(),
  sizeUnit: z.enum(unitIds).nullable(),
  item: z.string(),
  detail: z.string().nullable(),
  optional: z.boolean(),
});
export type AiIngredient = z.infer<typeof aiIngredientSchema>;

export const ingredientPromptRules = `For each ingredient line, in the same order and with the same count, return its structure. Headings such as "For the sauce:" have heading true. quantity is the number to buy or use (½ = 0.5); quantityMax is the upper end of a range ("2-3"), otherwise null. unit is one of the listed units or null for a plain count such as "2 eggs"; a unit written after the item, as in "3 garlic cloves", is still the unit. For a package with a stated size, such as "2 x 400 g tins tomatoes", set quantity 2, unit tin, sizeQuantity 400 and sizeUnit g. item is the singular, lowercase thing to buy, without preparation, size or brand: "3 cloves of garlic, crushed" has item garlic; "1 large red onion, finely diced" has item red onion. Keep words that change what is bought: tinned, dried, frozen, smoked, ground, plain, self-raising. detail holds preparation, size and notes such as "finely diced, large", or null. optional is true for optional, to taste, to serve or garnish lines. For alternatives ("1 onion or 2 shallots") use the first option and put the rest in detail. Never invent a quantity the line does not state; use null instead.`;

const statedAmount =
  /[\d¼½¾⅓⅔⅛⅜⅝⅞]|\b(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|dozen|couple|pinch|dash|handful|splash)\b/i;

function aiLine(text: string, value: AiIngredient | undefined): IngredientLine {
  if (!value) return parseIngredientLines([text])[0] as IngredientLine;
  if (value.heading) return { text, heading: true, parsed: null, source: "ai" };
  const parsed = ingredientSchema.safeParse({
    quantity: value.quantity,
    quantityMax: value.quantityMax,
    unit: value.unit,
    size:
      value.sizeQuantity !== null && value.sizeUnit !== null
        ? { quantity: value.sizeQuantity, unit: value.sizeUnit }
        : null,
    item: value.item.toLowerCase(),
    detail: value.detail?.trim() || null,
    optional: value.optional,
  });
  // A quantity the line never states is a guess; let the code parser decide.
  if (
    !parsed.success ||
    (parsed.data.quantity !== null && !statedAmount.test(text)) ||
    (parsed.data.quantityMax !== null &&
      !(parsed.data.quantityMax > (parsed.data.quantity ?? 0)))
  )
    return parseIngredientLines([text])[0] as IngredientLine;
  return {
    text,
    heading: false,
    parsed: { ...parsed.data, item: normaliseItem(parsed.data.item) },
    source: "ai",
  };
}

/** Lines for a recipe from the model's output, matched by position. */
export function aiIngredientLines(
  texts: readonly string[],
  values: readonly AiIngredient[],
): IngredientLine[] {
  // A different count means the lines can't be matched up reliably.
  const matched = values.length === texts.length;
  return texts.map((text, index) =>
    aiLine(text, matched ? values[index] : undefined),
  );
}
