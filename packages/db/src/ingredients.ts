import { z } from "zod";

// Structured ingredient lines. The recipe's text stays the source of truth;
// this is derived from it, by the AI on import or by parseIngredient below.

type UnitDefinition = {
  aliases: string[];
  dimension: "mass" | "volume" | "count";
  /** Grams or millilitres per unit. Spoons and cups depend on the standard. */
  base?: number | Record<MeasureStandard, number>;
};
export type MeasureStandard = "au" | "us";

export const unitDefinitions = {
  mg: {
    aliases: ["mg", "milligram", "milligrams"],
    dimension: "mass",
    base: 0.001,
  },
  g: {
    aliases: ["g", "gm", "gms", "gr", "gram", "grams", "gramme", "grammes"],
    dimension: "mass",
    base: 1,
  },
  kg: {
    aliases: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
    dimension: "mass",
    base: 1000,
  },
  oz: {
    aliases: ["oz", "ounce", "ounces"],
    dimension: "mass",
    base: 28.349_523,
  },
  lb: {
    aliases: ["lb", "lbs", "pound", "pounds"],
    dimension: "mass",
    base: 453.592_37,
  },
  ml: {
    aliases: [
      "ml",
      "mls",
      "millilitre",
      "millilitres",
      "milliliter",
      "milliliters",
    ],
    dimension: "volume",
    base: 1,
  },
  l: {
    aliases: ["l", "litre", "litres", "liter", "liters"],
    dimension: "volume",
    base: 1000,
  },
  tsp: {
    aliases: ["tsp", "tsps", "teaspoon", "teaspoons"],
    dimension: "volume",
    base: { au: 5, us: 4.928_92 },
  },
  tbsp: {
    aliases: ["tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons"],
    dimension: "volume",
    base: { au: 20, us: 14.786_76 },
  },
  cup: {
    aliases: ["cup", "cups"],
    dimension: "volume",
    base: { au: 250, us: 240 },
  },
  fl_oz: {
    aliases: ["fl oz", "fl. oz", "fluid ounce", "fluid ounces"],
    dimension: "volume",
    base: 29.573_53,
  },
  pint: {
    aliases: ["pint", "pints", "pt"],
    dimension: "volume",
    base: 473.176_47,
  },
  quart: {
    aliases: ["quart", "quarts", "qt"],
    dimension: "volume",
    base: 946.352_95,
  },
  clove: { aliases: ["clove", "cloves"], dimension: "count" },
  tin: { aliases: ["tin", "tins"], dimension: "count" },
  can: { aliases: ["can", "cans"], dimension: "count" },
  jar: { aliases: ["jar", "jars"], dimension: "count" },
  bottle: { aliases: ["bottle", "bottles"], dimension: "count" },
  packet: {
    aliases: ["packet", "packets", "pack", "packs", "pkt", "pkts", "pk"],
    dimension: "count",
  },
  bag: { aliases: ["bag", "bags"], dimension: "count" },
  block: { aliases: ["block", "blocks"], dimension: "count" },
  tub: { aliases: ["tub", "tubs"], dimension: "count" },
  carton: { aliases: ["carton", "cartons"], dimension: "count" },
  punnet: { aliases: ["punnet", "punnets"], dimension: "count" },
  bunch: { aliases: ["bunch", "bunches"], dimension: "count" },
  head: { aliases: ["head", "heads"], dimension: "count" },
  stalk: { aliases: ["stalk", "stalks"], dimension: "count" },
  sprig: { aliases: ["sprig", "sprigs"], dimension: "count" },
  stick: { aliases: ["stick", "sticks"], dimension: "count" },
  sheet: { aliases: ["sheet", "sheets"], dimension: "count" },
  slice: { aliases: ["slice", "slices"], dimension: "count" },
  piece: { aliases: ["piece", "pieces"], dimension: "count" },
  fillet: { aliases: ["fillet", "fillets"], dimension: "count" },
  rasher: { aliases: ["rasher", "rashers"], dimension: "count" },
  knob: { aliases: ["knob", "knobs"], dimension: "count" },
  handful: { aliases: ["handful", "handfuls"], dimension: "count" },
  pinch: { aliases: ["pinch", "pinches"], dimension: "count" },
  dash: { aliases: ["dash", "dashes"], dimension: "count" },
  splash: { aliases: ["splash", "splashes"], dimension: "count" },
  drop: { aliases: ["drop", "drops"], dimension: "count" },
} satisfies Record<string, UnitDefinition>;

