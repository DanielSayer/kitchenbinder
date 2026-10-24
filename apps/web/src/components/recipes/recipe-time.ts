import type { RecipeContent } from "@prep-sheet/db/recipe-content";

type RecipeTimes = Pick<RecipeContent, "prepMinutes" | "cookMinutes"> & {
  totalMinutes?: RecipeContent["totalMinutes"];
};

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

export function recipeTimeSummary({
  prepMinutes,
  cookMinutes,
  totalMinutes,
}: RecipeTimes) {
  const elapsed = totalMinutes ?? null;

  if (prepMinutes !== null && cookMinutes !== null) {
    const active = prepMinutes + cookMinutes;
    const summary = `${formatMinutes(active)} active`;

    return elapsed !== null && elapsed > active
      ? `${summary} · ${formatMinutes(elapsed)} elapsed`
      : summary;
  }

  const parts: string[] = [];
  if (cookMinutes !== null) parts.push(`${formatMinutes(cookMinutes)} cooking`);
  if (prepMinutes !== null) parts.push(`${formatMinutes(prepMinutes)} prep`);

  if (prepMinutes === null && cookMinutes === null) {
    parts.push("Prep and cooking unknown");
  } else if (prepMinutes === null) {
    parts.push("prep unknown");
  } else {
    parts.push("cooking unknown");
  }

  if (elapsed !== null) parts.push(`${formatMinutes(elapsed)} elapsed`);
  return parts.join(" · ");
}

export function sortableRecipeMinutes({
  prepMinutes,
  cookMinutes,
  totalMinutes,
}: RecipeTimes) {
  if (
    totalMinutes != null &&
    (prepMinutes === null ||
      cookMinutes === null ||
      totalMinutes >= prepMinutes + cookMinutes)
  ) {
    return totalMinutes;
  }
  if (prepMinutes === null || cookMinutes === null) return null;
  return prepMinutes + cookMinutes;
}

/** Compact time for cards and facts: "45 min", "1 h 10", or null when unknown. */
export function shortRecipeTime(times: RecipeTimes) {
  const minutes = sortableRecipeMinutes(times);
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
}
