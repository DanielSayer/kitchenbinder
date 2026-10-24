import type { SVGProps } from "react";

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  /** Accessible name. Omit when the mark is decorative. */
  title?: string;
};

const MARK =
  "M10 13Q10 6 17 6H21Q28 6 28 13V29L42 17Q46 13 50 16L52 18Q55 21 51 25L39 35L53 49Q58 54 53 57Q49 61 44 56L28 40V51Q28 58 21 58H17Q10 58 10 51ZM23.5 20a4.5 4.5 0 1 0 -9.0 0a4.5 4.5 0 1 0 9.0 0ZM23.5 44a4.5 4.5 0 1 0 -9.0 0a4.5 4.5 0 1 0 9.0 0Z";
/** Pixel-snapped drawing so both punches stay open at 16px. */
const MARK_16 =
  "M2 3.25Q2 1.5 3.75 1.5H5.25Q7 1.5 7 3.25V7.25L10.75 4.25Q11.75 3.4 12.6 4.25L13 4.7Q13.8 5.5 12.8 6.4L9.8 8.8L13.4 12.4Q14.4 13.5 13.3 14.25Q12.4 15 11.3 13.9L7 10V12.75Q7 14.5 5.25 14.5H3.75Q2 14.5 2 12.75ZM5.5 5a1 1 0 1 0 -2 0a1 1 0 1 0 2 0ZM5.5 11a1 1 0 1 0 -2 0a1 1 0 1 0 2 0Z";

/** Punchline: a k whose spine is a binder page with two punched holes. Fills with currentColor. */
export function BrandMark({ size = 32, title, ...props }: BrandMarkProps) {
  const small = size <= 20;
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: titled when `title` is set, otherwise aria-hidden.
    <svg
      viewBox={small ? "0 0 16 16" : "0 0 64 64"}
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" fillRule="evenodd" d={small ? MARK_16 : MARK} />
    </svg>
  );
}

/** Lowercase wordmark, single weight. The i dots are tomato binder punches. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={className ?? "brand-wordmark"}
      role="img"
      aria-label="kitchenbinder"
    >
      k<span className="brand-punch">ı</span>tchenb
      <span className="brand-punch">ı</span>nder
    </span>
  );
}
