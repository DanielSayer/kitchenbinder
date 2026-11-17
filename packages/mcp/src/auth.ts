import type { Context } from "@prep-sheet/api/context";
import { auth } from "@prep-sheet/auth";
import { mcpResource } from "@prep-sheet/auth/oauth";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { eq } from "drizzle-orm";

type Account = typeof user.$inferSelect;

/**
 * tRPC's protected procedures use only `session.user`. This request-local
 * adapter is never persisted and cannot authenticate a browser session.
 */
function sessionContext(account: Account): Context {
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

function isRejectedToken(error: unknown) {
  return (
    error instanceof Error &&
    "statusCode" in error &&
    (error.statusCode === 401 || error.statusCode === 400)
  );
}

/** Resolve a bearer token to an existing user's context, or null if invalid. */
export async function authenticate(request: Request) {
  let userId: string;
  try {
    ({ userId } = await auth.api.mcpIdentity({ headers: request.headers }));
  } catch (error) {
    if (isRejectedToken(error)) return null;
    throw error;
  }
  const [account] = await db.select().from(user).where(eq(user.id, userId));
  return account ? sessionContext(account) : null;
}

const metadataUrl = new URL(
  "/.well-known/oauth-protected-resource/api/mcp",
  mcpResource,
).href;

/** 401 with the `WWW-Authenticate` pointer clients use to start OAuth. */
export function unauthorized() {
  return Response.json(
    { error: "Sign in to connect your assistant to Kitchenbinder." },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="kitchenbinder"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
