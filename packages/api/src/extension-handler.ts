import { handleExtensionRequest as handleAccountRequest } from "@prep-sheet/auth/extension-handler";
import {
  allowedExtensionIds,
  authenticateExtension,
} from "@prep-sheet/auth/extensions";
import { db } from "@prep-sheet/db";
import { extensionRate } from "@prep-sheet/db/schema/import";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  discardImport,
  importCollections,
  importStatus,
  submitImport,
} from "./imports";

export async function handleExtensionRequest(request: Request): Promise<Response> {
  const action = new URL(request.url).pathname.split("/").at(-1);
  if (
    !["collections", "import", "import-status", "discard-import"].includes(
      action ?? "",
    )
  )
    return handleAccountRequest(request);
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { headers, status });
  if (
    !allowedExtensionIds().some(
      (id) => origin === `chrome-extension://${id}`,
    ) ||
    !origin
  )
    return reply({ error: "Extension origin denied." }, 403);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (request.method === "OPTIONS")
    return new Response(null, { headers, status: 204 });
  if (request.method !== "POST")
    return reply({ error: "Method not allowed." }, 405);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reply({ error: "JSON required." }, 415);
  try {
    const connection = await authenticateExtension(request);
    if (!connection)
      return reply({ error: "Please reconnect to Prep Sheet." }, 401);
    const scope =
      action === "collections" ? "collections:read" : "recipes:import";
    if (!connection.scope.split(" ").includes(scope))
      return reply(
        { error: "This connection does not allow that operation." },
        403,
      );
    const userId = connection.account.id;
    const [rate] = await db
      .insert(extensionRate)
      .values({ userId, window: new Date(), requests: 1 })
      .onConflictDoUpdate({
        target: extensionRate.userId,
        set: {
          requests: sql`case when ${extensionRate.window} < now() - interval '1 minute' then 1 else ${extensionRate.requests} + 1 end`,
          window: sql`case when ${extensionRate.window} < now() - interval '1 minute' then now() else ${extensionRate.window} end`,
        },
      })
      .returning({ requests: extensionRate.requests });
    if ((rate?.requests ?? 0) > 60) {
      headers.set("Retry-After", "60");
      return reply({ error: "Too many requests. Try again in a minute." }, 429);
    }
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const limit =
      action === "import" || action === "discard-import" ? 200_000 : 4096;
    if (reader)
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return reply({ error: "Request too large." }, 413);
        }
        chunks.push(next.value);
      }
    const body: unknown = JSON.parse(
      new TextDecoder().decode(Buffer.concat(chunks)) || "{}",
    );
    if (action === "collections") {
      z.strictObject({}).parse(body);
      return reply(await importCollections(userId));
    }
    if (action === "import")
      return reply(await submitImport(userId, body), 202);
    if (action === "discard-import") {
      await discardImport(userId, body);
      return reply({ ok: true });
    }
    const { id } = z.strictObject({ id: z.uuid() }).parse(body);
    return reply(await importStatus(userId, id));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return reply(
        {
          error:
            "Invalid import request. Check the captured recipe and source link.",
        },
        400,
      );
    if (error instanceof TRPCError) {
      const codes: Partial<Record<TRPCError["code"], number>> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        CONFLICT: 409,
        TOO_MANY_REQUESTS: 429,
        BAD_REQUEST: 400,
      };
      return reply({ error: error.message }, codes[error.code] ?? 503);
    }
    return reply(
      {
        error:
          "Couldn't reach the import service. Your request can be retried with the same ID.",
      },
      503,
    );
  }
}
