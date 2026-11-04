import { useEffect, useRef } from "react";
import { type RecipeDraft, recipeFields } from "./recipe-draft";
import type { RecipeReview } from "./recipe-editor-state";
import { recipeFieldNames } from "./recipe-merge";

export function RecipeConflictReview({
  review,
  preview,
  pending,
  onPreview,
  onChoose,
  onEdit,
  onSaveCopy,
}: {
  review: RecipeReview;
  preview: boolean;
  pending: boolean;
  onPreview: (show: boolean) => void;
  onChoose: (field: keyof RecipeDraft, choice: "mine" | "saved") => void;
  onEdit: () => void;
  onSaveCopy?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="recipe-review" aria-labelledby="recipe-review-title">
      <h2 id="recipe-review-title" tabIndex={-1} ref={heading}>
        {preview ? "Saved recipe" : "Choose what to keep"}
      </h2>
      {preview ? (
        <>
          <p>Your draft is still here. Go back when you're ready.</p>
          <dl className="recipe-review-preview">
            {recipeFieldNames.map(({ name, label }) => (
              <div key={name}>
                <dt>{label}</dt>
                <dd>{recipeFields(review.saved.content)[name] || "Empty"}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            className="button button-outline"
            onClick={() => onPreview(false)}
          >
            Back to choices
          </button>
        </>
      ) : (
        <>
          <p>
            This recipe changed while you were editing. Choose below where both
            versions differ. Other changes are combined for you.
          </p>
          {recipeFieldNames
            .filter((field) => review.conflicts.includes(field.name))
            .map(({ name, label }) => (
              <fieldset className="recipe-review-field" key={name}>
                <legend>{label}</legend>
                <div className="recipe-review-options">
                  {(["mine", "saved"] satisfies ("mine" | "saved")[]).map(
                    (choice) => (
                      <label className="recipe-review-option" key={choice}>
                        <span>
                          <input
                            type="radio"
                            name={`choice-${name}`}
                            value={choice}
                            required
                            checked={review.choices[name] === choice}
                            onChange={() => onChoose(name, choice)}
                          />
                          {choice === "mine" ? "Mine" : "Saved"}
                        </span>{" "}
                        <span className="recipe-review-value">
                          {(choice === "mine"
                            ? review.merged[name]
                            : recipeFields(review.saved.content)[name]) ||
                            "Empty"}
                        </span>
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
            ))}
          <div className="editor-actions">
            <button
              type="button"
              className="button button-outline"
              onClick={onEdit}
            >
              Back to editing
            </button>
            <button type="submit" className="button button-primary">
              {pending ? "Saving..." : "Save recipe"}
            </button>
          </div>
          <div className="recipe-review-alternatives">
            <button
              type="button"
              className="text-button"
              onClick={() => onPreview(true)}
            >
              View saved recipe
            </button>
            {onSaveCopy && (
              <button
                type="button"
                className="text-button"
                onClick={onSaveCopy}
              >
                Save my draft as a copy
              </button>
            )}
          </div>
          {onSaveCopy && (
            <p className="recipe-review-hint">
              Copies are saved to your personal collection.
            </p>
          )}
        </>
      )}
    </section>
  );
}
