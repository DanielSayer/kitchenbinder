import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { BrandMark, type PantryTone, RecipeCover, toneColor } from "./pantry";

/**
 * Welcome illustration: oat blobs, the Punchline mark and two floating recipe
 * cards. `tone` tints the mark (e.g. an invited household's colour).
 */
export function WelcomeArt({
  tone = "tomato",
  sharedWith = "Family",
}: {
  tone?: PantryTone;
  sharedWith?: string;
}) {
  return (
    <div className="welcome-art" aria-hidden="true">
      <span className="welcome-blob welcome-blob-main" />
      <span className="welcome-blob welcome-blob-tomato" />
      <span className="welcome-blob welcome-blob-olive" />
      <span className="welcome-blob welcome-blob-butter" />
      <BrandMark
        size={120}
        className="welcome-mark"
        style={{ color: toneColor(tone) }}
      />
      <div className="welcome-card welcome-card-ready">
        <RecipeCover
          title="Lemon drizzle cake"
          word="L"
          tone="butter"
          size="thumb"
        />
        <div>
          <b>Lemon drizzle cake</b>
          <small>
            <span className="welcome-ready">
              <Check size={10} strokeWidth={3} />
            </span>
            Ready
          </small>
        </div>
      </div>
      <div className="welcome-card welcome-card-shared">
        <RecipeCover
          title="Red lentil dal"
          word="D"
          tone="olive"
          size="thumb"
        />
        <div>
          <b>Red lentil dal</b>
          <small style={{ color: toneColor(tone) } as CSSProperties}>
            Shared with {sharedWith}
          </small>
        </div>
      </div>
    </div>
  );
}

/** Full-height welcome layout: art on top, message, actions in thumb zone. */
export function WelcomeScreen({
  art,
  title,
  accent,
  lead,
  children,
  footer,
}: {
  art: ReactNode;
  title: ReactNode;
  accent?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main id="main-content" className="welcome-page">
      <div className="welcome">
        {art}
        <div className="welcome-copy">
          <h1>
            {title}
            {accent ? (
              <>
                <br />
                <i>{accent}</i>
              </>
            ) : null}
          </h1>
          {lead ? <p className="welcome-lead">{lead}</p> : null}
        </div>
        <div className="welcome-actions">{children}</div>
        {footer ? <div className="welcome-footer">{footer}</div> : null}
      </div>
    </main>
  );
}
