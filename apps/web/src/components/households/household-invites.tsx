import type { AppRouter } from "@prep-sheet/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { Copy, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { ErrorNotice } from "@/components/feedback";

type Invites =
  inferRouterOutputs<AppRouter>["households"]["details"]["invites"];

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function HouseholdInvites({
  name,
  link,
  invites,
  pending,
  error,
  onCreate,
  onRevoke,
}: {
  name: string;
  link: string;
  invites: Invites;
  pending: boolean;
  error?: string;
  onCreate: () => void;
  onRevoke: (id: string) => void;
}) {
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
        title: `Join ${name} on Kitchenbinder`,
        url: link,
      });
    } catch {
      /* Share sheet dismissed. */
    }
  }

  return (
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
            {typeof navigator !== "undefined" && "share" in navigator && (
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
          disabled={pending}
          onClick={onCreate}
        >
          <Link2 size={18} aria-hidden="true" />
          {pending ? "Creating link..." : "Create invite link"}
        </button>
      )}
      <ErrorNotice message={error} />
      {invites.length > 0 && (
        <ul className="pantry-list household-invites">
          {invites.map((item) => (
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
                onClick={() => onRevoke(item.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
