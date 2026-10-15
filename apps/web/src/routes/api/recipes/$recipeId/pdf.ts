import workerUrl from "virtual:pdf-worker";
import {
  PdfExporter,
  PdfResourceError,
} from "@prep-sheet/api/recipes/pdf-execution";
import { getRecipe } from "@prep-sheet/api/routers/recipes";
import { auth } from "@prep-sheet/auth";
import { createFileRoute } from "@tanstack/react-router";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const exporter = new PdfExporter(new URL(workerUrl));
const privateHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute("/api/recipes/$recipeId/pdf")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session)
          return new Response("Sign in to open this recipe.", {
            status: 401,
            headers: privateHeaders,
          });
        if (!z.uuid().safeParse(params.recipeId).success)
          return new Response("Recipe not found.", {
            status: 404,
            headers: privateHeaders,
          });
        try {
          const pdf = await exporter.export({
            accountId: session.user.id,
            signal: request.signal,
            load: async () => {
              const recipe = await getRecipe(params.recipeId, session.user.id);
              return {
                content: recipe.content,
                sourceUrl: recipe.sourceUrl,
                origin: recipe.origin,
              };
            },
          });
          return new Response(new Uint8Array(pdf), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": 'inline; filename="recipe.pdf"',
              "Cache-Control": "private, no-store",
            },
          });
        } catch (error) {
          if (error instanceof PdfResourceError) {
            const status =
              error.kind === "rate"
                ? 429
                : error.kind === "deadline"
                  ? 504
                  : error.kind === "aborted"
                    ? 499
                    : 503;
            return new Response(
              "PDF export is unavailable. Try again shortly.",
              {
                status,
                headers: {
                  ...privateHeaders,
                  "Retry-After": String(error.retryAfter),
                },
              },
            );
          }
          return new Response("Couldn't open this recipe.", {
            headers: privateHeaders,
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
