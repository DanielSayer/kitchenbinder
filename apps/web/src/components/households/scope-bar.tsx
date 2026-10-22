import { StyledSelect } from "@prep-sheet/ui/components/styled-select";
import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { ErrorNotice } from "../feedback";
import { usePlanningScope } from "./planning-context";

export function PlanningScopeBar() {
  const { scope, household, selectScope, available, error, retry, ready } =
    usePlanningScope();
  return (
    <>
      <div className="planning-scope-bar">
        <div className="planning-scope-select">
          <Users size={17} aria-hidden="true" />
          <StyledSelect
            label="Planner and shopping list"
            value={scope.kind === "household" ? scope.householdId : "personal"}
            disabled={!ready}
            onValueChange={(value) =>
              selectScope(
                value === "personal"
                  ? { kind: "personal" }
                  : { kind: "household", householdId: value },
              )
            }
            options={[
              { label: "Personal", value: "personal" },
              ...(household
                ? [{ label: household.name, value: household.id }]
                : []),
              ...(!available && scope.kind === "household"
                ? [{ label: "Unavailable household", value: scope.householdId }]
                : []),
            ]}
          />
        </div>
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
