import {
  displayQuantity,
  type Ingredient,
  type IngredientLine,
  ingredientLines,
  type MeasurePreferences,
  type Unit,
} from "@prep-sheet/db/ingredient-line";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import { useState } from "react";

/** Parsed form of each line, from the recipe's stored data when it has it. */
export function parsedIngredients(
  texts: readonly string[],
  lines: readonly IngredientLine[] | null | undefined,
) {
  return ingredientLines(texts, lines).map((line) => line.parsed);
}

/** Units the cook has switched lines to, by ingredient key. */
export function useUnitChoices() {
  const [units, setUnits] = useState<Record<string, Unit>>({});
  return {
    unitFor: (key: string) => units[key] ?? null,
    setUnit: (key: string, unit: Unit) =>
      setUnits((current) => ({ ...current, [key]: unit })),
  };
}

/**
 * One ingredient line with its amount in the user's units. Tapping the
 * amount switches it to another unit when the line can be converted.
 */
export function IngredientText({
  text,
  factor,
  ingredient,
  unit,
  onUnitChange,
  preferences,
}: {
  text: string;
  factor: number;
  ingredient: Ingredient | null;
  unit: Unit | null;
  onUnitChange: (unit: Unit) => void;
  preferences: MeasurePreferences;
}) {
  const shown = displayQuantity(text, factor, ingredient, preferences, unit);
  const choices = shown.choices ?? [];
  return (
    <span className="ingredient-text">
      {shown.quantity && choices.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="ingredient-unit"
            aria-label={`${shown.quantity}, change units`}
          >
            {shown.quantity}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="styled-select-menu ingredient-unit-menu">
            <DropdownMenuRadioGroup
              value={shown.unit}
              onValueChange={(next) => onUnitChange(next as Unit)}
            >
              {choices.map((choice) => (
                <DropdownMenuRadioItem
                  className="styled-select-option"
                  key={choice.unit}
                  value={choice.unit}
                >
                  {choice.unit === shown.unit ? shown.quantity : choice.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : shown.quantity ? (
        <b>{shown.quantity}</b>
      ) : null}
      {shown.rest}
    </span>
  );
}
