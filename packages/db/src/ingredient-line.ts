// Ingredient lines: one line of a recipe's ingredient list as written, plus
// its parse. This module decides which parse to trust (the recipe's stored
// AI parse, else the code parser), which lines are headings, how a line reads
// at a scale factor and in the user's units, and a recipe's base servings.
// The recipe page, cook mode, shopping list and planner all go through here.

import {
  containers,
  type Ingredient,
  type IngredientLine,
  parseIngredientLines,
  parseQuantity,
  quantityPattern,
  readUnit,
  type Unit,
} from "./ingredients";
import {
  convertAmount,
  dimensionOf,
  formatAmount,
  formatQuantity,
  isMetricUnit,
  type MeasurePreferences,
  preferredAmount,
  unitChoices,
  unitLabel,
} from "./units";

export type { Ingredient, IngredientLine, MeasurePreferences, Unit };

/**
 * Each line with its parse and heading flag: the recipe's stored parse for
 * that text when it has one (usually the AI's), otherwise the code parser's.
 */
export function ingredientLines(
  texts: readonly string[],
  stored?: readonly IngredientLine[] | null,
): IngredientLine[] {
  return parseIngredientLines(texts, stored ?? null);
}

/**
 * A recipe's base servings: its first number, or the lower end of a range.
 * "4-6", "Serves 4" and "4 servings" are 4; "12 cookies" is 12.
 */
export function baseServings(servings: string | null | undefined) {
  const match = servings?.match(/\d+/);
  const value = match ? Number(match[0]) : 0;
  return value > 0 && value <= 1000 ? value : null;
}

const sameFactor = (factor: number) => Math.abs(factor - 1) < 0.000001;

/**
 * A line at a scale factor, for a shopping list: its text as the recipe page
 * shows it and its parse multiplied out. Lines with no readable quantity keep
 * their text with a note to check the amount.
 */
export function scaleLine(
  line: Pick<IngredientLine, "text" | "parsed">,
  factor: number,
): { text: string; ingredient: Ingredient | null; uncertain: boolean } {
  if (sameFactor(factor))
    return { text: line.text, ingredient: line.parsed, uncertain: false };
  const text = scaleText(line.text, factor);
  return {
    text:
      text ??
      `${line.text} [check quantity for ×${Number(factor.toFixed(3))} recipe]`,
    ingredient: line.parsed && scaleParse(line.parsed, factor),
    uncertain: text === null,
  };
}

function scaleParse(ingredient: Ingredient, factor: number): Ingredient {
  return {
    ...ingredient,
    quantity:
      ingredient.quantity === null ? null : ingredient.quantity * factor,
    quantityMax:
      ingredient.quantityMax === null ? null : ingredient.quantityMax * factor,
  };
}

const leading = new RegExp(
  String.raw`^(\s*)(${quantityPattern})(?:(\s*(?:-|–|to)\s*)(${quantityPattern}))?`,
);

/** "400 g tin tomatoes" as "2 x 400 g tins tomatoes", or null for other lines. */
function scalePackages(line: string, factor: number) {
  const match = line.match(leading);
  if (!match?.[2] || match[4] !== undefined) return null;
  const [all, space = ""] = match;
  const gap = line.slice(all.length).match(/^\s*/)?.[0] ?? "";
  const read = readUnit(line.slice(all.length + gap.length));
  if (!read || dimensionOf(read.unit) === "count") return null;
  let end = all.length + gap.length + read.written;
  end += readAlternate(line.slice(end))?.length ?? 0;
  const before = line.slice(end).match(/^\s*/)?.[0] ?? "";
  const container = readUnit(line.slice(end + before.length));
  if (!container || !containers.has(container.unit)) return null;
  const label = unitLabel(container.unit, factor > 1 ? 2 : 1);
  const after = line.slice(end + before.length + container.written);
  return `${space}${formatQuantity(factor)} x ${line.slice(space.length, end)}${before}${label}${after}`;
}

/**
 * Text with its leading quantity ("1 1/2", "½", "2-3", "400g") scaled and the
 * rest as written; a package size is kept and the packages counted. Null when
 * the line has no readable leading quantity.
 */
function scaleText(line: string, factor: number) {
  if (factor === 1) return line;
  const packages = scalePackages(line, factor);
  if (packages) return packages;
  const match = line.match(leading);
  if (!match) return null;
  const [all, space = "", first = "", joiner, second] = match;
  const values = [first, second ?? first].map(parseQuantity);
  if (values.some((value) => !Number.isFinite(value) || value <= 0))
    return null;
  const scaled = (text: string) => formatQuantity(parseQuantity(text) * factor);
  const quantity =
    second !== undefined
      ? `${scaled(first)}${joiner}${scaled(second)}`
      : scaled(first);
  return `${space}${quantity}${line.slice(all.length)}`;
}

/** Split a line into its (possibly scaled) leading quantity and the rest. */
function splitQuantity(line: string, factor = 1) {
  const scaled = scaleText(line, factor) ?? line;
  const match = scaled.match(leading);
  if (!match) return { quantity: "", rest: scaled };
  const after = scaled.slice(match[0].length);
  const times = after.match(/^\s*(?:x\s+)?/i)?.[0] ?? "";
  const unit = readUnit(after.slice(times.length));
  const unitLength = unit ? times.length + unit.written : 0;
  const end = match[0].length + unitLength;
  return { quantity: scaled.slice(0, end).trim(), rest: scaled.slice(end) };
}

