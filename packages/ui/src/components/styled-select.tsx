import { cn } from "@prep-sheet/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export type SelectOption<Value extends string> = {
  label: string;
  value: Value;
  disabled?: boolean;
};

export function StyledSelect<Value extends string>({
  id,
  label,
  labelId,
  value,
  options,
  onValueChange,
  disabled = false,
  placeholder = "Choose an option",
  triggerClassName,
  menuClassName,
  align = "start",
  footer,
}: {
  id?: string;
  label: string;
  labelId?: string;
  value: Value;
  options: readonly SelectOption<Value>[];
  onValueChange: (value: Value) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  menuClassName?: string;
  align?: "start" | "end";
  footer?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const valueId = useId();
  const selected = options.find((option) => option.value === value);
  return (
    <div className="styled-select" ref={container}>
      <DropdownMenu>
        <DropdownMenuTrigger
          id={id}
          className={cn("styled-select-trigger", triggerClassName)}
          disabled={disabled}
          aria-label={labelId ? undefined : label}
          aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
        >
          <span id={valueId}>{selected?.label ?? placeholder}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          container={container}
          className={cn("styled-select-menu", menuClassName)}
          align={align}
          sideOffset={8}
        >
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              const option = options.find(
                (entry) => entry.value === next && !entry.disabled,
              );
              if (option) onValueChange(option.value);
            }}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                className="styled-select-option"
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {footer}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
