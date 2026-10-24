import { type CSSProperties, useState } from "react";
import { type PantryTone, toneFor } from "./tones";

export type RecipeCoverSize = "thumb" | "list" | "grid" | "hero" | "detail";

export type RecipeCoverProps = {
  /** Stable seed for the tint. Falls back to the title. */
  id?: string;
  title: string;
  photoUrl?: string | null;
  /** Override the hashed tint, e.g. from the recipe's main tag. */
  tone?: PantryTone;
  /** Override the word picked from the title. */
  word?: string;
  size?: RecipeCoverSize;
  className?: string;
  style?: CSSProperties;
};

const smallSizes = new Set<RecipeCoverSize>(["thumb", "list"]);
const splitters =
  /\s(?:with|in|on|for|from|over|served|topped)\s|[,:;(–—|]|\s-\s/i;
const filler = new Set([
  "a",
  "an",
  "the",
  "my",
  "mum's",
  "nan's",
  "easy",
  "quick",
  "best",
  "simple",
  "classic",
  "homemade",
]);

/** The key noun of a title: the last word before "with", "in", commas, etc. */
export function coverWord(title: string) {
  const head = title.split(splitters)[0] ?? title;
  const words = head
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, ""))
    .filter((word) => word && !filler.has(word.toLowerCase()));
  const word = words.at(-1) ?? title.trim().split(/\s+/)[0] ?? "";
  if (!word) return "Recipe";
  return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLowerCase();
}

/** Coarse tag-to-tone map from the design: veg olive, baking butter... */
export function toneForTags(tags: readonly string[]): PantryTone | undefined {
  const names = tags.map((tag) => tag.toLowerCase());
  const has = (...keys: string[]) =>
    names.some((name) => keys.some((key) => name.includes(key)));
  if (has("veg", "salad", "plant")) return "olive";
  if (has("bak", "bread", "cake", "pastry")) return "butter";
  if (has("fish", "seafood")) return "sage";
  if (has("dessert", "sweet", "pudding")) return "plum";
  if (has("main", "dinner", "meat")) return "tomato";
  return undefined;
}

/**
 * Recipe image slot: the photo when there is one, otherwise a tinted tile with
 * one italic word (or its initial at small sizes). Tint is deterministic.
 */
export function RecipeCover({
  id,
  title,
  photoUrl,
  tone,
  word,
  size = "grid",
  className,
  style,
}: RecipeCoverProps) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl) && !failed;
  const resolvedTone = tone ?? toneFor(id ?? title);
  const label = word ?? coverWord(title);
  const text = smallSizes.has(size) ? label.charAt(0) : label;
  const classes = ["pantry-cover", className].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      data-size={size}
      data-tone={showPhoto ? undefined : resolvedTone}
      data-photo={showPhoto || undefined}
      style={style}
    >
      {showPhoto ? (
        <img
          src={photoUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <b aria-hidden="true">{text}</b>
      )}
    </div>
  );
}
