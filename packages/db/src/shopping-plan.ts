import { type Ingredient, parseIngredient, type Unit } from "./ingredients";
import {
  convertQuantity,
  defaultMeasurePreferences,
  densityOf,
  dimensionOf,
  formatAmount,
  type MeasurePreferences,
  preferredAmount,
  unitLabel,
} from "./units";

export const shoppingCategories = [
  "Produce",
  "Meat & seafood",
  "Dairy & eggs",
  "Bakery",
  "Pantry",
  "Frozen",
  "Cleaning & household",
  "Other",
] as const;
type Category = (typeof shoppingCategories)[number];
export type ShoppingPlan = {
  groups: { category: Category; name: string; itemIds: string[] }[];
};

const categoryRules: { category: Category; pattern: RegExp }[] = [
  {
    category: "Cleaning & household",
    pattern:
      /\b(detergent|washing.?up|dishwashing|dishwasher|laundry|bleach|cleaner|cleaning|disinfectant|soap|shampoo|conditioner|toothpaste|toilet paper|toilet roll|paper towel|bin bags?|rubbish bags?|garbage bags?|cling film|foil|baking paper|sponges?|tissues?|deodorant|sanitari[sz]er)\b/i,
  },
  { category: "Frozen", pattern: /\b(frozen|ice cream|ice cubes?)\b/i },
  {
    category: "Pantry",
    pattern:
      /\b(stock|broth|canned|tinned|tins?|cans?|coconut (milk|cream)|peanut butter|almond butter|cream of tartar|milk powder|dried|powder|paste|sauce|juice|jam|extract|essence|flour|oil|vinegar|salt)\b/i,
  },
  {
    category: "Dairy & eggs",
    pattern:
      /\b(milk|cream|butter|cheese|cheddar|parmesan|mozzarella|feta|ricotta|halloumi|yogh?urt|eggs?|kefir|ghee|margarine)\b/i,
  },
  {
    category: "Meat & seafood",
    pattern:
      /\b(chicken|beef|pork|lamb|turkey|duck|veal|venison|bacon|ham|sausages?|steak|mince|fish|salmon|tuna|prawns?|shrimps?|cod|barramundi|sardines?|anchov(?:y|ies)|mussels?|oysters?|scallops?|crab|lobster|squid|chorizo|salami)\b/i,
  },
  {
    category: "Produce",
    pattern:
      /\b(onions?|shallots?|scallions?|garlic|ginger|potato(?:es)?|tomato(?:es)?|carrots?|capsicums?|bell peppers?|chill(?:i|ies)|jalapeños?|zucchini|courgettes?|broccoli|cauliflower|cabbage|lettuce|spinach|kale|rocket|arugula|cucumber|celery|leeks?|mushrooms?|aubergine|eggplant|pumpkin|squash|asparagus|beetroot|peas|green beans|corn|avocados?|lemons?|limes?|oranges?|apples?|bananas?|pears?|peaches?|berries|strawberries|blueberries|raspberries|grapes|melon|watermelon|pineapple|mango(?:es)?|kiwi|coriander|cilantro|parsley|basil|mint|dill|rosemary|thyme|chives|lemongrass)\b/i,
  },
  {
    category: "Bakery",
    pattern:
      /\b(bread|loaf|loaves|rolls?|buns?|bagels?|wraps?|tortillas?|pita|pitta|naan|crumpets?|croissants?|baguette|sourdough)\b/i,
  },
  {
    category: "Pantry",
    pattern:
      /\b(rice|pasta|spaghetti|penne|fettuccine|linguine|macaroni|noodles|couscous|quinoa|oats|cereal|flour|sugar|salt|pepper|oil|vinegar|soy|tamari|miso|tofu|tempeh|lentils?|chickpeas?|beans?|chocolate|cocoa|coffee|tea|honey|syrup|nuts|almonds?|cashews?|walnuts?|peanuts?|seeds?|sesame|mustard|cumin|paprika|turmeric|cinnamon|nutmeg|oregano|bay leaves|cardamom|cloves|spices|baking soda|bicarbonate|baking powder|yeast|breadcrumbs|raisins|sultanas|dates|olives?|capers?|crackers|biscuits)\b/i,
  },
];
export function categoriseGrocery(text: string): Category {
  const ingredient =
    text.split(",")[0]?.replace(/\s+(?:for|to)\s+.*$/i, "") ?? text;
  return (
    categoryRules.find((rule) => rule.pattern.test(ingredient))?.category ??
    "Other"
  );
}

