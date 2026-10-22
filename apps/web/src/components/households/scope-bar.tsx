import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useId } from "react";
import { ErrorNotice } from "../feedback";
import { usePlanningScope } from "./planning-context";

export function PlanningScopeBar() {
  const selectId = useId();
  const { scope, household, selectScope, available, error, retry, ready } =
    usePlanningScope();
  return (
    <>
      <div className="planning-scope-bar">
        <label className="planning-scope-select" htmlFor={selectId}>
          <Users size={17} aria-hidden="true" />
          <span className="sr-only">Planner and shopping list</span>
          <NativeSelect
            id={selectId}
            aria-label="Planner and shopping list"
            value={scope.kind === "household" ? scope.householdId : "personal"}
            disabled={!ready}
            onChange={(event) =>
              selectScope(
                event.target.value === "personal"
                  ? { kind: "personal" }
                  : { kind: "household", householdId: event.target.value },
              )
            }
          >
            <option value="personal">Personal</option>
            {household && (
              <option value={household.id}>{household.name}</option>
            )}
            {!available && scope.kind === "household" && (
              <option value={scope.householdId}>Unavailable household</option>
            )}
          </NativeSelect>
        </label>
        <span className="planning-scope-caption">
          {scope.kind === "household" && household
            ? household.members.length === 1
              ? "Just you for now"
              : `${household.members.length} members`
            : "Only you"}
        </span>
        <Link to="/household" className="text-button">
          {household ? "Household settings" : "Plan with someone"}
        </Link>
      </div>
      <ErrorNotice message={error} retry={retry} />
      {!available && (
        <ErrorNotice message="You no longer have access to this household. Switch to Personal to continue. Your personal planner and list are still available." />
      )}
    </>
  );
}

import { NativeSelect } from "@prep-sheet/ui/components/native-select";
