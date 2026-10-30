// Planner meal suggestions: pure ranking over household signals.
// See docs/meal-suggestions.md.
import type { RecipePhoto } from "@prep-sheet/db/recipe-photo";

export type SuggestionCandidate = {
  id: string;
  title: string;
  photo: RecipePhoto | null;
  ownerId: string | null;
  servings: string | null;
  createdAt: string;
  /** Household average, null when nobody rated it. */
  rating: number | null;
  favourite: boolean;
  /** Latest planned or cooked date, null when never had. */
  lastHad: string | null;
  tagIds: string[];
};
export type Suggestion = Omit<SuggestionCandidate, "tagIds" | "createdAt">;
export type SuggestionRow = {
  key: "favourites" | "forgotten" | "untried";
  items: Suggestion[];
};

export const suggestionRowSize = 6;
const poolSize = 15;
const tagCap = 2;
const favouriteDays = 21;
const forgottenDays = 60;
const lowRating = 2.5;

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

// FNV-1a seed into mulberry32: stable for the same household, week and shuffle.
export function seededRandom(seed: string) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++)
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rowOf(candidate: SuggestionCandidate, today: string) {
  if (!candidate.lastHad) return "untried";
  const days = daysBetween(candidate.lastHad, today);
  if (
    days >= favouriteDays &&
    (candidate.favourite || (candidate.rating ?? 0) >= 4)
  )
    return "favourites";
  if (days >= forgottenDays) return "forgotten";
  return null;
}

// Best first: oldest "last had", then highest rated; untried newest first.
function compare(key: SuggestionRow["key"]) {
  return (a: SuggestionCandidate, b: SuggestionCandidate) =>
    (key === "untried"
      ? b.createdAt.localeCompare(a.createdAt)
      : (a.lastHad ?? "").localeCompare(b.lastHad ?? "")) ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    a.id.localeCompare(b.id);
}

export function suggest(
  candidates: SuggestionCandidate[],
  {
    today,
    seed,
    excludeIds,
  }: { today: string; seed: string; excludeIds: Set<string> },
): SuggestionRow[] {
  const random = seededRandom(seed);
  const rows: SuggestionRow["key"][] = ["favourites", "forgotten", "untried"];
  const buckets = new Map(
    rows.map((key) => [key, [] as SuggestionCandidate[]]),
  );
  for (const candidate of candidates) {
    if (excludeIds.has(candidate.id)) continue;
    if (candidate.rating !== null && candidate.rating < lowRating) continue;
    const key = rowOf(candidate, today);
    if (key) buckets.get(key)?.push(candidate);
  }
  return rows.map((key) => {
    const pool = (buckets.get(key) ?? []).sort(compare(key)).slice(0, poolSize);
    // Weighted shuffle (Efraimidis–Spirakis): better-ranked items lead more often.
    const shuffled = pool
      .map((item, rank) => ({
        item,
        order: random() ** (1 / (poolSize - rank)),
      }))
      .sort((a, b) => b.order - a.order)
      .map(({ item }) => item);
    const picked: SuggestionCandidate[] = [];
    const perTag = new Map<string, number>();
    for (const item of shuffled) {
      if (picked.length === suggestionRowSize) break;
      if (item.tagIds.some((tag) => (perTag.get(tag) ?? 0) >= tagCap)) continue;
      for (const tag of item.tagIds)
        perTag.set(tag, (perTag.get(tag) ?? 0) + 1);
      picked.push(item);
    }
    return {
      key,
      items: picked.map(({ tagIds: _, createdAt: __, ...item }) => item),
    };
  });
}