type Grocery = { quantity: number; unit: Unit | null; name: string };

// Packaging, ranges, alternatives and unspecified amounts never enter a sum.
export function parseGrocery(
  line: string,
  ingredient?: Ingredient | null,
): Grocery | null {
  const parsed = ingredient ?? parseIngredient(line);
  if (
    !parsed?.quantity ||
    parsed.quantityMax !== null ||
    parsed.size !== null ||
    parsed.optional
  )
    return null;
  const unit = parsed.unit;
  if (unit && unit !== "clove" && dimensionOf(unit) === "count") return null;
  return { quantity: parsed.quantity, unit, name: parsed.item };
}

/**
 * Which lines can be added together: counts with counts, cloves with
 * cloves, and weights with volumes when the ingredient's density is known.
 */
function sumKind({ unit, name }: Grocery) {
  if (unit === null || unit === "clove") return unit ?? "each";
  return densityOf(name) === null ? dimensionOf(unit) : "measure";
}

const fractions: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

function formatCount(total: number) {
  const whole = Math.floor(total);
  const fraction = Object.entries(fractions).find(
    ([, value]) => Math.abs(total - whole - value) < 0.000001,
  )?.[0];
  return fraction
    ? `${whole || ""}${fraction}`
    : String(Number(total.toFixed(3)));
}

type GroceryLine = string | { text: string; ingredient?: Ingredient | null };

/** Total for lines of one item, in the user's units, or null if they don't add up. */
export function combinedQuantity(
  lines: GroceryLine[],
  preferences: MeasurePreferences = defaultMeasurePreferences,
): string | null {
  const parsed = lines.map((line) =>
    typeof line === "string"
      ? parseGrocery(line)
      : parseGrocery(line.text, line.ingredient),
  );
  const first = parsed[0];
  if (
    !first ||
    parsed.some(
      (value) =>
        !value ||
        value.name !== first.name ||
        sumKind(value) !== sumKind(first),
    )
  )
    return null;
  const groceries = parsed as Grocery[];
  const { unit, name } = first;
  if (unit === null || unit === "clove") {
    const total = groceries.reduce((sum, value) => sum + value.quantity, 0);
    const label = unit ? ` ${unitLabel(unit, total > 1 ? 2 : 1)}` : "";
    return `${formatCount(total)}${label}`;
  }
  // One unit throughout stays in it; mixed units add up in grams, or in
  // millilitres when every line is a volume.
  const target: Unit = groceries.every((value) => value.unit === unit)
    ? unit
    : groceries.every(
          (value) => value.unit && dimensionOf(value.unit) === "volume",
        )
      ? "ml"
      : "g";
  let total = 0;
  for (const value of groceries) {
    const converted =
      value.unit && convertQuantity(value.quantity, value.unit, target, name);
    if (converted === null || converted === undefined) return null;
    total += converted;
  }
  const amount = { quantity: total, quantityMax: null, unit: target };
  return formatAmount(preferredAmount(amount, name, preferences));
}

/**
 * A line's aisle, and the key and name it shares with other lines of the
 * same item that add up to one total (null key when it can't be added).
 */
export function groceryGroup(text: string, ingredient?: Ingredient | null) {
  const parsed = parseGrocery(text, ingredient);
  const category = categoriseGrocery(parsed ? parsed.name : text);
  return parsed
    ? {
        category,
        key: `${category}:${sumKind(parsed)}:${parsed.name}`,
        name: parsed.name.charAt(0).toUpperCase() + parsed.name.slice(1),
      }
    : { category, key: null, name: text };
}

export function generateShoppingPlan(
  items: { id: string; text: string; ingredient?: Ingredient | null }[],
): ShoppingPlan {
  const groups = new Map<string, ShoppingPlan["groups"][number]>();
  for (const item of items) {
    const { category, key, name } = groceryGroup(item.text, item.ingredient);
    const existing = groups.get(key ?? item.id);
    if (existing) existing.itemIds.push(item.id);
    else groups.set(key ?? item.id, { category, name, itemIds: [item.id] });
  }
  return {
    groups: [...groups.values()].sort(
      (a, b) =>
        shoppingCategories.indexOf(a.category) -
          shoppingCategories.indexOf(b.category) ||
        a.name.localeCompare(b.name),
    ),
  };
}
