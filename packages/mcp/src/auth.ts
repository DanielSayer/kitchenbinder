import type { Context } from "@prep-sheet/api/context";
import { auth } from "@prep-sheet/auth";
import { mcpResource } from "@prep-sheet/auth/oauth";
import { db } from "@prep-sheet/db";
import { session, user } from "@prep-sheet/db/schema/auth";
import { and, eq, gt } from "drizzle-orm";

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
    .select({ user, session })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      and(
        eq(session.id, identity.sessionId),
        eq(user.id, identity.userId),
        gt(session.expiresAt, new Date()),
      ),
    );
  return result ? { auth: null, session: result } : null;
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
