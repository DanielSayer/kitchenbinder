import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { authClient } from "@/lib/auth-client";
import { SignInProviders } from "./sign-in-providers";
import type { SignInProvider } from "./social-sign-in";

const providerNames: Record<SignInProvider, string> = {
  google: "Google",
  discord: "Discord",
};

const providerIcons: Record<SignInProvider, string> = {
  google: "/auth/google-g.png",
  discord: "/auth/discord-mark.svg",
};

/** Sign-in methods linked to this account (shared with the You screen). */
export function useLinkedAccounts() {
  return useQuery({
    queryKey: ["linked-sign-in-accounts"],
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) throw new Error("Couldn't load your sign-in methods.");
      return result.data;
    },
  });
}

/** "Google · Discord" for linked social providers. */
export function linkedProviderNames(
  accounts: readonly { providerId: string }[] | undefined,
) {
  return (accounts ?? [])
    .map((account) => providerNames[account.providerId as SignInProvider])
    .filter(Boolean)
    .join(" · ");
}

export function LinkedAccounts() {
  const [pending, setPending] = useState<SignInProvider | null>(null);
  const [error, setError] = useState("");
  const accounts = useLinkedAccounts();

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
      <p className="settings-intro">
        Sign in with any linked method. Link another one that uses the same
        email address. Manage passwords and security with the provider.
      </p>
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
            <ul className="pantry-list">
              {providers.map((provider) => {
                const linked = accounts.data?.some(
                  (account) => account.providerId === provider,
                );
                const name = providerNames[provider];
                return (
                  <li key={provider} className="pantry-row">
                    <span className="pantry-row-icon">
                      <img
                        src={providerIcons[provider]}
                        alt=""
                        width={20}
                        height={20}
                      />
                    </span>
                    <span className="pantry-row-text">
                      <b>{name}</b>
                      <small>{linked ? "Linked" : "Not linked"}</small>
                    </span>
                    {linked ? (
                      <Check
                        size={20}
                        className="linked-check"
                        aria-label={`${name} linked`}
                      />
                    ) : (
                      <button
                        type="button"
                        className="button button-small button-outline"
                        disabled={pending !== null}
                        onClick={() => void link(provider)}
                      >
                        {pending === provider
                          ? `Connecting to ${name}...`
                          : `Link ${name}`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SignInProviders>
      )}
      <ErrorNotice message={error} />
    </div>
  );
}
