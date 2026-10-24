import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Trash2, Users } from "lucide-react";
import { useId, useRef } from "react";

type DropdownOption = {
  label: string;
  value: string;
};

export function HouseholdDropdown({
  disabled = false,
  label,
  manageHouseholds = false,
  onValueChange,
  options,
  placeholder = "Choose one",
  value,
}: {
  disabled?: boolean;
  label: string;
  manageHouseholds?: boolean;
  onValueChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  value: string;
}) {
  const labelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const valueId = useId();
  const selected = options.find((option) => option.value === value);

  return (
    <div className="collection-select" ref={container}>
      <span id={labelId} className="collection-select-label">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="collection-select-trigger"
          disabled={disabled}
          aria-labelledby={`${labelId} ${valueId}`}
        >
          <span id={valueId}>{selected?.label ?? placeholder}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          container={container}
          className="collection-select-menu"
          sideOffset={8}
        >
          <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <DropdownMenuRadioItem
                className="collection-select-option"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {manageHouseholds && (
            <>
              <DropdownMenuSeparator className="collection-select-divider" />
              <DropdownMenuItem
                className="collection-select-manage"
                render={<Link to="/recipes/deleted" />}
              >
                <Trash2 size={16} aria-hidden="true" />
                Recently deleted
              </DropdownMenuItem>
              <DropdownMenuItem
                className="collection-select-manage"
                render={<Link to="/households" />}
              >
                <Users size={16} aria-hidden="true" />
                Manage households
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
