import type { Context } from "@prep-sheet/api/context";
import { auth } from "@prep-sheet/auth";
import { mcpResource } from "@prep-sheet/auth/oauth";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { eq } from "drizzle-orm";

function assistantContext(account: typeof user.$inferSelect): Context {
  // tRPC's protected procedures use only session.user. This request-local
  // adapter is never persisted and cannot authenticate a browser session.
  const now = new Date();
  return {
    auth: null,
    session: {
      user: account,
      session: {
        id: `mcp:${account.id}`,
        token: "",
        userId: account.id,
        createdAt: now,
        updatedAt: now,
        expiresAt: now,
        ipAddress: null,
        userAgent: null,
      },
    },
  };
}

export async function tokenContext(request: Request): Promise<Context | null> {
  let identity: Awaited<ReturnType<typeof auth.api.mcpIdentity>>;
  try {
    identity = await auth.api.mcpIdentity({ headers: request.headers });
  } catch (error) {
    if (
      error instanceof Error &&
      "statusCode" in error &&
      (error.statusCode === 401 || error.statusCode === 400)
    )
      return null;
    throw error;
  }
  const [result] = await db
    .select()
    .from(user)
    .where(eq(user.id, identity.userId));
  return result ? assistantContext(result) : null;
}
export function authenticationRequired() {
  return Response.json(
    { error: "Sign in to connect your assistant to Kitchenbinder." },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/api/mcp", mcpResource).href}", scope="kitchenbinder"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
