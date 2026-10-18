import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    <section
      className="connected-extensions"
      aria-labelledby="extensions-heading"
    >
      <h2 id="extensions-heading">Connected extensions</h2>
      <p className="settings-intro">
        Manage browser access to your Kitchenbinder account.
      </p>
      <ErrorNotice
        message={revoke.error?.message || connections.error?.message}
        retry={
          connections.isError ? () => void connections.refetch() : undefined
        }
      />
      <LoadingState pending={connections.isPending}>
        {connections.data?.length === 0 && (
          <p className="muted">No extensions connected.</p>
        )}
        <ul className="settings-tags">
          {connections.data?.map((connection) => (
            <li key={connection.id}>
              <div>
                <strong>Kitchenbinder extension</strong>
                <p>
                  Connected {new Date(connection.createdAt).toLocaleString()}.
                  <br />
                  Expires {new Date(connection.expiresAt).toLocaleDateString()}.
                </p>
                <small className="extension-id">{connection.extensionId}</small>
              </div>
              <button
                className="text-button"
                type="button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(connection.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </LoadingState>
    </section>
  );
}
