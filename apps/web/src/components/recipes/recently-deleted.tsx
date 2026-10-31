import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { useTRPC } from "@/utils/trpc";
import { useRestoreRecipe } from "./use-restore-recipe";

// The caller's own deleted recipes; only owners delete and restore.
export function RecentlyDeleted() {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.recipes.recentlyDeleted.queryOptions(undefined, {
      refetchOnWindowFocus: "always",
    }),
  );
  const restore = useRestoreRecipe();
  return (
    <main id="main-content" className="collection-page page-width">
      <Link to="/recipes" className="back-link">
        <ArrowLeft size={17} /> Back to recipes
      </Link>
      <div className="page-heading">
        <div>
          <h1>
            Recently deleted<span className="title-dot">.</span>
          </h1>
          <p>
            Restore recipes within 30 days of deletion. Restored recipes keep
            their sharing.
          </p>
        </div>
      </div>
      <LoadingState
        pending={query.isPending}
        label="Loading deleted recipes..."
      >
        <ErrorNotice
          message={query.error?.message}
          retry={() => void query.refetch()}
        />
        <ErrorNotice
          message={restore.error?.message}
          retry={() => {
            restore.reset();
            void query.refetch();
          }}
        />
        {query.isSuccess && query.data.length === 0 && (
          <div className="empty-collection">
            <span className="empty-icon">
              <Trash2 size={28} aria-hidden="true" />
            </span>
            <h2>No recently deleted recipes</h2>
            <p>Recipes you delete will appear here for 30 days.</p>
          </div>
        )}
        {query.isSuccess && query.data.length > 0 && (
          <ul className="deleted-recipes" aria-label="Recently deleted recipes">
            {query.data.map((recipe) => {
              if (!recipe.deletedAt || !recipe.expiresAt) return null;
              const expiry = new Date(recipe.expiresAt);
              const remaining = Math.max(
                0,
                Math.ceil((expiry.getTime() - Date.now()) / 86_400_000),
              );
              const pending =
                restore.isPending && restore.variables?.id === recipe.id;
              return (
                <li key={recipe.id} className="deleted-recipe">
                  <div>
                    <h2>{recipe.title}</h2>
                    <p>
                      Deleted{" "}
                      {new Date(recipe.deletedAt).toLocaleDateString("en-AU")}
                    </p>
                    <p
                      className="deleted-recipe-expiry"
                      title={`Recoverable until ${expiry.toLocaleString("en-AU")}`}
                    >
                      {remaining === 0
                        ? "Recovery period ended"
                        : `${remaining} ${remaining === 1 ? "day" : "days"} left to restore`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button button-small button-outline"
                    disabled={restore.isPending || remaining === 0}
                    aria-label={`Restore ${recipe.title}`}
                    onClick={() => restore.mutate({ id: recipe.id })}
                  >
                    <RotateCcw size={17} aria-hidden="true" />{" "}
                    {pending ? "Restoring..." : "Restore"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </LoadingState>
    </main>
  );
}