export type Unit = keyof typeof unitDefinitions;
export const unitIds = Object.keys(unitDefinitions) as [Unit, ...Unit[]];

/** Grams or millilitres in one unit, or null for counted units. */
export function unitBase(unit: Unit, standard: MeasureStandard = "au") {
  const definition: UnitDefinition = unitDefinitions[unit];
  const base = definition.base;
  if (base === undefined) return null;
  return typeof base === "number" ? base : base[standard];
}

export const ingredientSchema = z.object({
  quantity: z.number().positive().max(100_000).nullable(),
  /** Upper end of a range such as "2-3". */
  quantityMax: z.number().positive().max(100_000).nullable(),
  unit: z.enum(unitIds).nullable(),
  /** Package size, as in "2 x 400 g tins". */
  size: z
    .object({
      quantity: z.number().positive().max(100_000),
      unit: z.enum(unitIds),
    })
    .nullable(),
  /** Singular, lowercase thing to buy: "garlic", "red onion", "plain flour". */
  item: z.string().trim().min(1).max(200),
  /** Preparation, size and other notes: "finely sliced", "large". */
  detail: z.string().trim().max(500).nullable(),
  optional: z.boolean(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const ingredientLineSchema = z.object({
  text: z.string(),
  heading: z.boolean(),
  /** Null when the line couldn't be read with confidence. */
  parsed: ingredientSchema.nullable(),
  source: z.enum(["ai", "code"]),
});
export type IngredientLine = z.infer<typeof ingredientLineSchema>;

const vulgar: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};
const words: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5,
  dozen: 12,
};

/** Number pattern: "1", "1.5", "1,5", "1/2", "1 1/2", "1½", "½". */
export const quantityPattern = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?(?:\s*[¼½¾⅓⅔⅛⅜⅝⅞])?|[¼½¾⅓⅔⅛⅜⅝⅞]`;

/** Value of a quantityPattern match, or NaN. */
export function parseQuantity(text: string) {
  const value = text.trim().replace(/\s+/g, " ");
  const mixed = value.match(/^(\d+) (\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const glyph = value.match(/^(\d*)\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if (glyph) return Number(glyph[1] || 0) + (vulgar[glyph[2] ?? ""] ?? 0);
  if (/^\d{1,3}(?:,\d{3})+$/.test(value))
    return Number(value.replace(/,/g, ""));
  return /^\d+(?:[.,]\d+)?$/.test(value)
    ? Number(value.replace(",", "."))
    : Number.NaN;
}

const aliasToUnit = new Map<string, Unit>(
  unitIds.flatMap((unit) =>
    unitDefinitions[unit].aliases.map((alias) => [alias, unit] as const),
  ),
);
const aliasPattern = [...aliasToUnit.keys()]
  .sort((a, b) => b.length - a.length)
  .map((alias) => alias.replace(/[.]/g, "\\.").replace(/ /g, "\\s*"))
  .join("|");
const unitPattern = new RegExp(
  String.raw`^((${aliasPattern})\.?)(?![a-z])\s*(?:of\s+)?`,
  "i",
);
const amountPattern = new RegExp(
  // Digits may run into a unit ("400g"); words may not ("an" in "angel").
  String.raw`^(?:(${quantityPattern})|(${Object.keys(words).join("|")}|an?)(?![a-z]))(?:\s*(?:-|–|to)\s*(${quantityPattern})(?![\d/]))?\s*`,
  "i",
);
/** Units that hold a package size, as in "400 g tin". */
export const containers = new Set<Unit>([
  "tin",
  "can",
  "jar",
  "bottle",
  "packet",
  "bag",
  "block",
  "tub",
  "carton",
  "punnet",
]);

/** Unit at the start of text; length includes a following "of". */
export function readUnit(text: string) {
  const match = text.match(unitPattern);
  if (!match?.[1] || !match[2]) return null;
  const unit = aliasToUnit.get(match[2].toLowerCase().replace(/\s+/g, " "));
  return unit
    ? { unit, length: match[0].length, written: match[1].length }
    : null;
}

function readAmount(text: string) {
  const match = text.match(amountPattern);
  const first = (match?.[1] ?? match?.[2])?.toLowerCase();
  if (!match || !first) return null;
  const quantity =
    first === "a" || first === "an"
      ? 1
      : (words[first] ?? parseQuantity(first));
  const quantityMax = match[3] ? parseQuantity(match[3]) : null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (quantityMax !== null && !(quantityMax > quantity)) return null;
  return { quantity, quantityMax, length: match[0].length };
}

const optionalPattern =
  /(?:,\s*|\s+|\(\s*)(?:optional|to taste|to serve|for serving|for garnish|to garnish|for decoration|if desired)\s*\)?\s*$/i;
// Leading words that describe preparation or size rather than what to buy.
const descriptor =
  /^(?:(?:very|finely|roughly|coarsely|thinly|thickly|freshly|lightly|well|loosely|firmly|tightly|extra)[\s-]+)*(?:chopped|diced|sliced|minced|crushed|grated|peeled|softened|melted|drained|rinsed|halved|quartered|shredded|cubed|trimmed|beaten|sifted|toasted|deseeded|pitted|zested|juiced|torn|mashed|crumbled|squeezed|packed|heaped|level|small|medium|large|big|generous|good|ripe|cold|warm|chilled|room[\s-]temperature)\b,?\s*/i;
// Prepared forms sold as their own product keep their descriptor.
const products =
  /^(?:(?:crushed|chopped|diced) tomato|minced (?:beef|pork|lamb|chicken|turkey|veal|meat)|(?:sliced|slivered|flaked|chopped) (?:almond|nut)|shredded (?:coconut|cheese|mozzarella)|grated (?:cheese|parmesan|mozzarella|cheddar|pizza cheese))/i;
// Units written after the item, as in "3 garlic cloves".
const trailingUnit =
  /\s+(cloves?|sprigs?|stalks?|heads?|bunch(?:es)?|fillets?|rashers?|sheets?|slices?|sticks?)$/i;
const plurals: [RegExp, string][] = [
  [/(chill|chil)ies$/, "$1i"],
  [/(berr|cherr|anchov|peon)ies$/, "$1y"],
  [/(potato|tomato|mango|avocado|jalapeño|jalapeno)es$/, "$1"],
  [/(lea|hal|loa)ves$/, "$1f"],
  [/(radish|squash|peach|bunch|sandwich|dish|box|fox)es$/, "$1"],
  [/(?<![su])s$/, ""],
];
const keepPlural =
  /(?:asparagus|couscous|hummus|houmous|molasses|brussels|swiss|grass|series|species|cress|oats|grits|greens|noodles|lentils|chickpeas|peas|beans|sprinkles|bitters|schnapps|chives|herbes de provence|fries|crisps|chips|guts|innards|tortilla chips|breadcrumbs|crumbs)$/;

// Usually written in the plural, so "chickpea" groups with "chickpeas".
const pluralOnly =
  /(?:chickpea|lentil|bean|noodle|oat|chive|breadcrumb|crumb|(?:^|\s)pea)$/;

/** Singular, lowercase form of an item, for grouping like with like. */
export function normaliseItem(text: string) {
  const item = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^of\s+/, "")
    .trim();
  if (keepPlural.test(item)) return item;
  if (pluralOnly.test(item)) return `${item}s`;
  const last = item.match(/(\S+)$/)?.[1] ?? "";
  for (const [pattern, replacement] of plurals)
    if (pattern.test(last))
      return item.slice(0, -last.length) + last.replace(pattern, replacement);
  return item;
}

/** A line such as "For the sauce:" that names a group of ingredients. */
export function isIngredientHeading(text: string) {
  const line = text.trim();
  return (
    (/:$/.test(line) && !/\d/.test(line)) ||
    /^for the [^,\d]{1,40}$/i.test(line) ||
    /^[A-Z][A-Z &]{2,40}$/.test(line)
  );
}

/**
 * Reads one ingredient line, or returns null when unsure. Alternatives
 * ("or"), additions ("plus extra") and loose amounts are left for the AI.
 */
export function parseIngredient(text: string): Ingredient | null {
  let rest = text.trim().replace(/\s+/g, " ");
  if (!rest || rest.length > 200) return null;
  if (
    /\b(?:or|plus|and\/or|approx\w*|about|around|some|few|little|bit|couple|several)\b/i.test(
      rest,
    )
  )
    return null;

  let optional = false;
  const notes: string[] = [];
  const option = rest.match(optionalPattern);
  if (option) {
    optional = true;
    notes.push(option[0].replace(/^[\s,(]+|[\s)]+$/g, ""));
    rest = rest.slice(0, -option[0].length).trim();
  }
  let bracketSize: Ingredient["size"] = null;
  rest = rest.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    const amount = readAmount(inner.trim());
    const read = amount && readUnit(inner.trim().slice(amount.length));
    if (
      amount &&
      !amount.quantityMax &&
      read &&
      amount.length + read.length >= inner.trim().length
    )
      bracketSize = { quantity: amount.quantity, unit: read.unit };
    else notes.push(inner.trim());
    return " ";
  });
  rest = rest.replace(/\s+/g, " ").trim();
  if (/[()]/.test(rest)) return null;

  let quantity: number | null = null;
  let quantityMax: number | null = null;
  let unit: Unit | null = null;
  let size: Ingredient["size"] = null;

  const amount = readAmount(rest);
  if (amount) {
    quantity = amount.quantity;
    quantityMax = amount.quantityMax;
    rest = rest.slice(amount.length).replace(/^an?\s+/i, "");
    // "a good pinch", "half a lemon"
    const loose = rest.match(
      /^(?:good|generous|large|small|big|heaped|level)\s+/i,
    );
    if (loose && readUnit(rest.slice(loose[0].length))) {
      notes.push(loose[0].trim());
      rest = rest.slice(loose[0].length);
    }
    // "2 x 400 g tins", "2 x 400g tomatoes"
    const times = rest.match(/^[x×]\s*/i);
    if (times) {
      rest = rest.slice(times[0].length);
      const packAmount = readAmount(rest);
      const packUnit = packAmount && readUnit(rest.slice(packAmount.length));
      if (!packAmount || packAmount.quantityMax || !packUnit) return null;
      size = { quantity: packAmount.quantity, unit: packUnit.unit };
      rest = rest.slice(packAmount.length + packUnit.length);
      const container = readUnit(rest);
      if (container && containers.has(container.unit)) {
        unit = container.unit;
        rest = rest.slice(container.length);
      }
    } else {
      const read = readUnit(rest);
      if (read) {
        unit = read.unit;
        rest = rest.slice(read.length);
        // "400 g tin chickpeas" is one 400 g tin.
        const container = readUnit(rest);
        if (container && containers.has(container.unit)) {
          if (quantityMax !== null) return null;
          size = { quantity, unit };
          quantity = 1;
          unit = container.unit;
          rest = rest.slice(container.length);
        }
      }
    }
  }

  // "1 can (400 ml) coconut milk"
  if (bracketSize && size === null && unit !== null && containers.has(unit))
    size = bracketSize;
  else if (bracketSize) {
    const { quantity: q, unit: u } = bracketSize;
    notes.push(`${q} ${u}`);
  }

  const [head = "", ...tail] = rest.split(",");
  let item = head.trim();
  notes.push(...tail.map((part) => part.trim()));

  for (let previous = ""; previous !== item; ) {
    previous = item;
    if (products.test(item)) break;
    const match = item.match(descriptor);
    if (match?.[0] && match[0].length < item.length) {
      notes.unshift(match[0].replace(/,?\s*$/, ""));
      item = item.slice(match[0].length);
    }
  }
  const trailing = unit === null ? item.match(trailingUnit) : null;
  if (trailing?.[1]) {
    const read = readUnit(trailing[1]);
    if (read) {
      unit = read.unit;
      item = item.slice(0, -trailing[0].length);
    }
  }

  item = normaliseItem(item.replace(/^of\s+/i, ""));
  if (!item || /\d/.test(item) || item.split(" ").length > 6) return null;
  const detail = notes.filter(Boolean).join(", ");
  return {
    quantity,
    quantityMax,
    unit,
    size,
    item,
    detail: detail || null,
    optional,
  };
}

/** Code-parsed lines for a recipe, reusing earlier results for unchanged text. */
export function parseIngredientLines(
  texts: readonly string[],
  previous: readonly IngredientLine[] | null = null,
): IngredientLine[] {
  const known = new Map(previous?.map((line) => [line.text, line]));
  return texts.map((text) => {
    const reused = known.get(text);
    if (reused) return reused;
    const heading = isIngredientHeading(text);
    return {
      text,
      heading,
      parsed: heading ? null : parseIngredient(text),
      source: "code",
    };
  });
}

/** Lines the code parser couldn't read, which the AI should try. */
export function needsAiParse(lines: readonly IngredientLine[] | null) {
  return (
    !lines ||
    lines.some(
      (line) => !line.heading && !line.parsed && line.source === "code",
    )
  );
}
