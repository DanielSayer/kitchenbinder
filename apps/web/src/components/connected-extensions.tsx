import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Puzzle } from "lucide-react";
import { z } from "zod";
import { extensionRequest } from "@/lib/extension-api";
import { ErrorNotice, LoadingState } from "./feedback";

const connectionsSchema = z.array(
  z.object({
    id: z.string(),
    extensionId: z.string(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
);
export function ConnectedExtensions() {
  const client = useQueryClient();
  const queryKey = ["connected-extensions"];
  const connections = useQuery({
    queryKey,
    queryFn: () => extensionRequest("list", {}, connectionsSchema),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      extensionRequest("revoke", { id }, z.object({ ok: z.boolean() })),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  return (
    <section className="connected-extensions" aria-label="Connected extensions">
      <p className="settings-intro">
        Browsers where the Kitchenbinder extension can save recipes to your
        account. Revoke any you no longer use.
      </p>
      <ErrorNotice
        message={revoke.error?.message || connections.error?.message}
        retry={
          connections.isError ? () => void connections.refetch() : undefined
        }
      />
      <LoadingState pending={connections.isPending}>
        {connections.data?.length === 0 ? (
          <p className="muted">No extensions connected.</p>
        ) : (
          <ul className="pantry-list">
            {connections.data?.map((connection) => (
              <li key={connection.id} className="pantry-row">
                <span className="pantry-row-icon">
                  <Puzzle size={20} aria-hidden="true" />
                </span>
                <span className="pantry-row-text">
                  <b>Kitchenbinder extension</b>
                  <small>
                    Connected {formatDate(connection.createdAt)} · expires{" "}
                    {formatDate(connection.expiresAt)}
                  </small>
                  <small className="extension-id">
                    {connection.extensionId}
                  </small>
                </span>
                <button
                  className="button button-small button-ghost"
                  type="button"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(connection.id)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </LoadingState>
    </section>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
