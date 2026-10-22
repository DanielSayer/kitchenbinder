# Shared controls

Use `StyledSelect` for selection dropdowns. It uses the collection dropdown's styled trigger, popup, selected-row highlight and checkmark. Native selects are not allowed, including on mobile.

```tsx
import { StyledSelect } from "@prep-sheet/ui/components/styled-select";
import { useId } from "react";

const selectId = useId();

<div>
  <label htmlFor={selectId}>Collection</label>
  <StyledSelect
    id={selectId}
    label="Collection"
    value={value}
    onValueChange={setValue}
    options={[{ label: "Personal", value: "personal" }]}
  />
</div>;
```

Trigger padding, caret spacing and popup styling live in `src/styles/styled-select.css`. Screens can size `.styled-select`. Use `footer` for additional menu actions, as the collection dropdown does for Recently deleted and Manage groups.

The workspace lint rule rejects every raw `<select>` element. There is no component exemption. Action menus use the existing dropdown-menu primitives.
