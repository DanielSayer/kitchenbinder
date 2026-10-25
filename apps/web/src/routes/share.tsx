import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import {
  importDraftKey,
  readImportQueue,
  writeImportQueue,
} from "@/components/home/import-draft";
import {
  readPendingShare,
  type SharedPayload,
  sharedRecipeInput,
  writePendingShare,
} from "@/components/home/shared-recipe";
import {
  readSavedHousehold,
  useHousehold,
} from "@/components/households/household-context";
import { authClient } from "@/lib/auth-client";

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;

// The installed app's share target (see site.webmanifest).
export const Route = createFileRoute("/share")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SharedPayload => ({
    title: text(search.title),
    text: text(search.text),
    url: text(search.url),
  }),
  component: Share,
});

function Share() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id;
  const { households } = useHousehold();
  const handled = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isPending || handled.current) return;
    // The selected household must be checked against the user's households.
    if (userId && households.isPending) return;
    handled.current = true;
    const input = sharedRecipeInput(search) ?? readPendingShare();
    if (!input) {
      void navigate({ to: "/", replace: true });
      return;
    }
    if (!userId) {
      // Login returns here once the share is stored.
      if (!writePendingShare(input)) {
        setError("Couldn't keep this recipe while you sign in. Try again.");
        return;
      }
      void navigate({ to: "/login", replace: true });
      return;
    }
    const key = importDraftKey(userId);
    // Read storage directly: the household selection loads after this effect.
    // As in the composer, a household the user left or a personal one is "Just me".
    const saved = readSavedHousehold(userId);
    const household = households.data?.find((item) => item.id === saved);
    const householdId =
      households.data && (!household || household.personal) ? null : saved;
    const next = { id: crypto.randomUUID(), input, householdId };
    if (!writeImportQueue(key, [...readImportQueue(key), next])) {
      setError("Couldn't add this recipe in this browser. Try again.");
      return;
    }
    writePendingShare(null);
    void navigate({ to: "/", replace: true });
  }, [
    isPending,
    userId,
    households.isPending,
    households.data,
    search,
    navigate,
  ]);

  return (
    <main id="main-content" className="page-width">
      {error ? (
        <>
          <ErrorNotice message={error} />
          <Link to="/">Back to kitchenbinder</Link>
        </>
      ) : (
        <LoadingState pending label="Adding your recipe...">
          {null}
        </LoadingState>
      )}
    </main>
  );
}
