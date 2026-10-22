import type { AppRouter } from "@prep-sheet/api/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, Copy, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";
import { localDate } from "../planner/dates";
import { OrganiseDialog } from "../recipes/organise-dialog";
import { usePlanningScope } from "./planning-context";

type Household = NonNullable<
  inferRouterOutputs<AppRouter>["households"]["current"]
>;

export function HouseholdPage() {
  const planning = usePlanningScope();
  return (
    <main id="main-content" className="page-width household-page">
      <div className="page-heading">
        <div>
          <h1>
            Household<span className="title-dot">.</span>
          </h1>
          <p>Plan meals and shop together.</p>
        </div>
        <Link to="/planner" className="button button-small button-outline">
          <ArrowLeft size={17} />
          Planner
        </Link>
      </div>
      <LoadingState
        pending={!planning.ready && !planning.error}
        label="Loading your household..."
      >
        <ErrorNotice message={planning.error} retry={planning.retry} />
        {planning.ready &&
          (planning.household ? (
            <HouseholdSettings
              key={planning.household.id}
              household={planning.household}
            />
          ) : (
            <CreateHousehold />
          ))}
      </LoadingState>
    </main>
  );
}

function CreateHousehold() {
  const trpc = useTRPC();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { selectScope } = usePlanningScope();
  const [name, setName] = useState("Home");
  const [copy, setCopy] = useState(false);
  const billing = useQuery(trpc.billing.status.queryOptions());
  const create = useMutation(
    trpc.households.create.mutationOptions({
      onSuccess: async (result) => {
        await client.invalidateQueries({ queryKey: trpc.households.pathKey() });
        selectScope({ kind: "household", householdId: result.householdId });
        toast.success("Household created. Invite someone to plan with you.");
      },
    }),
  );
  return (
    <section className="household-panel household-setup">
      <div className="household-intro-icon">
        <Users size={26} />
      </div>
      <h2>Who's coming for dinner?</h2>
      <p>
        Share one meal planner and shopping list with your partner or the people
        you live with.
      </p>
      <p className="muted">
        Your personal planner stays available. Recipe collections keep their own
        members.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!create.isPending)
            create.mutate({ name, from: localDate(), copyPersonalMeals: copy });
        }}
      >
        <fieldset className="household-form" disabled={create.isPending}>
          <label className="shopping-field">
            Household name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <fieldset className="household-start-options">
            <legend>Start your shared planner</legend>
            <label className="shopping-recipe-choice">
              <input
                type="radio"
                name="start"
                checked={!copy}
                onChange={() => setCopy(false)}
              />
              <span>
                <strong>Start empty</strong>
                <small>Plan your first week together.</small>
              </span>
            </label>
            <label className="shopping-recipe-choice">
              <input
                type="radio"
                name="start"
                checked={copy}
                onChange={() => setCopy(true)}
              />
              <span>
                <strong>Copy my upcoming meals</strong>
                <small>
                  Shares planned recipe details from today onwards, including
                  cooking sessions needed for leftovers. Personal meals and
                  groceries stay where they are.
                </small>
              </span>
            </label>
          </fieldset>
          <ErrorNotice
            message={create.error?.message ?? billing.error?.message}
            retry={billing.isError ? () => void billing.refetch() : undefined}
          />
          {billing.data && !billing.data.createHousehold ? (
            <p className="household-plan-note">
              Creating a household needs Pro. Joining one is free.{" "}
              <Link to="/settings">Manage plan</Link>
            </p>
          ) : null}
          <div className="household-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={
                !name.trim() ||
                billing.isPending ||
                billing.isError ||
                !billing.data?.createHousehold
              }
            >
              {create.isPending ? "Creating..." : "Create household"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => void navigate({ to: "/planner" })}
            >
              Back to planner
            </button>
          </div>
        </fieldset>
      </form>
      <p className="muted household-join-hint">
        Already invited? Open the invitation link to join.
      </p>
    </section>
  );
}

type Confirmation =
  | { kind: "remove"; id: string; name: string }
  | { kind: "leave" }
  | { kind: "transfer"; id: string; name: string }
  | { kind: "delete" };

