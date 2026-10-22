import { StyledSelect } from "@prep-sheet/ui/components/styled-select";
import { useId } from "react";
import type { RecipeSort } from "./recipe-list";

const options: { label: string; value: RecipeSort }[] = [
  { label: "Newest", value: "newest" },
  { label: "Last cooked", value: "last-cooked" },
  { label: "Highest rated", value: "highest-rated" },
  { label: "Name", value: "name" },
  { label: "Cooking time", value: "cooking-time" },
];

export function SortDropdown({
  onValueChange,
  value,
}: {
  onValueChange: (value: RecipeSort) => void;
  value: RecipeSort;
}) {
  const labelId = useId();

  return (
    <div className="sort-control">
      <span id={labelId}>Sort</span>
      <StyledSelect
        label="Sort"
        labelId={labelId}
        value={value}
        options={options}
        onValueChange={onValueChange}
        triggerClassName="sort-trigger"
        menuClassName="sort-menu"
        align="end"
      />
    </div>
  );
}
