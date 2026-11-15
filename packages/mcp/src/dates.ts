export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
export function thisWeek(weekStartsOn: number, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -((day - weekStartsOn + 7) % 7));
  return { start, end: addDays(start, 6) };
}