// The recipe's own conversion after the amount: "2 cups (500 ml)", "3 lb / 1.5 kg".
const alternatePattern = new RegExp(
  String.raw`^\s*(\(|\/)\s*(${quantityPattern})(?:\s*(?:-|–|to)\s*(${quantityPattern}))?\s*`,
);

function readAlternate(text: string) {
  const match = text.match(alternatePattern);
  if (!match?.[2]) return null;
  const read = readUnit(text.slice(match[0].length));
  if (!read || dimensionOf(read.unit) === "count") return null;
  let length = match[0].length + read.written;
  if (match[1] === "(") {
    const close = text.slice(length).match(/^\s*\)/);
    if (!close) return null;
    length += close[0].length;
  }
  const quantity = parseQuantity(match[2]);
  const quantityMax = match[3] ? parseQuantity(match[3]) : null;
  if (!Number.isFinite(quantity) || Number.isNaN(quantityMax)) return null;
  return { quantity, quantityMax, unit: read.unit, length };
}

export type DisplayedQuantity = {
  quantity: string;
  rest: string;
  /** Units the quantity can switch between, when it can. */
  choices?: { unit: Unit; label: string }[];
  unit?: Unit;
};

const spoons = new Set<Unit>(["tsp", "tbsp"]);

/**
 * A line written in both systems ("14 oz / 400 g can") with only the amount
 * in the user's system, as written. Null for other lines.
 */
function writtenInSystem(line: string, preferences: MeasurePreferences) {
  const match = line.match(leading);
  if (!match?.[2]) return null;
  const gap = line.slice(match[0].length).match(/^\s*/)?.[0] ?? "";
  const read = readUnit(line.slice(match[0].length + gap.length));
  const end = match[0].length + gap.length + (read?.written ?? 0);
  const alternate = readAlternate(line.slice(end));
  if (
    !read ||
    !alternate ||
    dimensionOf(read.unit) === "count" ||
    spoons.has(read.unit) ||
    spoons.has(alternate.unit) ||
    isMetricUnit(read.unit) === isMetricUnit(alternate.unit)
  )
    return null;
  const rest = line.slice(end + alternate.length);
  if (isMetricUnit(read.unit) === (preferences.unitSystem === "metric"))
    return line.slice(0, end) + rest;
  return `${match[1] ?? ""}${formatAmount(alternate)}${rest}`;
}

/**
 * A line at a scale factor, split into its amount and the rest, with the
 * amount in the user's units, or in `unit` when they picked one. Only lines
 * whose written amount matches the parse are converted; the rest show as
 * written.
 */
export function displayQuantity(
  line: string,
  factor: number,
  ingredient: Ingredient | null | undefined,
  preferences: MeasurePreferences,
  unit?: Unit | null,
): DisplayedQuantity {
  const plain = splitQuantity(
    writtenInSystem(line, preferences) ?? line,
    factor,
  );
  const parsed = ingredient;
  if (
    !parsed?.quantity ||
    !parsed.unit ||
    parsed.size ||
    dimensionOf(parsed.unit) === "count"
  )
    return plain;
  const match = line.match(leading);
  const after = match ? line.slice(match[0].length) : "";
  const space = after.match(/^\s*/)?.[0] ?? "";
  const read = readUnit(after.slice(space.length));
  // Scaled text is rounded ("⅓ cup" for 0.4 cup), so compare as written.
  if (
    !match?.[2] ||
    read?.unit !== parsed.unit ||
    formatQuantity(parseQuantity(match[2])) !== formatQuantity(parsed.quantity)
  )
    return plain;
  const amount = {
    quantity: parsed.quantity * factor,
    quantityMax:
      parsed.quantityMax === null ? null : parsed.quantityMax * factor,
    unit: parsed.unit,
  };
  const item = parsed.item;
  const written = after.slice(space.length + read.written);
  const alternate = readAlternate(written);
  const shown = (target: Unit) => {
    // Prefer the recipe's own figure in the target's system over ours.
    if (
      alternate &&
      target !== parsed.unit &&
      isMetricUnit(alternate.unit) === isMetricUnit(target)
    ) {
      const value = convertAmount(
        {
          quantity: alternate.quantity * factor,
          quantityMax:
            alternate.quantityMax === null
              ? null
              : alternate.quantityMax * factor,
          unit: alternate.unit,
        },
        target,
        item,
        preferences.measureStandard,
      );
      if (value) return value;
    }
    return convertAmount(amount, target, item, preferences.measureStandard);
  };
  const preferred = preferredAmount(amount, item, preferences);
  const converted = (unit && shown(unit)) ?? shown(preferred.unit) ?? preferred;
  const choices = unitChoices(
    amount,
    item,
    preferences.measureStandard,
  ).flatMap((choice) => {
    const value = shown(choice);
    return value ? [{ unit: choice, label: formatAmount(value) }] : [];
  });
  if (converted.unit === parsed.unit)
    return {
      ...splitQuantity(line, factor),
      rest: written.slice(alternate?.length ?? 0),
      choices,
      unit: parsed.unit,
    };
  return {
    quantity: `${match[1] ?? ""}${formatAmount(converted)}`.trim(),
    rest: written.slice(alternate?.length ?? 0),
    choices,
    unit: converted.unit,
  };
}

/**
 * Whole line as written (already at its scale) with its amount in the
 * user's units, as on a shopping list.
 */
export function displayLine(
  line: string,
  ingredient: Ingredient | null | undefined,
  preferences: MeasurePreferences,
) {
  const shown = displayQuantity(line, 1, ingredient, preferences);
  const plain = splitQuantity(line);
  return shown.quantity === plain.quantity && shown.rest === plain.rest
    ? line
    : `${shown.quantity}${shown.rest}`;
}
