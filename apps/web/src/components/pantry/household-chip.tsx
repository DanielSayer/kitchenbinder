import { ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { type PantryTone, toneColor } from "./tones";

type HouseholdChipProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "color" | "children"
> & {
  name: string;
  color: PantryTone;
  /** Whether the household sheet this chip opens is currently open. */
  expanded?: boolean;
};

/** Header chip "Family ▾" in the household colour. Presentational only. */
export function HouseholdChip({
  name,
  color,
  expanded,
  className,
  style,
  type = "button",
  ...props
}: HouseholdChipProps) {
  return (
    <button
      type={type}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={`Household: ${name}. Switch household`}
      className={["pantry-household-chip", className].filter(Boolean).join(" ")}
      style={{ "--hc": toneColor(color), ...style } as CSSProperties}
      data-tone={color}
      {...props}
    >
      <i aria-hidden="true" />
      <span>{name}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  );
}
