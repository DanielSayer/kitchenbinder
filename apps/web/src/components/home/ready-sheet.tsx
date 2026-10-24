import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import type { RecipePhoto } from "@prep-sheet/db/recipe-photo";
import { Link2, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { RecipeCover, Sheet, toneForTags } from "@/components/pantry";
import { ErrorNotice } from "../feedback";
import { type Destination, DestinationPicker } from "./destination";

export type ReadyRecipe = {
  id?: string;
  content: RecipeContent;
  sourceUrl?: string | null;
  photo?: RecipePhoto | null;
  tags?: { id: string; name: string }[];
};

/** "1 h 10", "45 min" or null. */
export function compactMinutes(minutes: number | null) {
  if (minutes === null || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
}

export function recipeMinutes(content: RecipeContent) {
  const parts =
    content.prepMinutes !== null || content.cookMinutes !== null
      ? (content.prepMinutes ?? 0) + (content.cookMinutes ?? 0)
      : null;
  return content.totalMinutes ?? parts;
}

function sourceHost(url?: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * "Ready to save": cover, facts at a glance, where it goes, one Save button.
 * Stays mounted while closed so it can animate out.
 */
export function ReadySheet({
  open,
  onOpenChange,
  recipe,
  destination,
  onDestinationChange,
  onSave,
  saving,
  error,
  secondary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: ReadyRecipe | null;
  destination: Destination;
  onDestinationChange: (value: Destination) => void;
  onSave: () => void;
  saving: boolean;
  error?: string;
  /** Quieter actions under Save (review details, discard...). */
  secondary?: ReactNode;
}) {
  const content = recipe?.content;
  const title = content?.title ?? "Your recipe";
  const time = content ? compactMinutes(recipeMinutes(content)) : null;
  const host = sourceHost(recipe?.sourceUrl);
  const tags = recipe?.tags ?? [];
  const peek = content?.ingredients.slice(0, 4) ?? [];
  const more = (content?.ingredients.length ?? 0) - peek.length;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Ready to save: ${title}`}
      hideTitle
      className="ready-sheet"
      footer={
        <>
          <button
            type="button"
            className="button button-primary button-block"
            disabled={saving || !content}
            onClick={onSave}
          >
            {saving && (
              <LoaderCircle size={18} className="spin" aria-hidden="true" />
            )}
            Save recipe
          </button>
          {secondary ? (
            <div className="ready-secondary">{secondary}</div>
          ) : null}
        </>
      }
    >
      {content ? (
        <>
          <RecipeCover
            id={recipe?.id}
            title={title}
            photo={recipe?.photo}
            tone={toneForTags(tags.map((tag) => tag.name))}
            size="hero"
            className="ready-cover"
          />
          <h3 className="ready-title">{title}</h3>
          {host && (
            <p className="ready-source">
              <Link2 size={13} aria-hidden="true" /> From {host}
            </p>
          )}
          <dl className="ready-facts">
            <div>
              <dt>Total time</dt>
              <dd>{time ?? "—"}</dd>
            </div>
            <div>
              <dt>Serves</dt>
              <dd>{content.servings?.trim() || "—"}</dd>
            </div>
            <div>
              <dt>Ingredients</dt>
              <dd>{content.ingredients.length}</dd>
            </div>
          </dl>
          {tags.length > 0 && (
            <ul className="ready-tags" aria-label="Tags">
              {tags.map((tag) => (
                <li key={tag.id}>{tag.name}</li>
              ))}
            </ul>
          )}
          {peek.length > 0 && (
            <ul className="ready-peek" aria-label="Ingredients">
              {peek.map((item, index) => (
                <li key={`${index}:${item}`}>{item}</li>
              ))}
              {more > 0 && <li className="ready-more">+{more} more</li>}
            </ul>
          )}
          <DestinationPicker
            value={destination}
            onChange={onDestinationChange}
            disabled={saving}
          />
          <ErrorNotice message={error} />
        </>
      ) : (
        <p className="ready-loading" role="status">
          {error ? null : (
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
          )}
          {error ?? "Getting your recipe…"}
        </p>
      )}
    </Sheet>
  );
}
