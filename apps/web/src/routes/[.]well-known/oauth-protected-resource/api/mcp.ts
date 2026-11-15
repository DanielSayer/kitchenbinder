import { protectedResourceMetadata } from "@prep-sheet/auth/metadata";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute(
  "/.well-known/oauth-protected-resource/api/mcp",
)({
  server: { handlers: { GET: () => protectedResourceMetadata() } },
});
