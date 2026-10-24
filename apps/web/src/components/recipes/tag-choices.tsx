import { Check, Tag } from "lucide-react";
export function TagChoices({
  tags,
  selected,
  toggle,
  disabled = false,
}: {
  tags: { id: string; name: string; description?: string }[];
  selected: string[];
  toggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tag-choices">
      {tags.map((tag) => {
        return (
          <button
            type="button"
            key={tag.id}
            className="tag-choice"
            aria-pressed={selected.includes(tag.id)}
            disabled={disabled}
            title={tag.description}
            onClick={() => toggle(tag.id)}
          >
            {selected.includes(tag.id) ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Tag size={14} aria-hidden="true" />
            )}
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
