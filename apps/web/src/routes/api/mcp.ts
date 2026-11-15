import { handleMcpRequest } from "@prep-sheet/mcp";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
});
