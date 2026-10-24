import { Check, ChevronRight, Link2, Plus, Settings2 } from "lucide-react";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { useHousehold } from "./household-context";
import {
  HouseholdMark,
  type HouseholdSummary,
  MemberAvatars,
  memberCount,
} from "./household-ui";

function summary(item: HouseholdSummary) {
  if (item.personal) return "Only you · private";
  return `${memberCount(item.members.length)}${item.isOwner ? " · You own it" : ""}`;
}

/**
 * Personal + shared households. Tap to switch (scopes Plan and Shop),
 * "Manage" per household, then New / Join actions.
 */
export function HouseholdPicker({
  onSwitched,
  onManage,
  onNew,
  onJoin,
}: {
  onSwitched?: (household: HouseholdSummary) => void;
  onManage: (household: HouseholdSummary) => void;
  onNew: () => void;
  onJoin: () => void;
}) {
  const { households, householdId, selectHousehold } = useHousehold();
  const personal = households.data?.filter((item) => item.personal) ?? [];
  const shared = households.data?.filter((item) => !item.personal) ?? [];

  const row = (item: HouseholdSummary) => {
    const current = item.personal ? !householdId : householdId === item.id;
    return (
      <div className="household-row" key={item.id}>
        <button
          type="button"
          className="pantry-row household-row-main"
          aria-pressed={current}
          onClick={() => {
            selectHousehold(item.personal ? null : item.id);
            onSwitched?.(item);
          }}
        >
          <HouseholdMark color={item.color} />
          <span className="pantry-row-text">
            <b>{item.name}</b>
            <small>{summary(item)}</small>
          </span>
          <MemberAvatars members={item.members} />
          <span className="household-radio" aria-hidden="true">
            {current ? <Check size={14} strokeWidth={3} /> : null}
          </span>
        </button>
        <button
          type="button"
          className="icon-button household-row-manage"
          aria-label={`Manage ${item.name}`}
          onClick={() => onManage(item)}
        >
          <Settings2 size={20} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <LoadingState pending={households.isPending} label="Loading households...">
      <ErrorNotice
        message={households.error ? "Couldn't load households." : undefined}
        retry={() => void households.refetch()}
      />
      {households.data && (
        <>
          <p className="grouped-label">Personal</p>
          <div className="pantry-list">{personal.map(row)}</div>
          {shared.length > 0 && (
            <>
              <p className="grouped-label">Shared</p>
              <div className="pantry-list">{shared.map(row)}</div>
            </>
          )}
          <div className="pantry-list household-actions">
            <button
              type="button"
              className="pantry-row household-new"
              onClick={onNew}
            >
              <span className="pantry-row-icon">
                <Plus size={20} aria-hidden="true" />
              </span>
              <span className="pantry-row-text">
                <b>New household</b>
              </span>
              <ChevronRight
                size={18}
                className="pantry-row-go"
                aria-hidden="true"
              />
            </button>
            <button type="button" className="pantry-row" onClick={onJoin}>
              <span className="pantry-row-icon">
                <Link2 size={20} aria-hidden="true" />
              </span>
              <span className="pantry-row-text">
                <b>Join with an invite link</b>
              </span>
              <ChevronRight
                size={18}
                className="pantry-row-go"
                aria-hidden="true"
              />
            </button>
          </div>
        </>
      )}
    </LoadingState>
  );
}
