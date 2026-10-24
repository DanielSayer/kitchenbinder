import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { type SignInProvider, SocialSignIn } from "@/components/social-sign-in";
import { WelcomeArt, WelcomeScreen } from "@/components/welcome";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { error?: string; billing?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
    billing: search.billing === "1" || search.billing === 1 ? "1" : undefined,
  }),
  component: Login,
});

function Login() {
  const { error: callbackError, billing } = Route.useSearch();
  const [pending, setPending] = useState<SignInProvider | null>(null);
  const [error, setError] = useState(() =>
    callbackError === "account_not_linked" ||
    callbackError === "account not linked"
      ? "An account already uses this email. Sign in with your original method, then link the other method in Settings."
      : callbackError === "link_failed" ||
          callbackError === "email_does_not_match" ||
          callbackError === "account_already_linked_to_different_user" ||
          callbackError === "unable_to_link_account"
        ? "Couldn't link that account. Use the same email address as your Kitchenbinder account and make sure it isn't linked to another account. Return to Settings to try again."
        : callbackError === "access_denied"
          ? "Sign-in was cancelled. You can try again when you're ready."
          : callbackError
            ? "We couldn't finish signing in. Please try again. If it keeps failing, the sign-in settings may need checking."
            : "",
  );

  async function signIn(provider: SignInProvider) {
    if (pending) return;
    setPending(provider);
    setError("");

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: billing ? "/settings?billing=1" : "/",
        errorCallbackURL: billing ? "/login?billing=1" : "/login",
      });

      if (result.error)
        throw new Error(
          "This sign-in method is temporarily unavailable. Please try again or use the other option.",
        );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn't sign in. Please try again.",
      );

      setPending(null);
    }
  }

  return (
    <WelcomeScreen
      art={<WelcomeArt />}
      title="Every recipe,"
      accent="one tidy binder."
      lead={
        billing
          ? "Sign in to choose Pro and check if you can start a free trial."
          : "Paste a link, some text, or just “nan’s pie”. We’ll do the tidying."
      }
      footer={
        <>
          <p className="welcome-fine">
            Free to start · No passwords to remember
          </p>
          <div className="welcome-links">
            <Link to="/privacy" className="text-button">
              Privacy
            </Link>
            <Link to="/support" className="text-button">
              Need help?
            </Link>
          </div>
        </>
      }
    >
      <ErrorNotice message={error} />
      <SocialSignIn
        pending={pending}
        onSignIn={(provider) => void signIn(provider)}
      />
    </WelcomeScreen>
  );
}
