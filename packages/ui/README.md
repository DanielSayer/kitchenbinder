# Shared controls

Use `NativeSelect` for native dropdowns. It keeps the browser's keyboard and mobile picker behaviour while giving every dropdown the same text clearance, caret position, focus outline and disabled state.

```tsx
import { NativeSelect } from "@prep-sheet/ui/components/native-select";
import { useId } from "react";

const selectId = useId();

<label htmlFor={selectId}>
  Collection
  <NativeSelect id={selectId} value={value} onChange={onChange}>
    <option value="personal">Personal</option>
  </NativeSelect>
</label>;
```

Caret spacing lives in `src/styles/native-select.css`: 12 px from the edge, with 40 px reserved after the text. Screen styles can size `.native-select-wrapper`; keep padding and caret positioning in the shared stylesheet.

The workspace lint rule rejects raw `<select>` elements outside this component. Custom dropdown menus retain their existing menu components.
