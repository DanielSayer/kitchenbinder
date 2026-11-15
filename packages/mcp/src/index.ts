import { createMcpHandler } from "@modelcontextprotocol/server";
import { AccountRequestLimit } from "@prep-sheet/api/account-request-limit";
import { env } from "@prep-sheet/env/server";
import { authenticationRequired, tokenContext } from "./auth";
import { createKitchenBinderServer } from "./server";

export { createKitchenBinderServer } from "./server";

const requests = new AccountRequestLimit(120);
const allowedOrigins = new Set([
  new URL(env.BETTER_AUTH_URL).origin,
  "https://claude.ai",
  "https://chatgpt.com",
  ...env.MCP_ALLOWED_ORIGINS,
  ...(env.NODE_ENV === "development"
    ? ["http://localhost:6274", "http://127.0.0.1:6274"]
    : []),
]);

export async function handleMcpRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin))
    return new Response("Origin not allowed.", { status: 403 });
  const context = await tokenContext(request);
  if (!context?.session) return authenticationRequired();
  const retryAfter = requests.take(context.session.user.id);
  if (retryAfter !== null)
    return new Response("Too many requests. Try again shortly.", {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    });
  const handler = createMcpHandler(() => createKitchenBinderServer(context), {
    // Keep compatibility with Claude/ChatGPT clients on the 2025 revisions.
    legacy: "stateless",
    maxRequestBodySize: 1_572_864,
    maxSubscriptions: 0,
  });
  const response = await handler.fetch(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
