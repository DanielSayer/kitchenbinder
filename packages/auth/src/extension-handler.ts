import { env } from "@prep-sheet/env/server";
import { z } from "zod";
import {
  allowedExtensionIds,
  authenticateExtension,
  exchangeExtensionCode,
  issueExtensionCode,
  listExtensions,
  revokeExtension,
  validateAuthorization,
} from "./extensions";
import { auth } from "./index";

export async function handleExtensionRequest(
  request: Request,
): Promise<Response> {
  const action = new URL(request.url).pathname.split("/").at(-1);
  const origin = request.headers.get("origin");
  const websiteOrigin = new URL(env.BETTER_AUTH_URL).origin;
  const extensionId = allowedExtensionIds().find(
    (id) => origin === `chrome-extension://${id}`,
  );
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  const extensionAction = ["token", "me", "disconnect"].includes(action ?? "");
  if (extensionAction) {
    if (!extensionId || !origin)
      return reply({ error: "Extension origin denied." }, 403);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
  } else if (origin !== websiteOrigin) {
    return reply({ error: "Website origin required." }, 403);
  }
  if (request.method !== "POST")
    return reply({ error: "Method not allowed." }, 405);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reply({ error: "JSON required." }, 415);
  try {
    // Bound streaming bodies too; Content-Length alone is not a size limit.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return reply({ error: "Request too large." }, 413);
        }
        chunks.push(next.value);
      }
    }
    const body: unknown = JSON.parse(
      new TextDecoder().decode(Buffer.concat(chunks)) || "{}",
    );
    if (action === "token") {
      const input = validateAuthorization(body);
      if (input.extensionId !== extensionId)
        return reply({ error: "Extension mismatch." }, 403);
      const credential = await exchangeExtensionCode(body);
      return credential
        ? reply(credential)
        : reply({ error: "Connection expired. Please connect again." }, 401);
    }
    if (extensionAction) {
      const connection = await authenticateExtension(request);
      if (!connection)
        return reply({ error: "Please reconnect to Prep Sheet." }, 401);
      if (action === "disconnect") {
        await revokeExtension(connection.account.id, connection.credentialId);
        return reply({ ok: true });
      }
      return reply({
        account: connection.account,
        expiresAt: connection.expiresAt.toISOString(),
      });
    }
    if (action === "validate") {
      validateAuthorization(body);
      return reply({ ok: true });
    }
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return reply({ error: "Sign in to Prep Sheet first." }, 401);
    switch (action) {
      case "authorize":
        return reply({
          redirect: await issueExtensionCode(session.user.id, body),
        });
      case "list":
        return reply(await listExtensions(session.user.id));
      case "revoke": {
        const { id } = z.object({ id: z.uuid() }).parse(body);
        await revokeExtension(session.user.id, id);
        return reply({ ok: true });
      }
      default:
        return reply({ error: "Not found." }, 404);
    }
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error &&
        error.message === "Invalid extension destination")
    ) {
      return reply(
        {
          error: "Invalid connection request. Start again from the extension.",
        },
        400,
      );
    }
    // Never return or log request bodies, credentials or database error details.
    return reply(
      { error: "Couldn't complete the connection. Please try again." },
      503,
    );
  }
}
