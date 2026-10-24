import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { RecipeCover } from "./recipe-cover";
import type { PantryTone } from "./tones";

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Custom art. Defaults to two tilted covers and a tomato plus. */
  art?: ReactNode;
  /** Words for the default art covers. */
  covers?: readonly [string, string];
  /** Actions: usually one primary button and a ghost alternative. */
  children?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
};

const defaultTones: readonly [PantryTone, PantryTone] = ["sage", "butter"];

/** Calm empty state with one clear next step. */
export function EmptyState({
  title,
  description,
  art,
  covers = ["Chilli", "Wraps"],
  children,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={["pantry-empty", className].filter(Boolean).join(" ")}>
      {art === undefined ? (
        <div className="pantry-empty-art" aria-hidden="true">
          {covers.map((word, index) => (
            <RecipeCover
              key={word}
              title={word}
              word={word}
              tone={defaultTones[index]}
              size="grid"
              className="pantry-empty-cover"
            />
          ))}
          <span className="pantry-empty-plus">
            <Plus size={24} />
          </span>
        </div>
      ) : (
        art
      )}
      <Heading className="pantry-empty-title">{title}</Heading>
      {description ? (
        <p className="pantry-empty-description">{description}</p>
      ) : null}
      {children ? <div className="pantry-empty-actions">{children}</div> : null}
    </div>
  );
}
