import { openIdMetadata } from "@prep-sheet/auth/metadata";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/.well-known/openid-configuration")({
  server: { handlers: { GET: ({ request }) => openIdMetadata(request) } },
});
