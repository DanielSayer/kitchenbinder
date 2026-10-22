import { cn } from "@prep-sheet/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

// Keep the native picker and its keyboard/touch behaviour. The wrapper owns
// caret placement so each screen only needs to set the control's width.
export function NativeSelect({
  className,
  ...props
}: Omit<ComponentProps<"select">, "multiple" | "size">) {
  return (
    <span className="native-select-wrapper">
      <select
        data-slot="native-select"
        className={cn("native-select", className)}
        {...props}
      />
      <ChevronDown className="native-select-icon" aria-hidden="true" />
    </span>
  );
}
