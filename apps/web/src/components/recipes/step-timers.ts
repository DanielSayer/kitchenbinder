// Durations mentioned in a method step ("Roast for 25 minutes", "1 hr 30 mins").

export type StepDuration = {
  /** Text as written, e.g. "25 minutes". */
  text: string;
  start: number;
  end: number;
  seconds: number;
};

const amount = String.raw`\d+(?:[.,]\d+)?|an?|half an?`;
const unit = "hours?|hrs?|minutes?|mins?|seconds?|secs?";
const pattern = new RegExp(
  String.raw`\b(${amount})(?:\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?\s*(${unit})\b`,
  "gi",
);

function amountOf(text: string) {
  const value = text.toLowerCase();
  if (value === "a" || value === "an") return 1;
  if (value.startsWith("half")) return 0.5;
  return Number(value.replace(",", "."));
}

function unitSeconds(text: string) {
  const value = text.toLowerCase();
  if (value.startsWith("h")) return 3600;
  if (value.startsWith("m")) return 60;
  return 1;
}

/** Durations in reading order. Ranges use the lower bound; "1 hr 30 mins" merges. */
export function stepDurations(step: string): StepDuration[] {
  const found: StepDuration[] = [];
  for (const match of step.matchAll(pattern)) {
    const [text, value = "", , unitText = ""] = match;
    const seconds = Math.round(amountOf(value) * unitSeconds(unitText));
    if (!(seconds > 0) || seconds > 24 * 3600) continue;
    const start = match.index ?? 0;
    const previous = found.at(-1);
    if (
      previous &&
      unitSeconds(unitText) < 3600 &&
      previous.seconds % 3600 === 0 &&
      /^\s*(?:and\s+)?$/i.test(step.slice(previous.end, start))
    ) {
      previous.seconds += seconds;
      previous.end = start + text.length;
      previous.text = step.slice(previous.start, previous.end);
      continue;
    }
    found.push({ text, start, end: start + text.length, seconds });
  }
  return found;
}

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

const quantityPrefix =
  /^[\s\d¼½¾⅓⅔⅛.,/–-]*(?:x\s+)?(?:g|kg|ml|l|oz|lb|lbs|tsp|tbsp|tbs|cups?|tins?|cans?|cloves?|bunch(?:es)?|handfuls?|pinch(?:es)?|sprigs?|slices?|sticks?|packs?)?\b\.?\s*(?:of\s+)?/i;

/** Short display name for an ingredient line: "800 g cherry tomatoes, halved" → "cherry tomatoes". */
export function ingredientName(line: string) {
  return line
    .replace(quantityPrefix, "")
    .split(/[,(;]/)[0]
    ?.trim()
    .replace(/\s+/g, " ");
}

function stem(word: string) {
  return word
    .toLowerCase()
    .replace(/(?:es|s)$/, "")
    .replace(/[^a-z]/g, "");
}

/** Ingredients whose key word appears in the step, in ingredient order (max 4). */
export function ingredientsUsed(step: string, ingredients: readonly string[]) {
  const words = new Set(
    step
      .split(/[^A-Za-z]+/)
      .filter(Boolean)
      .map(stem),
  );
  const used: string[] = [];
  for (const line of ingredients) {
    const name = ingredientName(line);
    if (!name) continue;
    const key = stem(name.split(" ").at(-1) ?? "");
    if (key.length > 2 && words.has(key) && !used.includes(name))
      used.push(name);
    if (used.length === 4) break;
  }
  return used;
}
