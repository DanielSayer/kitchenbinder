import { authorizationMetadata } from "@prep-sheet/auth/metadata";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute(
  "/.well-known/oauth-authorization-server/api/auth",
)({
  server: {
    handlers: { GET: ({ request }) => authorizationMetadata(request) },
  },
});
