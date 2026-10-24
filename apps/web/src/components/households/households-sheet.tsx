import { ArrowLeft } from "lucide-react";
import { HouseholdChip, Sheet } from "@/components/pantry";
import { HeaderSlot } from "@/components/shell/header-slot";
import { useHousehold, useHouseholdSheet } from "./household-context";
import { HouseholdManage } from "./household-manage";
import { HouseholdPicker } from "./household-picker";
import { householdTone } from "./household-ui";
import { JoinWithInvite, NewHousehold } from "./new-household";

/**
 * Global household chrome, rendered once in the root: the header chip
 * (only when there's more than one household) and the Households sheet.
 */
export function HouseholdChrome() {
  const { name, color, multiple } = useHousehold();
  const { view, openHouseholds } = useHouseholdSheet();
  return (
    <>
      {multiple && (
        <HeaderSlot>
          <HouseholdChip
            name={name}
            color={householdTone(color)}
            expanded={view !== null}
            onClick={() => openHouseholds()}
          />
        </HeaderSlot>
      )}
      <HouseholdsSheet />
    </>
  );
}

function HouseholdsSheet() {
  const { view, openHouseholds, closeHouseholds } = useHouseholdSheet();
  const { households } = useHousehold();
  const back = () => openHouseholds({ name: "list" });
  const managed =
    view?.name === "manage"
      ? households.data?.find((item) => item.id === view.householdId)
      : undefined;
  const title =
    view?.name === "manage"
      ? (managed?.name ?? "Household")
      : view?.name === "new"
        ? "New household"
        : view?.name === "join"
          ? "Join a household"
          : "Households";
  return (
    <Sheet
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) closeHouseholds();
      }}
      title={title}
      description={
        view?.name === "list" || !view
          ? "Each one is a shared binder. Plan and shopping list are per household."
          : undefined
      }
      className="households-sheet"
    >
      {view && view.name !== "list" && (
        <button type="button" className="household-back" onClick={back}>
          <ArrowLeft size={18} aria-hidden="true" /> Households
        </button>
      )}
      {(!view || view.name === "list") && (
        <HouseholdPicker
          onSwitched={() => closeHouseholds()}
          onManage={(item) =>
            openHouseholds({ name: "manage", householdId: item.id })
          }
          onNew={() => openHouseholds({ name: "new" })}
          onJoin={() => openHouseholds({ name: "join" })}
        />
      )}
      {view?.name === "manage" && (
        <HouseholdManage
          key={view.householdId}
          householdId={view.householdId}
          onGone={back}
        />
      )}
      {view?.name === "new" && (
        <NewHousehold
          onCreated={(householdId) =>
            openHouseholds({ name: "manage", householdId })
          }
          onUpgrade={closeHouseholds}
        />
      )}
      {view?.name === "join" && <JoinWithInvite onGo={closeHouseholds} />}
    </Sheet>
  );
}
