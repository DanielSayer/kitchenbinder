import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  LogOut,
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
import { HouseholdInvites } from "./household-invites";
import { DeleteHousehold, TransferOwnership } from "./household-ownership";
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
            <HouseholdInvites
              name={group.name}
              link={link}
              invites={group.invites}
              pending={invite.isPending}
              error={invite.error?.message}
              onCreate={() => invite.mutate({ householdId })}
              onRevoke={revokeInvite}
            />
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
