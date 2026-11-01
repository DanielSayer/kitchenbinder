// Servings scaling for free-text ingredient lines: only the leading quantity
// ("1 1/2", "½", "2-3", "400g") is scaled; everything else is left as written.

import {
  parseQuantity,
  quantityPattern,
  readUnit,
} from "@prep-sheet/db/ingredients";

const leading = new RegExp(
  String.raw`^(\s*)(${quantityPattern})(?:(\s*(?:-|–|to)\s*)(${quantityPattern}))?`,
);

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
