import { getRecipe } from "@prep-sheet/api/routers/recipes";
import { auth } from "@prep-sheet/auth";
import { createFileRoute } from "@tanstack/react-router";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const Route = createFileRoute("/api/recipes/$recipeId/pdf")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session)
          return new Response("Sign in to open this recipe.", { status: 401 });
        if (!z.uuid().safeParse(params.recipeId).success)
          return new Response("Recipe not found.", { status: 404 });
        try {
          const recipe = await getRecipe(params.recipeId, session.user.id);
          const { recipePdf } = await import("@prep-sheet/api/recipes/pdf");
          const pdf = await recipePdf(
            recipe.content,
            recipe.sourceUrl,
            recipe.origin,
          );
          return new Response(new Uint8Array(pdf), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": 'inline; filename="recipe.pdf"',
              "Cache-Control": "private, no-store",
            },
          });
        } catch (error) {
          return new Response("Couldn't open this recipe.", {
            status:
              error instanceof TRPCError && error.code === "NOT_FOUND"
                ? 404
                : 500,
          });
        }
      },
    },
  },
});
