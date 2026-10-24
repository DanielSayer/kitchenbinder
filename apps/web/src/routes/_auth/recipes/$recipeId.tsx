import { createFileRoute } from "@tanstack/react-router";
import { RecipeDetail } from "@/components/recipes/recipe-detail";

export const Route = createFileRoute("/_auth/recipes/$recipeId")({
  ssr: false,
  // `cook` opens cook mode over the recipe, so Back closes it.
  validateSearch: (search: Record<string, unknown>): { cook?: boolean } => ({
    cook: search.cook === true || search.cook === "true" ? true : undefined,
  }),
  component: Page,
});

function Page() {
  return <RecipeDetail id={Route.useParams().recipeId} />;
}
