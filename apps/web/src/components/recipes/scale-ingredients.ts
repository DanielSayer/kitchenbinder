// Servings scaling for free-text ingredient lines: only the leading quantity
// ("1 1/2", "½", "2-3", "400g") is scaled; everything else is left as written.

import {
  type Ingredient,
  parseQuantity,
  quantityPattern,
  readUnit,
  type Unit,
} from "@prep-sheet/db/ingredients";
import {
  convertAmount,
  dimensionOf,
  formatAmount,
  formatQuantity,
  type MeasurePreferences,
  preferredAmount,
  unitChoices,
} from "@prep-sheet/db/units";

export { formatQuantity };

const leading = new RegExp(
  String.raw`^(\s*)(${quantityPattern})(?:(\s*(?:-|–|to)\s*)(${quantityPattern}))?`,
);

/** First whole number in a servings string ("4", "4-6", "Serves 2"). */
export function parseServings(servings: string | null | undefined) {
  const match = servings?.match(/\d+/);
  const value = match ? Number(match[0]) : 0;
  return value > 0 && value <= 1000 ? value : null;
}

/** Readable servings label: bare numbers/ranges become "Serves 4"; "12 cookies" stays. */
export function formatServings(servings: string | null | undefined) {
  const text = servings?.trim();
  if (!text) return null;
  return /^\d+(\s*[-–]\s*\d+)?$/.test(text) ? `Serves ${text}` : text;
}

export function scaleIngredient(line: string, factor: number) {
  if (factor === 1) return line;
  const match = line.match(leading);
  if (!match) return line;
  const [all, space = "", first = "", joiner, second] = match;
  const scaled = (text: string) => formatQuantity(parseQuantity(text) * factor);
  const quantity =
    second !== undefined
      ? `${scaled(first)}${joiner}${scaled(second)}`
      : scaled(first);
  return `${space}${quantity}${line.slice(all.length)}`;
}

/** Split a line into its (possibly scaled) leading quantity and the rest. */
export function splitQuantity(line: string, factor = 1) {
  const scaled = scaleIngredient(line, factor);
  const match = scaled.match(leading);
  if (!match) return { quantity: "", rest: scaled };
  const after = scaled.slice(match[0].length);
  const times = after.match(/^\s*(?:x\s+)?/i)?.[0] ?? "";
  const unit = readUnit(after.slice(times.length));
  const unitLength = unit ? times.length + unit.written : 0;
  const end = match[0].length + unitLength;
  return { quantity: scaled.slice(0, end).trim(), rest: scaled.slice(end) };
}

type Displayed = {
  quantity: string;
  rest: string;
  /** Units the quantity can switch between, when it can. */
  choices?: { unit: Unit; label: string }[];
  unit?: Unit;
};

/**
 * Like splitQuantity, but shows the amount in the user's units, or in
 * `unit` when they picked one. Only lines whose written amount matches the
 * parsed ingredient are converted; the rest show as written.
 */
export function displayQuantity(
  line: string,
  factor: number,
  ingredient: Ingredient | null | undefined,
  preferences: MeasurePreferences,
  unit?: Unit | null,
): Displayed {
  const plain = splitQuantity(line, factor);
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
  if (
    !match?.[2] ||
    read?.unit !== parsed.unit ||
    Math.abs(parseQuantity(match[2]) - parsed.quantity) > 0.001
  )
    return plain;
  const amount = {
    quantity: parsed.quantity * factor,
    quantityMax:
      parsed.quantityMax === null ? null : parsed.quantityMax * factor,
    unit: parsed.unit,
  };
  const item = parsed.item;
  const shown = (target: Unit) =>
    convertAmount(amount, target, item, preferences.measureStandard);
  const converted =
    (unit && shown(unit)) ?? preferredAmount(amount, item, preferences);
  const choices = unitChoices(parsed.unit, item).flatMap((choice) => {
    const value = shown(choice);
    return value ? [{ unit: choice, label: formatAmount(value) }] : [];
  });
  if (converted.unit === parsed.unit)
    return { ...plain, choices, unit: parsed.unit };
  return {
    quantity: `${match[1] ?? ""}${formatAmount(converted)}`.trim(),
    rest: after.slice(space.length + read.written),
    choices,
    unit: converted.unit,
  };
}

/** Whole line with its amount in the user's units. */
export function displayLine(
  line: string,
  ingredient: Ingredient | null | undefined,
  preferences: MeasurePreferences,
) {
  const shown = displayQuantity(line, 1, ingredient, preferences);
  return shown.quantity === splitQuantity(line).quantity
    ? line
    : `${shown.quantity}${shown.rest}`;
}
