import { densities, liquids } from "./densities";
import {
  type MeasureStandard,
  normaliseItem,
  type Unit,
  unitBase,
  unitDefinitions,
} from "./ingredients";

// Unit conversion for parsed ingredients: between units of one kind, and
// between volume and weight using densities from USDA FoodData Central.

export type UnitSystem = "metric" | "imperial";
export type MeasurePreferences = {
  unitSystem: UnitSystem;
  /** Size of the user's cups and spoons. */
  measureStandard: MeasureStandard;
};
export const defaultMeasurePreferences: MeasurePreferences = {
  unitSystem: "metric",
  measureStandard: "au",
};
/** Cup and spoon size assumed for every recipe until recipes carry their own. */
export const recipeStandard: MeasureStandard = "au";

export type Amount = {
  quantity: number;
  quantityMax: number | null;
  unit: Unit;
};

// A modifier in front of these names changes what it is ("red pepper",
// "cashew butter", "baby corn"), so only an exact match counts.
const exactOnly = new Set(["pepper", "butter", "corn", "date"]);

/** Density table name for an ingredient, trying its last words too. */
function densityName(item: string) {
  const words = normaliseItem(item).split(" ");
  for (let start = 0; start < words.length; start++) {
    const name = words.slice(start).join(" ");
    if (densities[name] !== undefined && (start === 0 || !exactOnly.has(name)))
      return name;
  }
  return null;
}

/** Grams per millilitre for an ingredient, or null when unknown. */
export function densityOf(item: string) {
  const name = densityName(item);
  return name === null ? null : (densities[name] ?? null);
}

/** Whether an ingredient is poured, so metric keeps it in millilitres. */
export function isLiquid(item: string) {
  const name = densityName(item);
  return name !== null && liquids.has(name);
}

export function dimensionOf(unit: Unit) {
  return unitDefinitions[unit].dimension;
}

/**
 * Quantity converted to another unit, or null when the units don't mix.
 * Recipe cups and spoons are read at recipeStandard; `standard` sizes the
 * target's.
 */
export function convertQuantity(
  quantity: number,
  from: Unit,
  to: Unit,
  item: string,
  standard: MeasureStandard = defaultMeasurePreferences.measureStandard,
) {
  if (from === to) return quantity;
  const fromBase = unitBase(from, recipeStandard);
  const toBase = unitBase(to, standard);
  if (fromBase === null || toBase === null) return null;
  const fromDimension = dimensionOf(from);
  const toDimension = dimensionOf(to);
  let base = quantity * fromBase;
  if (fromDimension !== toDimension) {
    const density = densityOf(item);
    if (density === null) return null;
    base = fromDimension === "volume" ? base * density : base / density;
  }
  return base / toBase;
}

export function convertAmount(
  amount: Amount,
  to: Unit,
  item: string,
  standard?: MeasureStandard,
): Amount | null {
  const quantity = convertQuantity(
    amount.quantity,
    amount.unit,
    to,
    item,
    standard,
  );
  if (quantity === null) return null;
  const quantityMax =
    amount.quantityMax === null
      ? null
      : convertQuantity(amount.quantityMax, amount.unit, to, item, standard);
  return { quantity, quantityMax, unit: to };
}

/**
 * Units an amount can be switched to: as written, then its best metric and
 * imperial forms. At most three, the written unit first.
 */
export function unitChoices(
  amount: Amount,
  item: string,
  standard: MeasureStandard = defaultMeasurePreferences.measureStandard,
): Unit[] {
  const units = (["metric", "imperial"] as const).map(
    (unitSystem) =>
      preferredAmount(amount, item, { unitSystem, measureStandard: standard })
        .unit,
  );
  return [...new Set([amount.unit, ...units])];
}

const metricUnits = new Set<Unit>(["mg", "g", "kg", "ml", "l"]);

/** Best metric unit for grams or millilitres. */
function metricUnit(base: number, dimension: "mass" | "volume"): Unit {
  if (dimension === "mass") return base >= 1000 ? "kg" : "g";
  return base >= 1000 ? "l" : "ml";
}

/** Best imperial unit for grams or millilitres. */
function imperialUnit(
  base: number,
  dimension: "mass" | "volume",
  standard: MeasureStandard,
): Unit {
  if (dimension === "mass")
    return base >= 16 * unitDefinitions.oz.base ? "lb" : "oz";
  const cup = unitBase("cup", standard) ?? 250;
  const tablespoon = unitBase("tbsp", standard) ?? 20;
  if (base >= cup / 4 - 0.01) return "cup";
  return base >= tablespoon - 0.01 ? "tbsp" : "tsp";
}