function HouseholdSettings({ household }: { household: Household }) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const { data: session } = authClient.useSession();
  const { selectScope } = usePlanningScope();
  const owner = household.ownerId === session?.user.id;
  const [link, setLink] = useState("");
  const [name, setName] = useState(household.name);
  const [rename, setRename] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [copyOnLeave, setCopyOnLeave] = useState(true);
  const [deleteName, setDeleteName] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: trpc.households.pathKey() }),
      client.invalidateQueries({ queryKey: trpc.planner.pathKey() }),
      client.invalidateQueries({ queryKey: trpc.shopping.pathKey() }),
    ]);
  };
  const invite = useMutation(
    trpc.households.invite.mutationOptions({
      onSuccess: async (result) => {
        setLink(`${window.location.origin}/join-household#${result.token}`);
        await refresh();
      },
    }),
  );
  const revoke = useMutation(
    trpc.households.revokeInvite.mutationOptions({
      onSuccess: async () => {
        setLink("");
        await refresh();
      },
    }),
  );
  const update = useMutation(
    trpc.households.rename.mutationOptions({
      onSuccess: async () => {
        setRename(false);
        await refresh();
      },
    }),
  );
  const copy = useMutation(
    trpc.households.copyMealsToPersonal.mutationOptions({
      onSuccess: async ({ copied }) => {
        toast.success(
          copied
            ? `Copied ${copied} ${copied === 1 ? "meal" : "meals"} to your personal planner.`
            : "Your personal planner already has these meals, or there are no upcoming meals.",
        );
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    trpc.households.removeMember.mutationOptions({
      onSuccess: async (_, input) => {
        if (input.userId === session?.user.id)
          selectScope({ kind: "personal" });
        setConfirmation(null);
        await refresh();
      },
    }),
  );
  const transfer = useMutation(
    trpc.households.transferOwnership.mutationOptions({
      onSuccess: async () => {
        setConfirmation(null);
        await refresh();
      },
    }),
  );
  const destroy = useMutation(
    trpc.households.delete.mutationOptions({
      onSuccess: async () => {
        selectScope({ kind: "personal" });
        setConfirmation(null);
        await refresh();
      },
    }),
  );
  const pending =
    invite.isPending ||
    revoke.isPending ||
    update.isPending ||
    remove.isPending ||
    transfer.isPending ||
    destroy.isPending ||
    copy.isPending;
  function confirm() {
    if (!confirmation || pending) return;
    const householdId = household.id;
    switch (confirmation.kind) {
      case "remove":
        remove.mutate({ householdId, userId: confirmation.id });
        break;
      case "leave":
        if (session)
          remove.mutate({
            householdId,
            userId: session.user.id,
            copyUpcomingFrom: copyOnLeave ? localDate() : undefined,
          });
        break;
      case "transfer":
        transfer.mutate({ householdId, userId: confirmation.id });
        break;
      case "delete":
        destroy.mutate({ householdId, name: deleteName });
        break;
    }
  }
  function openConfirmation(value: Confirmation) {
    remove.reset();
    transfer.reset();
    destroy.reset();
    setDeleteName("");
    setCopyOnLeave(true);
    setConfirmation(value);
  }
  return (
    <>
      <section className="household-panel">
        <div className="household-panel-heading">
          <div>
            <h2>{household.name}</h2>
            <p className="muted">
              {household.members.length}{" "}
              {household.members.length === 1 ? "member" : "members"}
              {owner ? " · You own this household" : ""}
            </p>
          </div>
          <Link
            className="button button-small button-outline"
            to="/planner"
            onClick={() =>
              selectScope({ kind: "household", householdId: household.id })
            }
          >
            Open planner
          </Link>
        </div>
        <p>
          Everyone can add and edit meals, view saved recipe details, and update
          the shopping list.
        </p>
        {owner && (
          <div className="household-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={() => invite.mutate({ householdId: household.id })}
            >
              {invite.isPending ? "Creating link..." : "Invite someone"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => {
                setName(household.name);
                setRename((value) => !value);
              }}
            >
              Rename household
            </button>
          </div>
        )}
        {rename && owner && (
          <form
            className="household-rename"
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending) update.mutate({ householdId: household.id, name });
            }}
          >
            <label className="shopping-field">
              Household name
              <input
                required
                maxLength={80}
                value={name}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button
              className="button button-small button-outline"
              type="submit"
              disabled={pending || !name.trim()}
            >
              Save name
            </button>
          </form>
        )}
        {link && owner && (
          <div className="household-invitation">
            <label className="shopping-field">
              Invitation link
              <input
                readOnly
                value={link}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <button
              className="button button-small button-outline"
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(link).then(
                  () => toast.success("Invitation link copied."),
                  () => toast.error("Select the link and copy it manually."),
                )
              }
            >
              <Copy size={16} />
              Copy link
            </button>
            <p className="muted">
              Share privately. One person can use this link within 7 days. They
              will share your household planner and shopping list.
            </p>
          </div>
        )}
        <ErrorNotice
          message={
            invite.error?.message ??
            revoke.error?.message ??
            update.error?.message
          }
        />
        <ul className="household-members">
          {household.members.map((member) => (
            <li key={member.id}>
              <span>
                {member.name}
                {member.id === session?.user.id ? " (you)" : ""}
                {member.id === household.ownerId && <small>Owner</small>}
              </span>
              {owner && member.id !== household.ownerId && (
                <button
                  type="button"
                  className="text-button"
                  disabled={pending}
                  onClick={() =>
                    openConfirmation({ kind: "remove", ...member })
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {owner && household.invites.length > 0 && (
          <details className="household-unused-invites">
            <summary>Unused invitations · {household.invites.length}</summary>
            <ul className="household-members">
              {household.invites.map((invitation) => (
                <li key={invitation.id}>
                  <span>
                    Expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString("en-AU")}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    disabled={pending}
                    onClick={() =>
                      revoke.mutate({
                        householdId: household.id,
                        inviteId: invitation.id,
                      })
                    }
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="household-panel">
        <h2>Your personal planner</h2>
        <p>
          Keep a copy of upcoming household meals. Earlier cooking sessions
          needed for leftovers come with them. Existing personal meals and
          groceries stay in place.
        </p>
        <button
          type="button"
          className="button button-small button-outline"
          disabled={pending}
          onClick={() =>
            copy.mutate({ householdId: household.id, from: localDate() })
          }
        >
          {copy.isPending ? "Copying..." : "Copy upcoming meals"}
        </button>
        <ErrorNotice message={copy.error?.message} />
        {!owner && (
          <button
            type="button"
            className="household-leave text-button"
            disabled={pending}
            onClick={() => openConfirmation({ kind: "leave" })}
          >
            Leave household
          </button>
        )}
      </section>
      {owner && (
        <details className="household-panel household-ownership">
          <summary>Ownership and deletion</summary>
          <div className="household-form">
            <p>
              Transfer ownership before leaving. The new owner needs Pro to
              manage invitations.
            </p>
            <label className="shopping-field">
              New owner
              <select
                value={newOwner}
                disabled={pending}
                onChange={(event) => setNewOwner(event.target.value)}
              >
                <option value="">Choose a member</option>
                {household.members
                  .filter((member) => member.id !== household.ownerId)
                  .map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="button button-small button-outline"
              disabled={pending || !newOwner}
              onClick={() => {
                const member = household.members.find(
                  (entry) => entry.id === newOwner,
                );
                if (member) openConfirmation({ kind: "transfer", ...member });
              }}
            >
              Transfer ownership
            </button>
            <div className="household-delete">
              <p>
                Deleting this household removes its shared meals and shopping
                list for everyone. Recipe collections and personal planners are
                kept.
              </p>
              <button
                type="button"
                className="button button-small button-danger"
                disabled={pending}
                onClick={() => openConfirmation({ kind: "delete" })}
              >
                Delete household
              </button>
            </div>
          </div>
        </details>
      )}
      {confirmation && (
        <OrganiseDialog
          title={
            confirmation.kind === "delete"
              ? "Delete household?"
              : confirmation.kind === "transfer"
                ? "Transfer ownership?"
                : confirmation.kind === "leave"
                  ? "Leave household?"
                  : `Remove ${confirmation.name}?`
          }
          onClose={() => {
            if (!pending) setConfirmation(null);
          }}
        >
          <form
            className="household-form"
            onSubmit={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            {confirmation.kind === "delete" ? (
              <>
                <p>
                  This permanently deletes shared meals, groceries and
                  invitations for everyone in {household.name}. Personal data
                  and collections are kept.
                </p>
                <label className="shopping-field">
                  Type {household.name} to confirm
                  <input
                    autoComplete="off"
                    value={deleteName}
                    disabled={pending}
                    onChange={(event) => setDeleteName(event.target.value)}
                  />
                </label>
              </>
            ) : confirmation.kind === "transfer" ? (
              <p>
                {confirmation.name} will manage members and invitations. You'll
                stay a member and can leave afterwards.
              </p>
            ) : (
              <>
                <p>
                  Household access ends immediately. Meals and groceries already
                  shared will stay in {household.name}.
                </p>
                {confirmation.kind === "leave" && (
                  <label className="shopping-recipe-choice">
                    <input
                      type="checkbox"
                      checked={copyOnLeave}
                      disabled={pending}
                      onChange={(event) => setCopyOnLeave(event.target.checked)}
                    />
                    <span>
                      Copy upcoming meals to my personal planner before leaving
                    </span>
                  </label>
                )}
              </>
            )}
            <ErrorNotice
              message={
                remove.error?.message ??
                transfer.error?.message ??
                destroy.error?.message
              }
            />
            <div className="organise-dialog-footer">
              <button
                type="button"
                className="button button-outline"
                disabled={pending}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`button ${confirmation.kind === "transfer" ? "button-primary" : "button-danger"}`}
                disabled={
                  pending ||
                  (confirmation.kind === "delete" &&
                    deleteName !== household.name)
                }
              >
                {pending
                  ? "Saving..."
                  : confirmation.kind === "delete"
                    ? "Delete permanently"
                    : confirmation.kind === "transfer"
                      ? "Confirm transfer"
                      : confirmation.kind === "leave"
                        ? "Leave household"
                        : "Remove member"}
              </button>
            </div>
          </form>
        </OrganiseDialog>
      )}
    </>
  );
}
