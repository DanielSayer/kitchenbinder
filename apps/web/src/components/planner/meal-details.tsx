import { Segmented } from "@/components/pantry";
import { ErrorNotice } from "../feedback";
import { type MealDraft, mealDraftSchema } from "./meal-draft";

const slots = [
  { value: "", label: "Any" },
  { value: "Breakfast", label: "Breakfast" },
  { value: "Lunch", label: "Lunch" },
  { value: "Dinner", label: "Dinner" },
] as const;

export function MealDetails({
  draft,
  detailsOpen,
  setDetailsOpen,
  set,
  recipeTitle,
  recipeServings,
  recipeError,
  onRetryRecipe,
  sourceTitle,
  onNoteChange,
}: {
  draft: MealDraft;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  set: (values: Partial<MealDraft>) => void;
  recipeTitle: string | null;
  recipeServings?: string | null;
  recipeError?: string;
  onRetryRecipe: () => void;
  sourceTitle?: string;
  onNoteChange: (text: string) => void;
}) {
  return (
    <details
      className="meal-details"
      open={detailsOpen}
      onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
    >
      <summary>
        <span>Review details</span>
        <small className="meal-details-summary">
          {[
            draft.slot || "Any time",
            draft.kind === "recipe"
              ? `cook ${draft.cook || "?"}, eat ${draft.eat || "?"}`
              : draft.kind === "leftovers"
                ? `${draft.portions || "?"} portions`
                : "no ingredients",
          ].join(" · ")}
        </small>
      </summary>
      <div className="meal-details-body">
        <label className="pick-field">
          <span>Date</span>
          <input
            type="date"
            required
            min="2000-01-01"
            max="2100-12-31"
            value={draft.date}
            onChange={(event) => set({ date: event.target.value })}
          />
        </label>
        <Segmented
          label="Meal time"
          className="meal-slots"
          options={slots}
          value={draft.slot}
          onChange={(value) => {
            const slot = mealDraftSchema.shape.slot.safeParse(value);
            if (slot.success) set({ slot: slot.data });
          }}
        />
        {draft.kind === "recipe" && (
          <>
            {recipeTitle && (
              <p className="meal-sheet-hint">
                <b>{recipeTitle}</b>{" "}
                {recipeServings ? ` · recipe says “${recipeServings}”` : ""}
              </p>
            )}
            <ErrorNotice message={recipeError} retry={onRetryRecipe} />
            <div className="meal-portions">
              <label className="pick-field">
                <span>Original servings</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100"
                  required
                  value={draft.baseServings}
                  onChange={(event) =>
                    set({ baseServings: event.target.value })
                  }
                />
              </label>
              <label className="pick-field">
                <span>Cook</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100"
                  required
                  value={draft.cook}
                  onChange={(event) => set({ cook: event.target.value })}
                />
              </label>
              <label className="pick-field">
                <span>Eat now</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={draft.cook || "100"}
                  required
                  value={draft.eat}
                  onChange={(event) => set({ eat: event.target.value })}
                />
              </label>
            </div>
            <p className="meal-sheet-hint">
              Ingredients scale from the original servings.
              {Number(draft.cook) > Number(draft.eat)
                ? ` Saves ${Number(draft.cook) - Number(draft.eat)} portions for leftovers.`
                : ""}
            </p>
          </>
        )}
        {draft.kind === "leftovers" && (
          <>
            <p className="meal-sheet-hint">
              <b>{sourceTitle ? `${sourceTitle} leftovers` : "Leftovers"}</b>{" "}
              add no shopping ingredients.
            </p>
            <label className="pick-field">
              <span>Portions to use</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="100"
                required
                value={draft.portions}
                onChange={(event) => set({ portions: event.target.value })}
              />
            </label>
          </>
        )}
        {draft.kind === "out" && (
          <label className="pick-field">
            <span>Note</span>
            <input
              value={draft.description}
              maxLength={200}
              placeholder="Takeaway, dinner with friends…"
              onChange={(event) => {
                onNoteChange(event.target.value);
              }}
            />
          </label>
        )}
      </div>
    </details>
  );
}
