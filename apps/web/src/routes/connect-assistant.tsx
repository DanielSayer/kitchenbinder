import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { LargeTitle } from "@/components/pantry";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/connect-assistant")({
  component: Consent,
});

function Consent() {
  const { data: session, isPending } = authClient.useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function decide(accept: boolean) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      // The client plugin sends the provider-signed query from this page.
      const result = await authClient.oauth2.consent({ accept });
      if (result.error || !result.data?.url)
        throw new Error(
          "This connection link has expired. Return to your assistant and try connecting again.",
        );
      window.location.assign(result.data.url);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Couldn't connect. Try again.",
      );
      setPending(false);
    }
  }
  return (
    <main id="main-content" className="page-width assistant-page">
      <LargeTitle>Connect your AI assistant</LargeTitle>
      <section className="assistant-card">
        {isPending ? (
          <p>Checking your sign-in...</p>
        ) : session ? (
          <>
            <p>
              Connect as <strong>{session.user.name}</strong>?
            </p>
            <p>
              Your assistant will be able to read your account profile, recipes,
              households, meal plans and shopping lists. It can save recipes,
              change planned meals and update shopping lists on your behalf,
              including shared households you belong to.
            </p>
            <p>
              Only approve this if you started the connection in your assistant.
              Kitchenbinder Pro is required to use it. You can disconnect in
              Settings at any time.
            </p>
            <ErrorNotice message={error} />
            <div className="assistant-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={pending}
                onClick={() => void decide(true)}
              >
                {pending ? "Connecting..." : "Allow connection"}
              </button>
              <button
                type="button"
                className="button button-ghost"
                disabled={pending}
                onClick={() => void decide(false)}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p>
            Your sign-in has expired. Return to your assistant and start the
            connection again.{" "}
            <Link to="/login" className="text-button">
              Sign in
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
