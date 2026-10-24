export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function noon(value: string) {
  return new Date(`${value}T12:00:00`);
}
export function addDays(value: string, days: number) {
  const date = noon(value);
  date.setDate(date.getDate() + days);
  return localDate(date);
}
export function weekStart(value: string) {
  const day = noon(value).getDay();
  return addDays(value, -(day === 0 ? 6 : day - 1));
}
export function weekDays(start: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}
export function dateLabel(value: string) {
  return noon(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
/** "24 Oct" */
export function shortDate(value: string) {
  return noon(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}
/** "Saturday" or "Sat" */
export function weekday(value: string, style: "long" | "short" = "long") {
  return noon(value).toLocaleDateString("en-AU", { weekday: style });
}
export function dayOfMonth(value: string) {
  return noon(value).getDate();
}
/** "19 – 25 October", or "29 Sep – 5 Oct" across months. */
export function weekRangeLabel(start: string) {
  const end = addDays(start, 6);
  const first = noon(start);
  const last = noon(end);
  if (first.getMonth() === last.getMonth())
    return `${first.getDate()} – ${last.toLocaleDateString("en-AU", { day: "numeric", month: "long" })}`;
  return `${shortDate(start)} – ${shortDate(end)}`;
}
/** Whole weeks between two Monday dates. */
export function weeksBetween(from: string, to: string) {
  return Math.round((noon(to).getTime() - noon(from).getTime()) / 604800000);
}
