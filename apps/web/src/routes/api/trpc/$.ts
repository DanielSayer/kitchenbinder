import { AccountRequestLimit } from "@prep-sheet/api/account-request-limit";
import { createContext } from "@prep-sheet/api/context";
import { appRouter } from "@prep-sheet/api/routers/index";
import { createFileRoute } from "@tanstack/react-router";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPC_MAX_BATCH_SIZE } from "../../../../../../scripts/http-body.mjs";

const accounts = new AccountRequestLimit(120);

function handler({ request }: { request: Request }) {
  let retryAfter: number | null = null;
  return fetchRequestHandler({
    req: request,
    router: appRouter,
    createContext: async (options) => {
      const context = await createContext(options);
      if (context.session) {
        const url = new URL(request.url);
        const cost =
          url.searchParams.get("batch") === "1"
            ? (url.pathname.split("/").at(-1)?.split(",").length ?? 1)
            : 1;
        retryAfter = accounts.take(context.session.user.id, cost);
        if (retryAfter !== null)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many requests. Try again shortly.",
          });
      }
      return context;
    },
    endpoint: "/api/trpc",
    maxBatchSize: TRPC_MAX_BATCH_SIZE,
    responseMeta: () =>
      retryAfter === null
        ? {}
        : {
            headers: {
              "Retry-After": String(retryAfter),
              "Cache-Control": "private, no-store",
            },
          },
  });
}

export const Route = createFileRoute("/api/trpc/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
