import { Link } from "@tanstack/react-router";
import { Check, Users } from "lucide-react";
import type { CSSProperties } from "react";
import { toneColor } from "@/components/pantry";
import { householdTone, useShareableHouseholds } from "./use-collections";

/**
 * Toggle list of the user's shared households, each in its colour.
 * "Just me" is never listed: sharing with yourself means not sharing.
 */
export function HouseholdShareList({
  sharedIds,
  onToggle,
  disabled = false,
  label = "Share with households",
}: {
  sharedIds: readonly string[];
  onToggle: (householdId: string, share: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const households = useShareableHouseholds();
  if (households.isPending)
    return (
      <p className="sheet-hint" role="status">
        Loading households…
      </p>
    );
  if (households.isError)
    return (
      <p className="sheet-hint" role="alert">
        Couldn't load households.{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => void households.refetch()}
        >
          Retry
        </button>
      </p>
    );
  if (!households.shareable.length)
    return (
      <div className="pantry-list sheet-group">
        <Link to="/groups" className="pantry-row">
          <span className="pantry-row-icon">
            <Users size={20} aria-hidden="true" />
          </span>
          <span className="pantry-row-text">
            <b>No shared households yet</b>
            <small>Create one to share with family or flatmates</small>
          </span>
        </Link>
      </div>
    );
  return (
    <fieldset className="sheet-fieldset">
      <legend className="sheet-label">{label}</legend>
      <div className="pantry-list">
        {households.shareable.map((household) => {
          const shared = sharedIds.includes(household.id);
          return (
            <button
              key={household.id}
              type="button"
              role="switch"
              aria-checked={shared}
              disabled={disabled}
              className="pantry-row pick-row"
              style={
                {
                  "--hc": toneColor(householdTone(household.color)),
                } as CSSProperties
              }
              onClick={() => onToggle(household.id, !shared)}
            >
              <span className="hmark" aria-hidden="true" />
              <span className="pantry-row-text">
                <b>{household.name}</b>
                <small>
                  {household.members.length}{" "}
                  {household.members.length === 1 ? "member" : "members"}
                </small>
              </span>
              <span className="pick-check" aria-hidden="true">
                <Check size={16} />
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
