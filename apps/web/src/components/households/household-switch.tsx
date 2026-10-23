import { HouseholdChip } from "@/components/pantry";
import { useHousehold, useHouseholdSheet } from "./household-context";
import { householdTone } from "./household-ui";

/** Household chip that opens the Households sheet. Hidden with one household. */
export function HouseholdSwitch({ className }: { className?: string }) {
  const { name, color, multiple } = useHousehold();
  const { view, openHouseholds } = useHouseholdSheet();
  if (!multiple) return null;
  return (
    <HouseholdChip
      name={name}
      color={householdTone(color)}
      expanded={view !== null}
      onClick={() => openHouseholds()}
      className={className}
    />
  );
}
