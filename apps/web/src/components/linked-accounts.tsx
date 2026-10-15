import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { authClient } from "@/lib/auth-client";
import { SignInProviders } from "./sign-in-providers";
import type { SignInProvider } from "./social-sign-in";

export function LinkedAccounts() {
  const [pending, setPending] = useState<SignInProvider | null>(null);
  const [error, setError] = useState("");
  const accounts = useQuery({
    queryKey: ["linked-sign-in-accounts"],
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) throw new Error("Couldn't load your sign-in methods.");
      return result.data;
    },
  });

  async function link(provider: SignInProvider) {
    if (pending) return;
    setPending(provider);
    setError("");
    try {
      const result = await authClient.linkSocial({
        provider,
        callbackURL: "/settings",
        errorCallbackURL: "/login?error=link_failed",
      });
      if (result.error) {
        throw new Error(
          result.error.code === "SESSION_NOT_FRESH"
            ? "Sign out and sign in again before linking another method."
            : "Couldn't link this sign-in method. Please try again.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't link this sign-in method.",
      );
      setPending(null);
    }
  }

  return (
    <div className="linked-accounts">
      <h3>Sign-in methods</h3>
      <p>Use the same email address to link another sign-in method.</p>
      {accounts.isPending ? (
        <p role="status">Loading sign-in methods...</p>
      ) : accounts.isError ? (
        <ErrorNotice
          message="Couldn't load your sign-in methods."
          retry={() => void accounts.refetch()}
        />
      ) : (
        <SignInProviders>
          {(providers) => (
            <div className="help-actions">
              {providers.map((provider) => {
                const linked = accounts.data?.some(
                  (account) => account.providerId === provider,
                );
                const name = provider === "google" ? "Google" : "Discord";
                return linked ? (
                  <span key={provider}>{name} linked</span>
                ) : (
                  <button
                    key={provider}
                    type="button"
                    className="button button-outline"
                    disabled={pending !== null}
                    onClick={() => void link(provider)}
                  >
                    {pending === provider
                      ? `Connecting to ${name}...`
                      : `Link ${name}`}
                  </button>
                );
              })}
            </div>
          )}
        </SignInProviders>
      )}
      <ErrorNotice message={error} />
    </div>
  );
}
