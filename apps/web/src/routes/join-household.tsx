import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { usePlanningScope } from "@/components/households/planning-context";
import { type SignInProvider, SocialSignIn } from "@/components/social-sign-in";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/join-household")({
  component: JoinHousehold,
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
});

function JoinHousehold() {
  const [token, setToken] = useState<string>();
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState<SignInProvider | null>(null);
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const client = useQueryClient();
  const navigate = useNavigate();
  const {
    selectScope,
    household,
    ready,
    error: householdError,
    retry,
  } = usePlanningScope();
  useEffect(() => {
    setToken(window.location.hash.slice(1));
  }, []);
  const valid = !!token && /^[a-f0-9]{64}$/.test(token);
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
        selectScope({ kind: "household", householdId: result.householdId });
        await navigate({ to: "/planner", replace: true });
      },
    }),
  );
  async function signIn(provider: SignInProvider) {
    if (signingIn) return;
    setSigningIn(provider);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}/join-household#${token}`,
      });
      if (result.error) throw new Error("Couldn't sign in. Please try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't sign in.");
      setSigningIn(null);
    }
  }
  return (
    <main id="main-content" className="login-page">
      <div className="login-card">
        <h1>Plan meals together.</h1>
        <LoadingState
          pending={isPending || token === undefined}
          label="Loading invitation..."
        >
          {!valid ? (
            <ErrorNotice message="This invitation link is incomplete. Ask for a new link." />
          ) : !session ? (
            <>
              <p>
                Sign in to see your household invitation. Your personal planner
                and recipe collections stay separate.
              </p>
              <SocialSignIn
                pending={signingIn}
                onSignIn={(provider) => void signIn(provider)}
              />
            </>
          ) : (
            <LoadingState
              pending={preview.isPending || !ready}
              label="Loading invitation..."
            >
              {preview.data && (
                <>
                  <h2>Join {preview.data.name}</h2>
                  <p>
                    You'll share the household meal planner, saved recipe
                    details and shopping list. Your personal planner, groceries
                    and collection memberships stay as they are.
                  </p>
                  {household && household.id !== preview.data.householdId ? (
                    <p role="status">
                      You already belong to {household.name}. Leave that
                      household in{" "}
                      <Link to="/household">household settings</Link> before
                      joining another.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={
                      accept.isPending ||
                      !!householdError ||
                      (!!household && household.id !== preview.data.householdId)
                    }
                    onClick={() => accept.mutate({ token: token ?? "" })}
                  >
                    {accept.isPending ? "Joining..." : "Join household"}
                  </button>
                </>
              )}
              <ErrorNotice
                message={
                  preview.error?.message ??
                  accept.error?.message ??
                  householdError
                }
                retry={householdError ? retry : undefined}
              />
            </LoadingState>
          )}
          <ErrorNotice message={error} />
          <Link to="/planner" className="text-button">
            Back to planner
          </Link>
        </LoadingState>
      </div>
    </main>
  );
}
