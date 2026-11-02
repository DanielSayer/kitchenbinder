import {
  type IngredientLine,
  parseIngredient,
  type Unit,
} from "@prep-sheet/db/ingredients";
import type { MeasurePreferences } from "@prep-sheet/db/units";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import { useState } from "react";
import { displayQuantity } from "./scale-ingredients";

/** Parsed form of each line, from the recipe's stored data when it has it. */
export function parsedIngredients(
  texts: readonly string[],
  lines: readonly IngredientLine[] | null | undefined,
) {
  const known = new Map(lines?.map((line) => [line.text, line]));
  return texts.map((text) => {
    const line = known.get(text);
    return line ? line.parsed : parseIngredient(text);
  });
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
  ingredient: ReturnType<typeof parseIngredient>;
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
