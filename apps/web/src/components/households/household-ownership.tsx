import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorNotice } from "@/components/feedback";
import { useTRPC } from "@/utils/trpc";
import { MemberAvatar } from "./household-ui";

export function TransferOwnership({
  householdId,
  members,
  onDone,
  onCancel,
}: {
  householdId: string;
  members: { id: string; name: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const [memberId, setMemberId] = useState("");
  const chosen = members.find((member) => member.id === memberId);
  const transfer = useMutation(
    trpc.households.transferOwnership.mutationOptions({
      onSuccess: () => {
        toast.success(`${chosen?.name ?? "They"} now owns this household.`);
        onDone();
      },
    }),
  );
  return (
    <form
      className="household-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (memberId) transfer.mutate({ householdId, userId: memberId });
      }}
    >
      <h3 className="household-step-title">Transfer ownership</h3>
      <p className="household-hint">
        The new owner manages members, invites and deletion, and needs Pro.
        You'll stay a member.
      </p>
      <fieldset className="pantry-list household-choose">
        <legend className="pantry-visually-hidden">New owner</legend>
        {members.map((member) => (
          <label key={member.id} className="pantry-row">
            <MemberAvatar member={member} />
            <span className="pantry-row-text">
              <b>{member.name}</b>
            </span>
            <input
              type="radio"
              name="new-owner"
              value={member.id}
              checked={memberId === member.id}
              onChange={() => setMemberId(member.id)}
            />
          </label>
        ))}
      </fieldset>
      <ErrorNotice message={transfer.error?.message} />
      <button
        type="submit"
        className="button button-primary button-block"
        disabled={!memberId || transfer.isPending}
      >
        {transfer.isPending
          ? "Transferring..."
          : chosen
            ? `Make ${chosen.name} the owner`
            : "Choose a member"}
      </button>
      <button
        type="button"
        className="button button-ghost button-block"
        onClick={onCancel}
      >
        Cancel
      </button>
    </form>
  );
}

export function DeleteHousehold({
  householdId,
  name,
  onDeleted,
  onCancel,
}: {
  householdId: string;
  name: string;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const [typed, setTyped] = useState("");
  const remove = useMutation(
    trpc.households.delete.mutationOptions({ onSuccess: onDeleted }),
  );
  return (
    <form
      className="household-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed === name) remove.mutate({ householdId, name: typed });
      }}
    >
      <h3 className="household-step-title">Delete {name}?</h3>
      <p className="household-hint">
        This can't be undone. Everyone keeps their own recipes, but shares with
        this household, its meal plan and shopping list are removed for all
        members.
      </p>
      <label className="household-field">
        <span>Type {name} to confirm</span>
        <input
          autoComplete="off"
          spellCheck={false}
          value={typed}
          disabled={remove.isPending}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <ErrorNotice message={remove.error?.message} />
      <button
        type="submit"
        className="button button-danger button-block"
        disabled={typed !== name || remove.isPending}
      >
        {remove.isPending ? "Deleting..." : "Delete household"}
      </button>
      <button
        type="button"
        className="button button-ghost button-block"
        onClick={onCancel}
      >
        Keep it
      </button>
    </form>
  );
}
