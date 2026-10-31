import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

const labels = {
  queued: "Queued",
  fetching: "Reading recipe",
  processing: "Creating recipe",
  ready: "Saving recipe",
  saved: "Completed",
  failed: "Failed",
};

export function RecentImports() {
  const { data: session } = authClient.useSession();
  return session ? (
    <AccountImports key={session.user.id} userId={session.user.id} />
  ) : null;
}

function AccountImports({ userId }: { userId: string }) {
  const trpc = useTRPC();
  // Include the account in the cache key without changing the tRPC procedure path.
  const options = trpc.recipes.recentImports.queryOptions({
    accountId: userId,
  });
  const imports = useQuery({
    ...options,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      query.state.data?.some(
        (job) => job.state !== "saved" && job.state !== "failed",
      )
        ? 2000
        : false,
  });

  return (
    <main
      id="main-content"
      className="recent-imports collection-page page-width"
      aria-labelledby="recent-imports-heading"
    >
      <Link to="/recipes" className="back-link">
        <ArrowLeft size={17} aria-hidden="true" /> Back to recipes
      </Link>
      <div className="page-heading">
        <div>
          <h1 id="recent-imports-heading">Recent imports</h1>
          <p>
            Your latest 50 imports across devices. Active imports appear first.
          </p>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={imports.isFetching}
          onClick={() => void imports.refetch()}
        >
          <RefreshCw size={17} aria-hidden="true" /> Refresh
        </button>
      </div>
      {imports.isPending && <p role="status">Loading imports…</p>}
      {imports.isError && (
        <p role="alert">Couldn't load imports. Refresh to try again.</p>
      )}
      {imports.data?.length === 0 && (
        <p>No imports yet. Add a recipe to get started.</p>
      )}
      {!!imports.data?.length && (
        <ul className="recent-imports-list">
          {imports.data.map((job) => (
            <li key={job.id}>
              <div className="recent-imports-detail">
                <strong>
                  {job.state === "saved" && job.recipes.length > 1
                    ? `${job.recipes.length} recipes`
                    : job.state === "saved" && job.title
                      ? job.title
                      : job.sourceUrl ||
                        (job.sourceKind === "photo"
                          ? "Photo import"
                          : "Recipe import")}
                </strong>
                <time dateTime={new Date(job.createdAt).toISOString()}>
                  {new Date(job.createdAt).toLocaleString()}
                </time>
                <small>Import reference: {job.id}</small>
                {job.state === "failed" && (
                  <p className="recent-imports-error">
                    {job.error ||
                      "Import failed. Start a new attempt to try again."}
                  </p>
                )}
                {job.state === "saved" && !job.recipeId && (
                  <p>This recipe was deleted or you no longer have access.</p>
                )}
              </div>
              <div className="recent-imports-actions">
                <span role="status">
                  {job.state === "queued" &&
                  Date.now() - new Date(job.createdAt).getTime() >= 30_000
                    ? "Waiting to start"
                    : labels[job.state]}
                </span>
                {job.state === "saved" &&
                  job.recipes.map((saved) => (
                    <Link
                      key={saved.id}
                      className="text-button"
                      to="/recipes/$recipeId"
                      params={{ recipeId: saved.id }}
                      aria-label={`Open ${saved.title}`}
                    >
                      {job.recipes.length > 1 ? saved.title : "Open recipe"}{" "}
                      <ArrowRight size={17} aria-hidden="true" />
                    </Link>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
