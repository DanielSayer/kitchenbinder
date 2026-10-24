import type { ReactNode } from "react";

type LargeTitleProps = {
  children: ReactNode;
  /** Tomato tail, e.g. "cooking?" in "What are we cooking?". */
  accent?: ReactNode;
  /** Small line under the title. */
  sub?: ReactNode;
  /** Small line above the title (greeting, date...). */
  eyebrow?: ReactNode;
  /** Trailing controls aligned with the title (e.g. list/grid toggle). */
  actions?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
};

/** Page title in Nunito 36/800 with an optional tomato accent. */
export function LargeTitle({
  children,
  accent,
  sub,
  eyebrow,
  actions,
  as: Heading = "h1",
  className,
}: LargeTitleProps) {
  return (
    <div className={["pantry-title", className].filter(Boolean).join(" ")}>
      <div className="pantry-title-text">
        {eyebrow ? <p className="pantry-title-eyebrow">{eyebrow}</p> : null}
        <Heading className="pantry-large">
          {children}
          {accent ? (
            <>
              {" "}
              <i>{accent}</i>
            </>
          ) : null}
        </Heading>
        {sub ? <p className="pantry-title-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="pantry-title-actions">{actions}</div> : null}
    </div>
  );
}
