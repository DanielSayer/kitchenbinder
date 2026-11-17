// Accounts have no saved timezone yet, so "this week" uses Brisbane.
const timeZone = "Australia/Brisbane";

export type DateRange = { start: string; end: string };

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function thisWeek(weekStartsOn: number, now = new Date()): DateRange {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -((day - weekStartsOn + 7) % 7));
  return { start, end: addDays(start, 6) };
}

/**
 * Fill in an inclusive range: a missing bound is a week from the other one,
 * and no bounds means `defaultWeek()`.
 */
export async function weekRange(
  { start, end }: Partial<DateRange>,
  defaultWeek: () => Promise<DateRange>,
): Promise<DateRange> {
  if (start) return { start, end: end ?? addDays(start, 6) };
  if (end) return { start: addDays(end, -6), end };
  return defaultWeek();
}
