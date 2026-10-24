/** Marker colours shared by households, covers, chips and binder tabs. */
export const pantryTones = [
  "tomato",
  "olive",
  "butter",
  "plum",
  "sage",
] as const;

export type PantryTone = (typeof pantryTones)[number];

export function isPantryTone(value: unknown): value is PantryTone {
  return pantryTones.includes(value as PantryTone);
}

/** Solid marker colour, e.g. for dots and tab underlines. */
export function toneColor(tone: PantryTone) {
  return `var(--${tone})`;
}

/** Stable 32-bit FNV-1a hash, so tints match on server and client. */
export function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic tone for any seed (recipe id, title, collection id...). */
export function toneFor(seed: string): PantryTone {
  return pantryTones[hashString(seed) % pantryTones.length] ?? "tomato";
}
