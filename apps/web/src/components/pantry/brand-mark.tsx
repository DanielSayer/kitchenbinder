import type { SVGProps } from "react";

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  /** Accessible name. Omit when the mark is decorative. */
  title?: string;
  /** Colour of the spoon dot. Defaults to tomato. The stroke uses currentColor. */
  dotColor?: string;
};

/** The ring spoon: a binder ring and spoon handle forming a lowercase "b". */
export function BrandMark({
  size = 32,
  title,
  dotColor = "var(--mark-dot, #c2412d)",
  ...props
}: BrandMarkProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: titled when `title` is set, otherwise aria-hidden.
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <rect x="14" y="5" width="9" height="40" rx="4.5" fill="currentColor" />
      <circle
        cx="36"
        cy="40"
        r="15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
      />
      <circle cx="36" cy="40" r="4" fill={dotColor} />
    </svg>
  );
}

/** Lowercase wordmark: "kitchen" roman, "binder" italic. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ?? "brand-wordmark"}>
      kitchen<i>binder</i>
    </span>
  );
}
