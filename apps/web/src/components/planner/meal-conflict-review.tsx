import { useEffect, useRef } from "react";
import {
  type MealConflict,
  type MealDraft,
  mealFieldLabels,
} from "./meal-draft";
import type { MealReview } from "./meal-editor-state";

export function MealConflictReview({
  review,
  formId,
  reviewValue,
  onChoose,
}: {
  review: MealReview;
  formId: string;
  reviewValue: (fields: MealDraft, field: MealConflict) => string;
  onChoose: (field: MealConflict, choice: "mine" | "saved") => void;
}) {
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    reviewHeading.current?.focus();
  }, []);
  return (
    <section className="meal-review" aria-labelledby={`${formId}-review`}>
      <h3 id={`${formId}-review`} tabIndex={-1} ref={reviewHeading}>
        Review changed meal
      </h3>
      <p>
        The saved plan changed. Choose what to keep before saving. Your draft is
        still stored.
      </p>
      {review.conflicts.map((field) => (
        <fieldset key={field} className="meal-review-choice">
          <legend>{mealFieldLabels[field]}</legend>
          {(["mine", "saved"] as const)
            .filter((choice) => field !== "deleted" || choice === "mine")
            .map((choice) => (
              <label className="pick-row" key={choice}>
                <input
                  type="radio"
                  className="pick-input"
                  name={`${formId}-review-${field}`}
                  checked={review.choices[field] === choice}
                  onChange={() => onChoose(field, choice)}
                />
                <span className="pick-text">
                  <b>{choice === "mine" ? "My draft" : "Saved meal"}</b>{" "}
                  <small>
                    {reviewValue(
                      choice === "saved" && review.saved
                        ? review.saved
                        : review.merged,
                      field,
                    )}
                  </small>
                </span>
                <span className="pick-mark" aria-hidden="true" />
              </label>
            ))}
          {field === "deleted" && (
            <p className="meal-sheet-hint">
              This meal was deleted. Saving recreates it. Close to keep the
              draft without recreating it.
            </p>
          )}
        </fieldset>
      ))}
    </section>
  );
}
