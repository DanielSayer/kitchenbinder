import { Plus } from "lucide-react";
import { type CSSProperties, useRef } from "react";
import { nextRovingIndex } from "./roving";
import { type PantryTone, toneColor } from "./tones";

export type BinderTab = {
  id: string;
  label: string;
  /** Marker colour for the dot and selected underline. */
  tone?: PantryTone;
};

type BinderTabsProps = {
  tabs: readonly BinderTab[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list, e.g. "Collections". */
  label: string;
  /** Shows the trailing "+" divider when provided. */
  onAdd?: () => void;
  addLabel?: string;
  /** id of the tabpanel these tabs control (optional). */
  panelId?: string;
  className?: string;
};

/** Binder-divider tabs: All · collection … · +. Scrolls horizontally. */
export function BinderTabs({
  tabs,
  value,
  onChange,
  label,
  onAdd,
  addLabel = "New collection",
  panelId,
  className,
}: BinderTabsProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  );
  return (
    <div className={["pantry-binder", className].filter(Boolean).join(" ")}>
      <div role="tablist" aria-label={label} className="pantry-binder-list">
        {tabs.map((tab, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              className="pantry-divider"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              style={
                tab.tone
                  ? ({ "--hc": toneColor(tab.tone) } as CSSProperties)
                  : undefined
              }
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => {
                const next = nextRovingIndex(event, index, tabs.length);
                const target = next === undefined ? undefined : tabs[next];
                if (next === undefined || !target) return;
                onChange(target.id);
                buttons.current[next]?.focus();
              }}
            >
              {tab.tone ? <b aria-hidden="true" /> : null}
              {tab.label}
            </button>
          );
        })}
      </div>
      {onAdd ? (
        <button
          type="button"
          className="pantry-divider pantry-divider-add"
          aria-label={addLabel}
          title={addLabel}
          onClick={onAdd}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
