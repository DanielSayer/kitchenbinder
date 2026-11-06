import { useNavigate } from "@tanstack/react-router";
import { CalendarPlus, Flame } from "lucide-react";
import { useState } from "react";
import { useHouseholdScope } from "@/components/households/household-context";
import { Sheet } from "@/components/pantry";
import { useWeekStartsOn } from "@/components/preferences";
import { localDate, weekStart } from "./dates";
import { SuggestionRows } from "./suggestion-rows";

/**
 * Quick "What's for dinner?": the planner's suggestion rows for this week,
 * then cook the pick now or plan it for today.
 */
export function DinnerSheet({
  open,
  onOpenChange,
  collectionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Narrow ideas to this collection. */
  collectionId?: string;
}) {
  const householdId = useHouseholdScope();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string>();
  const thisWeek = weekStart(localDate(), useWeekStartsOn());
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setPicked(undefined);
        onOpenChange(next);
      }}
      title="What's for dinner?"
      description="Pick one, then cook it now or plan it."
      footer={
        <>
          <button
            type="button"
            className="button button-primary button-block"
            disabled={!picked}
            onClick={() =>
              picked &&
              void navigate({
                to: "/recipes/$recipeId",
                params: { recipeId: picked },
                search: { cook: true },
              })
            }
          >
            <Flame size={18} aria-hidden="true" /> Cook now
          </button>
          <button
            type="button"
            className="button button-ghost button-block"
            disabled={!picked}
            onClick={() =>
              picked &&
              void navigate({ to: "/planner", search: { recipeId: picked } })
            }
          >
            <CalendarPlus size={18} aria-hidden="true" /> Plan it
          </button>
        </>
      }
    >
      {open && (
        <SuggestionRows
          householdId={householdId}
          weekStart={thisWeek}
          collectionId={collectionId}
          radioName="dinner"
          selectedId={picked}
          onPick={setPicked}
          heading={null}
          standalone
        />
      )}
    </Sheet>
  );
}
