import { createMcpHandler } from "@modelcontextprotocol/server";
import { env } from "@prep-sheet/env/server";
import { authenticate, unauthorized } from "./auth";
import { requestAdmission } from "./limits";
import { createKitchenBinderServer } from "./server";

const allowedOrigins = new Set([
  new URL(env.BETTER_AUTH_URL).origin,
  "https://claude.ai",
  "https://chatgpt.com",
  ...env.MCP_ALLOWED_ORIGINS,
  ...(env.NODE_ENV === "development"
    ? ["http://localhost:6274", "http://127.0.0.1:6274"] // MCP Inspector
    : []),
]);

const handlerOptions = {
  // Keep compatibility with Claude/ChatGPT clients on the 2025 revisions.
  legacy: "stateless",
  // Same 1.5 MiB budget as tRPC.
  maxRequestBodySize: 1_572_864,
  maxSubscriptions: 0,
} as const;

function tooManyRequests(retryAfter: number) {
  return new Response("Too many requests. Try again shortly.", {
    status: 429,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}

/** Serves `/api/mcp`: origin check, bearer auth, admission, then MCP. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin))
    return new Response("Origin not allowed.", { status: 403 });
  const context = await authenticate(request);
  if (!context?.session) return unauthorized();
  const retryAfter = requestAdmission.take(context.session.user.id);
  if (retryAfter !== null) return tooManyRequests(retryAfter);
  const handler = createMcpHandler(
    () => createKitchenBinderServer(context),
    handlerOptions,
  );
  const response = await handler.fetch(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
