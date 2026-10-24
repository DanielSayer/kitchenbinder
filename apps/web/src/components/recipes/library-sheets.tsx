import { Check, CookingPot, Heart, Star } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet } from "@/components/pantry";
import type { RecipeSort } from "./recipe-list";
import { TagChoices } from "./tag-choices";

export type LibrarySort = RecipeSort | "position";

export const sortLabels: Record<LibrarySort, string> = {
  position: "Collection order",
  newest: "Recently added",
  "last-cooked": "Last cooked",
  "highest-rated": "Highest rated",
  name: "Name",
  "cooking-time": "Cooking time",
};

export function SortSheet({
  open,
  onOpenChange,
  value,
  onChange,
  inCollection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: LibrarySort;
  onChange: (value: LibrarySort) => void;
  inCollection: boolean;
}) {
  const options = (Object.keys(sortLabels) as LibrarySort[]).filter(
    (option) => inCollection || option !== "position",
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Sort recipes">
      <fieldset className="pantry-list sheet-radios">
        <legend className="pantry-visually-hidden">Sort by</legend>
        {options.map((option) => (
          <label key={option} className="pantry-row pick-row">
            <input
              type="radio"
              name="recipe-sort"
              value={option}
              checked={option === value}
              onChange={() => {
                onChange(option);
                onOpenChange(false);
              }}
            />
            <span className="pantry-row-text">
              <b>{sortLabels[option]}</b>
            </span>
            <span className="pick-radio" aria-hidden="true" />
          </label>
        ))}
      </fieldset>
    </Sheet>
  );
}

export type LibraryFilters = {
  favourites?: boolean;
  unrated?: boolean;
  neverCooked?: boolean;
  cookedBefore?: string;
  tags?: string;
};

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="pantry-row pick-row"
      onClick={onToggle}
    >
      <span className="pantry-row-icon">{icon}</span>
      <span className="pantry-row-text">
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className="pick-check" aria-hidden="true">
        <Check size={16} />
      </span>
    </button>
  );
}

export function FilterSheet({
  open,
  onOpenChange,
  filters,
  tags,
  selectedTags,
  onChange,
  onClear,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: LibraryFilters;
  tags: { id: string; name: string; description?: string }[];
  selectedTags: string[];
  onChange: (next: LibraryFilters) => void;
  onClear: () => void;
  total?: number;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filter recipes"
      desktop="side"
      footer={
        <>
          <button
            type="button"
            className="button button-primary button-block"
            onClick={() => onOpenChange(false)}
          >
            {total === undefined
              ? "Done"
              : `Show ${total} ${total === 1 ? "recipe" : "recipes"}`}
          </button>
          <button
            type="button"
            className="button button-ghost button-block"
            onClick={onClear}
          >
            Clear filters
          </button>
        </>
      }
    >
      <div className="pantry-list">
        <ToggleRow
          icon={<Heart size={20} aria-hidden="true" />}
          label="Favourites"
          checked={!!filters.favourites}
          onToggle={() =>
            onChange({ favourites: filters.favourites ? undefined : true })
          }
        />
        <ToggleRow
          icon={<Star size={20} aria-hidden="true" />}
          label="Not rated"
          hint="Recipes you haven't rated yet"
          checked={!!filters.unrated}
          onToggle={() =>
            onChange({ unrated: filters.unrated ? undefined : true })
          }
        />
        <ToggleRow
          icon={<CookingPot size={20} aria-hidden="true" />}
          label="Never cooked"
          checked={!!filters.neverCooked}
          onToggle={() =>
            onChange({
              neverCooked: filters.neverCooked ? undefined : true,
              cookedBefore: undefined,
            })
          }
        />
      </div>
      <label className="sheet-field sheet-group">
        <span>Last cooked before</span>
        <input
          type="date"
          value={filters.cookedBefore ?? ""}
          onChange={(event) =>
            onChange({
              cookedBefore: event.target.value || undefined,
              neverCooked: undefined,
            })
          }
        />
      </label>
      {tags.length ? (
        <fieldset className="sheet-fieldset">
          <legend className="sheet-label">Tags</legend>
          <TagChoices
            tags={tags}
            selected={selectedTags}
            toggle={(id) => {
              const next = selectedTags.includes(id)
                ? selectedTags.filter((tag) => tag !== id)
                : [...selectedTags, id];
              onChange({ tags: next.length ? next.join(",") : undefined });
            }}
          />
        </fieldset>
      ) : null}
    </Sheet>
  );
}
