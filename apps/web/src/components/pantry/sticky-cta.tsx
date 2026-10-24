import type { HTMLAttributes } from "react";

type StickyCtaProps = HTMLAttributes<HTMLDivElement>;

/**
 * Bottom action bar for a screen's one tomato button.
 * Render it as the last child of the page's <main>. It sticks above the mobile
 * tab bar (and the home indicator safe area) and sits inline-sticky on desktop,
 * so it never covers the last row of content.
 */
export function StickyCta({ className, children, ...props }: StickyCtaProps) {
  return (
    <div
      className={["pantry-sticky-cta", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
