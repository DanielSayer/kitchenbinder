import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  Copy,
  Link2,
  LogOut,
  Share2,
  Trash2,
  UserMinus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { type PantryTone, undoToast } from "@/components/pantry";
import { authClient } from "@/lib/auth-client";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import { useHousehold } from "./household-context";
import {
  ColourPicker,
  HouseholdMark,
  householdTone,
  MemberAvatar,
  memberCount,
} from "./household-ui";

type Mode = "main" | "transfer" | "delete";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Manage one household: switch to it, rename, colour, invite, members,
 * ownership, leave and delete. Used in the Households sheet and on /households.
 */
export function HouseholdManage({
  householdId,
  onGone,
}: {
  householdId: string;
  /** Called after you leave or delete the household. */
  onGone?: () => void;
}) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const client = useQueryClient();
  const { data: session } = authClient.useSession();
  const me = session?.user.id;
  const household = useHousehold();
  const detailsKey = trpc.households.details.queryKey({ householdId });
  const listKey = trpc.households.list.queryKey();
  const details = useQuery(
    trpc.households.details.queryOptions({ householdId }),
  );
  const [mode, setMode] = useState<Mode>("main");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const loadedName = details.data?.name;
  useEffect(() => {
    if (loadedName) setName(loadedName);
  }, [loadedName]);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: trpc.households.pathKey() }),
      client.invalidateQueries({ queryKey: trpc.recipes.pathKey() }),
    ]);

  const rename = useMutation(
    trpc.households.rename.mutationOptions({
      onSuccess: async () => {
        toast.success("Name saved.");
        await refresh();
      },
    }),
  );
  const recolor = useMutation(
    trpc.households.recolor.mutationOptions({
      onMutate: ({ color }) => {
        client.setQueryData(detailsKey, (old) =>
          old ? { ...old, color } : old,
        );
        client.setQueryData(listKey, (old) =>
          old?.map((item) =>
            item.id === householdId ? { ...item, color } : item,
          ),
        );
      },
      onError: (error) => toast.error(error.message),
      onSettled: () => refresh(),
    }),
  );
  const invite = useMutation(
    trpc.households.invite.mutationOptions({
      onSuccess: async (result) => {
        setLink(`${window.location.origin}/join#${result.token}`);
        await refresh();
      },
    }),
  );

  /** Act now, offer Undo, commit the real change when the toast closes. */
  function deferred(
    message: string,
    apply: () => void,
    commit: () => Promise<unknown>,
    revert?: () => void,
  ) {
    apply();
    undoToast(message, {
      onUndo: () => {
        revert?.();
        void refresh();
      },
      onCommit: () => {
        commit().then(
          () => refresh(),
          (error) => {
            revert?.();
            toast.error(messageOf(error));
            void refresh();
          },
        );
      },
    });
  }

  const group = details.isError ? undefined : details.data;
  const owner = !!group && group.ownerId === me;
  const current = group
    ? group.personal
      ? !household.householdId
      : household.householdId === group.id
    : false;
  const others = group?.members.filter((member) => member.id !== me) ?? [];

  function removeMember(member: { id: string; name: string }) {
    deferred(
      `Removed ${member.name}`,
      () =>
        client.setQueryData(detailsKey, (old) =>
          old
            ? {
                ...old,
                members: old.members.filter((item) => item.id !== member.id),
              }
            : old,
        ),
      () =>
        trpcClient.households.removeMember.mutate({
          householdId,
          userId: member.id,
        }),
    );
  }

  function revokeInvite(inviteId: string) {
    deferred(
      "Invite link revoked",
      () => {
        setLink("");
        client.setQueryData(detailsKey, (old) =>
          old
            ? {
                ...old,
                invites: old.invites.filter((item) => item.id !== inviteId),
              }
            : old,
        );
      },
      () =>
        trpcClient.households.revokeInvite.mutate({ householdId, inviteId }),
    );
  }

  function leave() {
    if (!group) return;
    const wasCurrent = current;
    deferred(
      `Left ${group.name}`,
      () => {
        if (wasCurrent) household.selectHousehold(null);
        client.setQueryData(listKey, (old) =>
          old?.filter((item) => item.id !== householdId),
        );
        onGone?.();
      },
      () => trpcClient.households.leave.mutate({ householdId }),
      () => {
        if (wasCurrent) household.selectHousehold(householdId);
      },
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Select the link and copy it manually.");
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: `Join ${group?.name ?? "my household"} on Kitchenbinder`,
        url: link,
      });
    } catch {
      /* Share sheet dismissed. */
    }
  }

  return (
    <LoadingState pending={details.isPending} label="Loading household...">
      <ErrorNotice
        message={details.error?.message}
        retry={() => void details.refetch()}
      />
      {group && mode === "transfer" && (
        <TransferOwnership
          householdId={householdId}
          members={others}
          onDone={async () => {
            setMode("main");
            await refresh();
          }}
          onCancel={() => setMode("main")}
        />
      )}
      {group && mode === "delete" && (
        <DeleteHousehold
          householdId={householdId}
          name={group.name}
          onCancel={() => setMode("main")}
          onDeleted={async () => {
            if (current) household.selectHousehold(null);
            toast.success(`${group.name} deleted.`);
            onGone?.();
            await refresh();
          }}
        />
      )}
      {group && mode === "main" && (
        <div className="household-manage">
          <div className="household-hero">
            <HouseholdMark color={group.color} />
            <div>
              <h3>{group.name}</h3>
              <p>
                {group.personal
                  ? "Your private household. Plan and list just for you."
                  : `${memberCount(group.members.length)} · ${owner ? "You own it" : "Shared with you"}`}
              </p>
            </div>
            {current ? (
              <span className="household-current">
                <Check size={14} strokeWidth={3} aria-hidden="true" /> Current
              </span>
            ) : (
              <button
                type="button"
                className="button button-small button-outline"
                onClick={() => {
                  household.selectHousehold(group.personal ? null : group.id);
                  toast.success(`Switched to ${group.name}.`);
                }}
              >
                Switch to it
              </button>
            )}
          </div>

          {owner && !group.personal && (
            <form
              className="household-rename"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim() && name.trim() !== group.name)
                  rename.mutate({ householdId, name: name.trim() });
              }}
            >
              <label className="household-field">
                <span>Name</span>
                <input
                  required
                  maxLength={80}
                  autoComplete="off"
                  value={name}
                  disabled={rename.isPending}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {name.trim() !== group.name && (
                <button
                  type="submit"
                  className="button button-small button-outline"
                  disabled={rename.isPending || !name.trim()}
                >
                  {rename.isPending ? "Saving..." : "Save"}
                </button>
              )}
            </form>
          )}
          {owner && (
            <ColourPicker
              value={householdTone(group.color)}
              disabled={recolor.isPending}
              onChange={(color: PantryTone) =>
                recolor.mutate({ householdId, color })
              }
            />
          )}

          {!group.personal && (
            <>
              <p className="grouped-label">Members</p>
              <ul className="pantry-list household-members">
                {group.members.map((member) => (
                  <li key={member.id} className="pantry-row">
                    <MemberAvatar member={member} />
                    <span className="pantry-row-text">
                      <b>
                        {member.name}
                        {member.id === me ? " (you)" : ""}
                      </b>
                      {member.id === group.ownerId && <small>Owner</small>}
                    </span>
                    {owner && member.id !== group.ownerId && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${member.name}`}
                        onClick={() => removeMember(member)}
                      >
                        <UserMinus size={18} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {owner && !group.personal && (
            <section className="household-invite" aria-label="Invite">
              <p className="grouped-label">Invite</p>
              {link ? (
                <div className="household-link">
                  <label className="household-field">
                    <span>Invite link · one person · 7 days</span>
                    <input
                      readOnly
                      value={link}
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                  <div className="household-link-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void copy()}
                    >
                      <Copy size={18} aria-hidden="true" /> Copy link
                    </button>
                    {typeof navigator !== "undefined" &&
                      "share" in navigator && (
                        <button
                          type="button"
                          className="button button-outline"
                          onClick={() => void share()}
                        >
                          <Share2 size={18} aria-hidden="true" /> Share
                        </button>
                      )}
                  </div>
                  <p className="household-hint">
                    Share privately. Anyone with the link can join once.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  className="button button-primary button-block"
                  disabled={invite.isPending}
                  onClick={() => invite.mutate({ householdId })}
                >
                  <Link2 size={18} aria-hidden="true" />
                  {invite.isPending ? "Creating link..." : "Create invite link"}
                </button>
              )}
              <ErrorNotice message={invite.error?.message} />
              {group.invites.length > 0 && (
                <ul className="pantry-list household-invites">
                  {group.invites.map((item) => (
                    <li key={item.id} className="pantry-row">
                      <span className="pantry-row-icon">
                        <Link2 size={18} aria-hidden="true" />
                      </span>
                      <span className="pantry-row-text">
                        <b>Unused link</b>
                        <small>Expires {formatDate(item.expiresAt)}</small>
                      </span>
                      <button
                        type="button"
                        className="button button-small button-ghost"
                        onClick={() => revokeInvite(item.id)}
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <ErrorNotice message={rename.error?.message} />

          {!group.personal && (
            <div className="pantry-list household-danger">
              {owner && others.length > 0 && (
                <button
                  type="button"
                  className="pantry-row"
                  onClick={() => setMode("transfer")}
                >
                  <span className="pantry-row-icon">
                    <ArrowLeftRight size={18} aria-hidden="true" />
                  </span>
                  <span className="pantry-row-text">
                    <b>Transfer ownership</b>
                  </span>
                  <ChevronRight
                    size={18}
                    className="pantry-row-go"
                    aria-hidden="true"
                  />
                </button>
              )}
              {owner ? (
                <button
                  type="button"
                  className="pantry-row household-destructive"
                  onClick={() => setMode("delete")}
                >
                  <span className="pantry-row-icon">
                    <Trash2 size={18} aria-hidden="true" />
                  </span>
                  <span className="pantry-row-text">
                    <b>Delete household</b>
                  </span>
                  <ChevronRight
                    size={18}
                    className="pantry-row-go"
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <button
                  type="button"
                  className="pantry-row household-destructive"
                  onClick={leave}
                >
                  <span className="pantry-row-icon">
                    <LogOut size={18} aria-hidden="true" />
                  </span>
                  <span className="pantry-row-text">
                    <b>Leave household</b>
                    <small>Recipes you shared here stay shared.</small>
                  </span>
                </button>
              )}
            </div>
          )}
          {owner && !group.personal && (
            <p className="household-hint">
              To leave, transfer ownership to another member or delete the
              household.
            </p>
          )}
        </div>
      )}
    </LoadingState>
  );
}

function TransferOwnership({
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

function DeleteHousehold({
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
