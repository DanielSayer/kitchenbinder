// Servings scaling for free-text ingredient lines: only the leading quantity
// ("1 1/2", "½", "2-3", "400g") is scaled; everything else is left as written.

const vulgar: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};
const number = String.raw`\d+\/\d+|\d+(?:[.,]\d+)?(?:\s+\d+\/\d+|\s*[¼½¾⅓⅔⅛])?|[¼½¾⅓⅔⅛]`;
const leading = new RegExp(
  String.raw`^(\s*)(${number})(?:(\s*(?:-|–|to)\s*)(${number}))?`,
);

function parseNumber(text: string) {
  const value = text.trim();
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2] || 1);
  const mixed = value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3] || 1);
  const glyph = value.match(/^(\d*)\s*([¼½¾⅓⅔⅛])$/);
  if (glyph) return Number(glyph[1] || 0) + (vulgar[glyph[2] ?? ""] ?? 0);
  return Number(value.replace(",", "."));
}

const fractions: [number, string][] = [
  [0, ""],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
  [1, ""],
];

/** Kitchen-friendly number: whole numbers from 10, otherwise nearest ¼ or ⅓. */
export function formatQuantity(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 10) return String(Math.round(value));
  let whole = Math.floor(value);
  const rest = value - whole;
  let best = fractions[0] as [number, string];
  for (const candidate of fractions)
    if (Math.abs(candidate[0] - rest) < Math.abs(best[0] - rest))
      best = candidate;
  if (best[0] === 1) whole += 1;
  if (whole === 0 && !best[1]) return "¼";
  return `${whole || ""}${best[1]}` || "0";
}

/** First whole number in a servings string ("4", "4-6", "Serves 2"). */
export function parseServings(servings: string | null | undefined) {
  const match = servings?.match(/\d+/);
  const value = match ? Number(match[0]) : 0;
  return value > 0 && value <= 1000 ? value : null;
}

export function scaleIngredient(line: string, factor: number) {
  if (factor === 1) return line;
  const match = line.match(leading);
  if (!match) return line;
  const [all, space = "", first = "", joiner, second] = match;
  const scaled = (text: string) => formatQuantity(parseNumber(text) * factor);
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
  const unit = scaled
    .slice(match[0].length)
    .match(
      /^\s*(?:x\s+)?(?:g|kg|ml|l|oz|lb|lbs|tsp|tbsp|tbs|cups?|tins?|cans?|cloves?|bunch(?:es)?|handfuls?|pinch(?:es)?|sprigs?|slices?|sticks?|packs?|pkts?)\b\.?/i,
    );
  const end = match[0].length + (unit?.[0].length ?? 0);
  return { quantity: scaled.slice(0, end).trim(), rest: scaled.slice(end) };
}
