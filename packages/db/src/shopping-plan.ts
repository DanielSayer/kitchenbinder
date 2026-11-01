import {
  type Ingredient,
  parseIngredient,
  type Unit,
  unitDefinitions,
} from "./ingredients";

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

// Exact conversions only; spoons and cups stay separate because standards vary.
const sums: Partial<Record<Unit, { unit: string; multiplier: number }>> = {
  mg: { unit: "g", multiplier: 0.001 },
  g: { unit: "g", multiplier: 1 },
  kg: { unit: "g", multiplier: 1000 },
  oz: { unit: "g", multiplier: unitDefinitions.oz.base },
  lb: { unit: "g", multiplier: unitDefinitions.lb.base },
  ml: { unit: "ml", multiplier: 1 },
  l: { unit: "ml", multiplier: 1000 },
  tsp: { unit: "tsp", multiplier: 1 },
  tbsp: { unit: "tbsp", multiplier: 1 },
  cup: { unit: "cups", multiplier: 1 },
  clove: { unit: "cloves", multiplier: 1 },
};

// Packaging, ranges, alternatives and unspecified amounts never enter a sum.
export function parseGrocery(line: string, ingredient?: Ingredient | null) {
  const parsed = ingredient ?? parseIngredient(line);
  if (
    !parsed?.quantity ||
    parsed.quantityMax !== null ||
    parsed.size !== null ||
    parsed.optional
  )
    return null;
  const conversion = parsed.unit
    ? sums[parsed.unit]
    : { unit: "", multiplier: 1 };
  if (!conversion) return null;
  return {
    quantity: parsed.quantity * conversion.multiplier,
    unit: conversion.unit,
    name: parsed.item,
  };
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

type GroceryLine = string | { text: string; ingredient?: Ingredient | null };

export function combinedQuantity(lines: GroceryLine[]): string | null {
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
        !value || value.unit !== first.unit || value.name !== first.name,
    )
  )
    return null;
  const total = parsed.reduce((sum, value) => sum + (value?.quantity ?? 0), 0);
  const whole = Math.floor(total);
  const fraction = Object.entries(fractions).find(
    ([, value]) => Math.abs(total - whole - value) < 0.000001,
  )?.[0];
  const display = fraction
    ? `${whole || ""}${fraction}`
    : String(Number(total.toFixed(3)));
  const unit =
    total <= 1 && (first.unit === "cups" || first.unit === "cloves")
      ? first.unit.slice(0, -1)
      : first.unit;
  return `${display}${unit ? ` ${unit}` : ""}`;
}

export function generateShoppingPlan(
  items: { id: string; text: string; ingredient?: Ingredient | null }[],
): ShoppingPlan {
  const groups = new Map<string, ShoppingPlan["groups"][number]>();
  for (const item of items) {
    const parsed = parseGrocery(item.text, item.ingredient);
    const category = categoriseGrocery(parsed ? parsed.name : item.text);
    const key = parsed ? `${category}:${parsed.unit}:${parsed.name}` : item.id;
    const existing = groups.get(key);
    if (existing) existing.itemIds.push(item.id);
    else
      groups.set(key, {
        category,
        name: parsed
          ? parsed.name.charAt(0).toUpperCase() + parsed.name.slice(1)
          : item.text,
        itemIds: [item.id],
      });
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
