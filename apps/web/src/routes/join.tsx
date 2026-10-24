import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { useHousehold } from "@/components/households/household-context";
import {
  householdTone,
  inviteTokenFrom,
} from "@/components/households/household-ui";
import { type SignInProvider, SocialSignIn } from "@/components/social-sign-in";
import { WelcomeArt, WelcomeScreen } from "@/components/welcome";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/join")({
  // Links use the hash (never sent to servers); ?token= also works.
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: JoinHousehold,
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
});

function JoinHousehold() {
  const search = Route.useSearch();
  const [token, setToken] = useState<string | null>();
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState<SignInProvider | null>(null);
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { selectHousehold } = useHousehold();
  useEffect(() => {
    setToken(
      inviteTokenFrom(window.location.hash.slice(1)) ??
        inviteTokenFrom(search.token ?? ""),
    );
  }, [search.token]);
  const valid = !!token;
  const preview = useQuery(
    trpc.households.previewInvite.queryOptions(
      { token: token ?? "" },
      { enabled: !!session && valid, retry: false },
    ),
  );
  const accept = useMutation(
    trpc.households.acceptInvite.mutationOptions({
      onSuccess: async (result) => {
        await client.invalidateQueries({ queryKey: trpc.households.pathKey() });
        selectHousehold(result.householdId);
        toast.success(
          `You're in${preview.data ? ` ${preview.data.name}` : ""}. Plan and shop together.`,
        );
        await navigate({ to: "/recipes", replace: true });
      },
    }),
  );
  async function signIn(provider: SignInProvider) {
    if (signingIn || !token) return;
    setSigningIn(provider);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}/join#${token}`,
      });
      if (result.error) throw new Error("Couldn't sign in. Please try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't sign in.");
      setSigningIn(null);
    }
  }

  const tone = householdTone(preview.data?.color ?? "tomato");
  const name = preview.data?.name;
  const loading = isPending || token === undefined;

  return (
    <WelcomeScreen
      art={<WelcomeArt tone={tone} sharedWith={name ?? "Family"} />}
      title={name ? "Join" : "Cook together,"}
      accent={name ?? "one shared binder."}
      lead={
        !valid && !loading
          ? undefined
          : session
            ? "You'll see recipes shared with this household and plan and shop together. Your own recipes stay private."
            : "Sign in to see your invitation. Your own recipes stay private."
      }
      footer={
        <div className="welcome-links">
          <Link to="/recipes" className="text-button">
            Not now
          </Link>
        </div>
      }
    >
      <LoadingState pending={loading} label="Loading invitation...">
        {!valid ? (
          <ErrorNotice message="This invitation link is incomplete. Ask for a new link." />
        ) : !session ? (
          <SocialSignIn
            pending={signingIn}
            onSignIn={(provider) => void signIn(provider)}
          />
        ) : (
          <LoadingState
            pending={preview.isPending}
            label="Loading invitation..."
          >
            {preview.data && (
              <button
                type="button"
                className="button button-primary button-block"
                disabled={accept.isPending}
                onClick={() => accept.mutate({ token: token ?? "" })}
              >
                {accept.isPending ? "Joining..." : `Join ${preview.data.name}`}
              </button>
            )}
            <ErrorNotice
              message={preview.error?.message ?? accept.error?.message}
            />
          </LoadingState>
        )}
        <ErrorNotice message={error} />
      </LoadingState>
    </WelcomeScreen>
  );
}
