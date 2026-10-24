import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import { Check, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Segmented } from "@/components/pantry";
import { ingredientKeys, useIngredientProgress } from "./ingredient-progress";
import { parseServings, splitQuantity } from "./scale-ingredients";

type Pane = "ingredients" | "method";
const panes = [
  { value: "ingredients", label: "Ingredients" },
  { value: "method", label: "Method" },
] as const;

export function ServingsStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="servings-stepper">
      <button
        type="button"
        aria-label="Fewer servings"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        <Minus size={18} aria-hidden="true" />
      </button>
      <span className="servings-value" aria-live="polite">
        {value} {value === 1 ? "serve" : "serves"}
      </span>
      <button
        type="button"
        aria-label="More servings"
        disabled={value >= 99}
        onClick={() => onChange(Math.min(99, value + 1))}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Ingredients (tickable, scaled to the chosen servings) and method. Mobile
 * switches between them with a segmented control; desktop shows both.
 */
export function RecipeBody({
  content,
  progressKey,
  servings: controlledServings,
  onServingsChange,
  progress,
}: {
  content: RecipeContent;
  progressKey?: string;
  servings?: number | null;
  onServingsChange?: (servings: number) => void;
  /** Shared ingredient progress (e.g. with cook mode); else kept here. */
  progress?: ReturnType<typeof useIngredientProgress>;
}) {
  const own = useIngredientProgress(progress ? undefined : progressKey);
  const { checked, update, storageFailed } = progress ?? own;
  const [pane, setPane] = useState<Pane>("ingredients");
  const base = parseServings(content.servings);
  const [ownServings, setOwnServings] = useState(base);
  const servings = controlledServings ?? ownServings ?? base;
  const setServings = onServingsChange ?? setOwnServings;
  const factor = base && servings ? servings / base : 1;
  const keys = ingredientKeys(content.ingredients);
  const currentChecks = new Set(keys.filter((key) => checked.has(key)));

  return (
    <div className="recipe-body" data-pane={pane}>
      <Segmented
        className="recipe-panes"
        options={panes}
        value={pane}
        onChange={setPane}
        label="Show"
      />
      <section
        className="recipe-pane recipe-pane-ingredients"
        aria-labelledby="ingredients-heading"
      >
        {base && servings ? (
          <h2
            id="ingredients-heading"
            tabIndex={-1}
            className="pantry-visually-hidden"
          >
            Ingredients
          </h2>
        ) : (
          <div className="recipe-pane-head">
            <h2 id="ingredients-heading" tabIndex={-1}>
              Ingredients
            </h2>
            {content.servings ? (
              <span className="recipe-servings-note">
                Serves {content.servings}
              </span>
            ) : null}
          </div>
        )}
        <div
          className="ingredient-progress"
          data-scalable={base && servings ? "" : undefined}
        >
          <span className="ingredient-progress-count">
            {currentChecks.size} of {content.ingredients.length} checked
            <button
              type="button"
              className="text-button"
              disabled={currentChecks.size === 0}
              onClick={() => update(new Set())}
            >
              Reset
            </button>
          </span>
          {base && servings ? (
            <ServingsStepper value={servings} onChange={setServings} />
          ) : null}
        </div>
        {storageFailed && (
          <p className="muted" role="status">
            Progress cannot be saved on this device. Keep this recipe open to
            retain your checks.
          </p>
        )}
        <ul className="recipe-ingredients">
          {content.ingredients.map((ingredient, index) => {
            const key = keys[index] ?? "";
            const { quantity, rest } = splitQuantity(ingredient, factor);
            return (
              <li key={key}>
                <label className="ingredient-row">
                  <input
                    type="checkbox"
                    className="ingredient-input"
                    checked={currentChecks.has(key)}
                    onChange={() => {
                      if (!key) return;
                      const next = new Set(currentChecks);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      update(next);
                    }}
                  />
                  <span className="ingredient-check" aria-hidden="true">
                    <Check size={16} />
                  </span>
                  <span className="ingredient-text">
                    {quantity ? <b>{quantity}</b> : null}
                    {rest}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
      <section
        className="recipe-pane recipe-pane-method"
        aria-labelledby="method-heading"
      >
        <div className="recipe-pane-head">
          <h2 id="method-heading" tabIndex={-1}>
            Method
          </h2>
        </div>
        <ol className="recipe-method">
          {content.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        {content.notes && (
          <section className="recipe-notes" aria-labelledby="notes-heading">
            <h3 id="notes-heading">Kitchen notes</h3>
            <p>{content.notes}</p>
          </section>
        )}
      </section>
    </div>
  );
}