/**
 * Amount in the user's units. Metric shows cups of dry ingredients as grams
 * and liquids (or anything without a density) as millilitres; imperial shows weights in ounces and pounds
 * and liquids in cups. Spoons and units already in the system are kept.
 */
export function preferredAmount(
  amount: Amount,
  item: string,
  preferences: MeasurePreferences,
): Amount {
  const { unit } = amount;
  const dimension = dimensionOf(unit);
  if (dimension === "count" || unit === "tsp" || unit === "tbsp") return amount;
  const base = amount.quantity * (unitBase(unit, recipeStandard) ?? Number.NaN);
  const { unitSystem, measureStandard } = preferences;
  let target: Unit;
  if (unitSystem === "metric") {
    if (metricUnits.has(unit)) return amount;
    const density = isLiquid(item) ? null : densityOf(item);
    if (dimension === "volume" && density !== null)
      target = metricUnit(base * density, "mass");
    else target = metricUnit(base, dimension);
  } else {
    if (!metricUnits.has(unit)) return amount;
    target = imperialUnit(base, dimension, measureStandard);
  }
  return convertAmount(amount, target, item, measureStandard) ?? amount;
}

const glyphs: [number, string][] = [
  [0, ""],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
  [1, ""],
];

/**
 * Kitchen-friendly number: whole numbers from 10, otherwise nearest ¼ or ⅓,
 * or only the given fractions.
 */
export function formatQuantity(value: number, fractions = glyphs) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 10) return String(Math.round(value));
  let whole = Math.floor(value);
  const rest = value - whole;
  let best = glyphs[0] as [number, string];
  for (const candidate of fractions)
    if (Math.abs(candidate[0] - rest) < Math.abs(best[0] - rest))
      best = candidate;
  if (best[0] === 1) whole += 1;
  if (whole === 0 && !best[1])
    return fractions.find(([, glyph]) => glyph)?.[1] ?? "¼";
  return `${whole || ""}${best[1]}` || "0";
}

const halves = glyphs.filter(([value]) => value % 0.5 === 0);
const quarters = glyphs.filter(([value]) => value % 0.25 === 0);

/** Grams and millilitres rounded the way recipes write them. */
function formatMetric(value: number) {
  // 625 ml and 450 g, not 630 ml and 455 g: quarters of a hundred when close.
  if (value >= 250 && value < 1000) {
    const quarter = Math.round(value / 25) * 25;
    if (Math.abs(quarter - value) <= value * 0.02) return String(quarter);
  }
  const step =
    value < 5 ? 0.5 : value < 20 ? 1 : value < 250 ? 5 : value < 1000 ? 10 : 50;
  const rounded = Math.max(step, Math.round(value / step) * step);
  return String(Number(rounded.toFixed(1)));
}

/** Kilos and litres to the nearest 0.05. */
function formatLarge(value: number) {
  return String(Number((Math.round(value * 20) / 20).toFixed(2)));
}

/** Number as written for a unit: decimals for metric, fractions otherwise. */
export function formatUnitQuantity(value: number, unit: Unit) {
  if (unit === "g" || unit === "ml" || unit === "mg")
    return formatMetric(value);
  if (unit === "kg" || unit === "l") return formatLarge(value);
  // Scales and jugs mark halves and quarters, not thirds.
  if (unit === "oz" || unit === "fl_oz") return formatQuantity(value, halves);
  if (unit === "lb") return formatQuantity(value, quarters);
  return formatQuantity(value);
}

const labels: Partial<Record<Unit, [string, string]>> = {
  cup: ["cup", "cups"],
  fl_oz: ["fl oz", "fl oz"],
  pint: ["pint", "pints"],
  quart: ["quart", "quarts"],
};

/** Short unit label, plural when needed: "g", "cups", "clove". */
export function unitLabel(unit: Unit, quantity = 1) {
  const label = labels[unit];
  if (label) return quantity > 1 ? label[1] : label[0];
  if (dimensionOf(unit) !== "count") return unit;
  const [singular = unit, plural = unit] = unitDefinitions[unit].aliases;
  return quantity > 1 ? plural : singular;
}

/** "250 g", "1½ cups", "2-3 tbsp". */
export function formatAmount(amount: Amount) {
  const { quantity, quantityMax, unit } = amount;
  const first = formatUnitQuantity(quantity, unit);
  const second =
    quantityMax === null ? null : formatUnitQuantity(quantityMax, unit);
  const number = second && second !== first ? `${first}-${second}` : first;
  const largest = quantityMax ?? quantity;
  const plural = largest > 1 && number !== "1";
  return `${number} ${unitLabel(unit, plural ? 2 : 1)}`;
}
