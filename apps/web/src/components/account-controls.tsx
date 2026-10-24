import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { useTRPC } from "@/utils/trpc";

export function AccountControls() {
  const trpc = useTRPC();
  const client = useQueryClient();
  const deletion = useQuery(trpc.support.deletion.queryOptions());
  const [confirmation, setConfirmation] = useState("");
  const refresh = async () => {
    setConfirmation("");
    await client.invalidateQueries({
      queryKey: trpc.support.deletion.queryKey(),
    });
  };
  const request = useMutation(
    trpc.support.requestDeletion.mutationOptions({ onSuccess: refresh }),
  );
  const cancel = useMutation(
    trpc.support.cancelDeletion.mutationOptions({ onSuccess: refresh }),
  );
  const busy = request.isPending || cancel.isPending;
  return (
    <section className="account-deletion" aria-label="Delete account">
      <div>
        <p>
          Deletion is reviewed manually. Your account stays active until then,
          and you can cancel while pending. Your Google or Discord account is
          unaffected.
        </p>
        <ul>
          <li>
            Cancel Pro in Plan &amp; billing and wait for the subscription to
            end before deletion can be completed.
          </li>
          <li>
            Your personal recipes, tags, favourites, ratings, cooking history,
            shopping lists, meal plans, imports and support reports are removed
            from the live database.
          </li>
          <li>
            Your sessions, extension connections, household memberships and your
            "Just me" household are removed.
          </li>
          <li>
            Recipes you shared with a household stay there without an owner;
            your other recipes, collections and tags are deleted. Copies saved
            by others remain. Review any personal details in shared recipe text
            first.
          </li>
          <li>
            Households you own pass to their longest-standing member, or are
            deleted if you are the only member.
          </li>
        </ul>
        <p>
          Clear this site's browser data on your devices to remove local drafts
          and preferences. <Link to="/privacy">Read the privacy page</Link> for
          more detail.
        </p>
        {deletion.isPending && <p role="status">Loading account details...</p>}
        <ErrorNotice
          message={
            deletion.error ? "Couldn't load your deletion request." : undefined
          }
          retry={() => void deletion.refetch()}
        />
        {deletion.data && (
          <>
            {deletion.data.ownedHouseholds.length > 0 && (
              <div className="account-group-notice">
                <strong>Households you own</strong>
                <ul>
                  {deletion.data.ownedHouseholds.map((item) => (
                    <li key={item.id}>
                      {item.name}:{" "}
                      {item.transferTo
                        ? `passes to ${item.transferTo.name}`
                        : "will be deleted"}
                    </li>
                  ))}
                </ul>
                <Link to="/households" className="text-button">
                  Manage households
                </Link>
              </div>
            )}
            {deletion.data.request ? (
              <div role="status">
                <p>
                  Deletion requested on{" "}
                  {new Date(
                    deletion.data.request.createdAt,
                  ).toLocaleDateString()}
                  . Awaiting manual review.
                </p>
                <p>Reference: {deletion.data.request.id}</p>
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={() => cancel.mutate()}
                >
                  {cancel.isPending
                    ? "Cancelling..."
                    : "Cancel deletion request"}
                </button>
              </div>
            ) : (
              <form
                className="help-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (confirmation === "DELETE" && !busy)
                    request.mutate({ confirmation: "DELETE" });
                }}
              >
                <label htmlFor="delete-confirmation">
                  Type DELETE to request deletion
                </label>
                <input
                  id="delete-confirmation"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                />
                <button
                  type="submit"
                  className="button button-outline"
                  disabled={confirmation !== "DELETE" || busy}
                >
                  {request.isPending
                    ? "Submitting..."
                    : "Submit deletion request"}
                </button>
              </form>
            )}
          </>
        )}
        <ErrorNotice
          message={
            request.error || cancel.error
              ? "Couldn't update your request. Please try again."
              : undefined
          }
        />
      </div>
    </section>
  );
}
