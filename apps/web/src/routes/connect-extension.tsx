import { authorizationSchema } from "@prep-sheet/auth/extension-contract";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ErrorNotice } from "@/components/feedback";
import { type SignInProvider, SocialSignIn } from "@/components/social-sign-in";
import { authClient } from "@/lib/auth-client";
import { extensionRequest } from "@/lib/extension-api";

export const Route = createFileRoute("/connect-extension")({
  ssr: false,
  validateSearch: (search) => {
    const parsed = authorizationSchema.safeParse(search);
    return parsed.success ? parsed.data : null;
  },
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  component: ConnectExtension,
});

function ConnectExtension() {
  const input = Route.useSearch();
  const { data: session, isPending } = authClient.useSession();
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState<SignInProvider | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setValid(false);
    extensionRequest("validate", input, z.object({ ok: z.boolean() }))
      .then(() => {
        if (active) setValid(true);
      })
      .catch(() => {
        if (active)
          setError(
            "This connection request is invalid. Start again from the extension.",
          );
      });
    return () => {
      active = false;
    };
  }, [input]);

  async function signIn(provider: SignInProvider) {
    if (signingIn || !valid || isPending) return;
    setSigningIn(provider);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: window.location.pathname + window.location.search,
      });
      if (result.error) throw new Error("Couldn't sign in. Please try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't sign in.");
      setSigningIn(null);
    }
  }

  async function connect() {
    if (busy || !valid || !session || isPending) return;
    setBusy(true);
    setError("");
    try {
      const result = await extensionRequest(
        "authorize",
        input,
        z.object({ redirect: z.string() }),
      );
      window.location.replace(result.redirect);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't connect. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="login-page">
      <div className="login-card">
        <h1>Connect your browser</h1>
        <p>
          Let the Kitchenbinder extension view your collections and save recipes
          you choose to import.
        </p>
        {session && (
          <p>
            Connecting as <strong>{session.user.name}</strong>
            <br />
            {session.user.email}
          </p>
        )}
        <p className="small-note">
          Access lasts 30 days. You can revoke it at any time in Settings.
        </p>
        {session ? (
          <button
            type="button"
            className="button button-primary"
            disabled={!valid || busy || isPending}
            onClick={() => void connect()}
          >
            {busy ? "Connecting..." : "Connect extension"}
          </button>
        ) : (
          <SocialSignIn
            pending={signingIn}
            disabled={!valid || isPending}
            onSignIn={(provider) => void signIn(provider)}
          />
        )}
        <ErrorNotice message={error} />
        <p className="small-note">To cancel, close this window.</p>
      </div>
    </main>
  );
}
