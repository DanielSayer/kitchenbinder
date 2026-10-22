import { type Meal, scaleIngredient } from "@prep-sheet/db/meal-planner";
import { OrganiseDialog } from "../recipes/organise-dialog";

export function PlannedRecipe({
  meal,
  onClose,
}: {
  meal: Extract<Meal, { kind: "recipe" }>;
  onClose: () => void;
}) {
  const scaled = meal.ingredients.map((ingredient) =>
    scaleIngredient(ingredient, meal.cook / meal.baseServings),
  );
  return (
    <OrganiseDialog
      title={meal.title}
      className="meal-dialog planned-recipe-dialog"
      onClose={onClose}
    >
      <div className="planned-recipe-content">
        <p className="muted">Saved for this meal · Cook {meal.cook} servings</p>
        {meal.recipe?.description && <p>{meal.recipe.description}</p>}
        <section>
          <h3>Ingredients</h3>
          <ul>
            {scaled.map((ingredient, index) => (
              <li key={`${index}:${ingredient.text}`}>
                {ingredient.text}
                {ingredient.uncertain && (
                  <small className="meal-warning">Check quantity</small>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Method</h3>
          {meal.recipe ? (
            <ol>
              {meal.recipe.steps.map((step, index) => (
                <li key={`${index}:${step}`}>{step}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              This older planned meal saved ingredients only. Ask the person who
              added it for the method.
            </p>
          )}
        </section>
      </div>
    </OrganiseDialog>
  );
}
