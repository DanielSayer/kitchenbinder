/** Readable servings label: bare numbers/ranges become "Serves 4"; "12 cookies" stays. */
export function formatServings(servings: string | null | undefined) {
  const text = servings?.trim();
  if (!text) return null;
  return /^\d+(\s*[-–]\s*\d+)?$/.test(text) ? `Serves ${text}` : text;
}
