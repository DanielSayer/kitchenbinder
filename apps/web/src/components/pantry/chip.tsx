import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { type PantryTone, toneColor } from "./tones";

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Toggle state. Omit for plain action chips (e.g. idea suggestions). */
  pressed?: boolean;
  /** Small coloured dot before the label. */
  dot?: PantryTone;
};

/** Pill button for filters and suggestions. Pressed chips turn ink. */
export function Chip({
  pressed,
  dot,
  className,
  children,
  type = "button",
  ...props
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={["pantry-chip", className].filter(Boolean).join(" ")}
      {...props}
    >
      {dot ? (
        <i
          className="pantry-chip-dot"
          style={{ background: toneColor(dot) }}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </button>
  );
}

/** Horizontally scrolling chip row. */
export function ChipRow({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["pantry-chips", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
