import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import { ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import type { CSSProperties } from "react";
import { toneColor } from "@/components/pantry";
import { initialsOf } from "@/components/shell/destinations";
import { useHousehold, useHouseholdSheet } from "./household-context";
import { householdTone } from "./household-ui";

const tone = (color: string | null | undefined) =>
  ({ "--hc": toneColor(householdTone(color)) }) as CSSProperties;

/**
 * Desktop header household switcher, attached to the brand ("kitchenbinder /
 * Family"). Hidden with one household. Mobile uses the page-bar chip.
 */
export function HouseholdMenu() {
  const { households, householdId, selectHousehold, name, color, multiple } =
    useHousehold();
  const { openHouseholds } = useHouseholdSheet();
  if (!multiple) return null;
  const items = households.data ?? [];
  const current =
    items.find((item) =>
      item.personal ? !householdId : householdId === item.id,
    )?.id ?? "";
  return (
    <div className="household-menu">
      <span className="household-menu-slash" aria-hidden="true">
        /
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="household-menu-trigger"
          aria-label={`Household: ${name}. Switch household`}
        >
          <span
            className="household-menu-badge"
            style={tone(color)}
            aria-hidden="true"
          >
            {initialsOf(name)}
          </span>
          <span className="household-menu-name">{name}</span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="collection-select-menu household-menu-content"
          align="start"
          sideOffset={8}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="household-menu-label">
              Switch household
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={current}
              onValueChange={(id) => {
                const item = items.find((entry) => entry.id === id);
                if (item) selectHousehold(item.personal ? null : item.id);
              }}
            >
              {items.map((item) => (
                <DropdownMenuRadioItem
                  key={item.id}
                  value={item.id}
                  className="collection-select-option"
                >
                  <i
                    className="household-menu-dot"
                    style={tone(item.color)}
                    aria-hidden="true"
                  />
                  <span className="household-menu-option">{item.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="collection-select-divider" />
          <DropdownMenuItem
            className="collection-select-manage"
            onClick={() => openHouseholds()}
          >
            <Settings2 size={16} aria-hidden="true" /> Manage households
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            onClick={() => openHouseholds({ name: "new" })}
          >
            <Plus size={16} aria-hidden="true" /> New household
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
