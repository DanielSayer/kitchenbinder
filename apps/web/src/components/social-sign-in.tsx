import { SignInProviders } from "./sign-in-providers";

export type SignInProvider = "google" | "discord";

export function SocialSignIn({
  pending,
  disabled = false,
  onSignIn,
}: {
  pending: SignInProvider | null;
  disabled?: boolean;
  onSignIn: (provider: SignInProvider) => void;
}) {
  return (
    <SignInProviders>
      {(providers) => (
        <div className="social-sign-in" aria-busy={pending !== null}>
          {providers.includes("google") && (
            <button
              type="button"
              className="social-provider-button social-provider-button-google"
              disabled={disabled || pending !== null}
              onClick={() => onSignIn("google")}
            >
              <img src="/auth/google-g.png" alt="" width="20" height="20" />
              <span>
                {pending === "google"
                  ? "Connecting to Google..."
                  : "Continue with Google"}
              </span>
            </button>
          )}
          {providers.includes("discord") && (
            <button
              type="button"
              className="social-provider-button social-provider-button-discord"
              disabled={disabled || pending !== null}
              onClick={() => onSignIn("discord")}
            >
              <img src="/auth/discord-mark.svg" alt="" width="27" height="20" />
              <span>
                {pending === "discord"
                  ? "Connecting to Discord..."
                  : "Continue with Discord"}
              </span>
            </button>
          )}
        </div>
      )}
    </SignInProviders>
  );
}
