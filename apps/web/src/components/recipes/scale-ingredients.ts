// Servings scaling for free-text ingredient lines: only the leading quantity
// ("1 1/2", "½", "2-3", "400g") is scaled; everything else is left as written.
// A package size ("400 g tin") is kept and the number of packages scaled.

import {
  containers,
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
  isMetricUnit,
  type MeasurePreferences,
  preferredAmount,
  unitChoices,
  unitLabel,
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

export function scaleIngredient(line: string, factor: number) {
  if (factor === 1) return line;
  const packages = scalePackages(line, factor);
  if (packages) return packages;
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

type Displayed = {
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

/** Whole line with its amount in the user's units. */
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
