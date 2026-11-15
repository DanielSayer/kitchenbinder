import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { authClient } from "@/lib/auth-client";

export function ConnectedAssistants() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const connections = useQuery({
    queryKey: ["connected-assistants"],
    queryFn: async () => {
      const response = await authClient.oauth2.getConsents();
      if (response.error)
        throw new Error("Couldn't load connected assistants.");
      return Promise.all(
        response.data.map(async (consent) => {
          const client = await authClient.oauth2.publicClient({
            query: { client_id: consent.clientId },
          });
          return {
            id: consent.id,
            name: client.data?.client_name || "AI assistant",
          };
        }),
      );
    },
  });
  async function disconnect(id: string) {
    if (pending) return;
    setPending(id);
    setError("");
    try {
      const response = await authClient.$fetch("/mcp/disconnect", {
        method: "POST",
        body: { id },
      });
      if (response.error)
        throw new Error("Couldn't disconnect this assistant. Try again.");
      await connections.refetch();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn't disconnect. Try again.",
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <section aria-labelledby="connected-assistants-title">
      <h2 id="connected-assistants-title" className="grouped-label">
        Connected assistants
      </h2>
      <ErrorNotice message={error} />
      {connections.isPending ? (
        <p role="status">Loading connections...</p>
      ) : connections.isError ? (
        <ErrorNotice
          message="Couldn't load connected assistants."
          retry={() => void connections.refetch()}
        />
      ) : connections.data.length ? (
        <ul className="pantry-list">
          {connections.data.map((connection) => (
            <li className="pantry-row" key={connection.id}>
              <span className="pantry-row-text">
                <b>{connection.name}</b>
              </span>
              <button
                type="button"
                className="button button-ghost button-small"
                disabled={pending !== null}
                aria-label={`Disconnect ${connection.name}`}
                onClick={() => void disconnect(connection.id)}
              >
                {pending === connection.id ? "Disconnecting..." : "Disconnect"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="assistant-note">
          No assistants connected.{" "}
          <Link to="/mcp" className="text-button">
            Connect your AI assistant
          </Link>
        </p>
      )}
    </section>
  );
}
