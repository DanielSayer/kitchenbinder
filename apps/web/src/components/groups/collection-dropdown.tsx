import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@prep-sheet/ui/components/dropdown-menu";
import { StyledSelect } from "@prep-sheet/ui/components/styled-select";
import { Link } from "@tanstack/react-router";
import { Trash2, Users } from "lucide-react";
import { useId } from "react";

type CollectionOption = {
  label: string;
  value: string;
};

export function CollectionDropdown({
  disabled = false,
  label,
  manageGroups = false,
  onValueChange,
  options,
  placeholder = "Choose a collection",
  value,
}: {
  disabled?: boolean;
  label: string;
  manageGroups?: boolean;
  onValueChange: (value: string) => void;
  options: CollectionOption[];
  placeholder?: string;
  value: string;
}) {
  const labelId = useId();

  return (
    <div className="collection-select">
      <span id={labelId} className="collection-select-label">
        {label}
      </span>
      <StyledSelect
        label={label}
        labelId={labelId}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        triggerClassName="collection-select-trigger"
        footer={
          manageGroups ? (
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
                render={<Link to="/groups" />}
              >
                <Users size={16} aria-hidden="true" />
                Manage groups
              </DropdownMenuItem>
            </>
          ) : null
        }
      />
    </div>
  );
}
