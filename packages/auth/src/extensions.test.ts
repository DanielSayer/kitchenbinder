import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { session, user } from "@prep-sheet/db/schema/auth";
import {
  extensionCredential,
  extensionGrant,
} from "@prep-sheet/db/schema/extension";
import { env } from "@prep-sheet/env/server";
import { makeSignature } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { handleExtensionRequest } from "./extension-handler";
import {
  authenticateExtension,
  exchangeExtensionCode,
  hashSecret,
  issueExtensionCode,
  listExtensions,
  revokeExtension,
  validateAuthorization,
} from "./extensions";
import { auth } from "./index";

const owner = randomUUID();
const other = randomUUID();
const extensionId = "kjmnecmcpdklkaaiklbfoialfdiamabj";
const origin = `chrome-extension://${extensionId}`;
const random = () => randomBytes(32).toString("base64url");
async function grant() {
  const verifier = random();
  const input = {
    extensionId,
    redirectUri: `https://${extensionId}.chromiumapp.org/prep-sheet`,
    state: random(),
    challenge: hashSecret(verifier),
  };
  const callback = new URL(await issueExtensionCode(owner, input));
  expect(callback.searchParams.get("state")).toBe(input.state);
  return { ...input, verifier, code: callback.searchParams.get("code") };
}
const request = (
  action: string,
  body: unknown = {},
  requestOrigin = origin,
  token?: string,
) =>
  new Request(`${env.BETTER_AUTH_URL}/api/extensions/${action}`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("extension authentication with PostgreSQL", () => {
  it("authorizes using a real Better Auth session and revokes through website controls", async () => {
    const context = await auth.$context;
    const sessionToken = random();
    await db.insert(session).values({
      id: randomUUID(),
      token: sessionToken,
      userId: owner,
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    });
    const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${sessionToken}.${await makeSignature(sessionToken, env.BETTER_AUTH_SECRET)}`)}`;
    const websiteRequest = (action: string, body: unknown) => {
      const req = request(action, body, new URL(env.BETTER_AUTH_URL).origin);
      req.headers.set("Cookie", cookie);
      return req;
    };
    const input = await grant();
    const consent = await handleExtensionRequest(
      websiteRequest("authorize", input),
    );
    expect(consent.status).toBe(200);
    const result = z
      .object({ redirect: z.string() })
      .parse(await consent.json());
    const credential = await exchangeExtensionCode({
      ...input,
      code: new URL(result.redirect).searchParams.get("code"),
    });
    if (!credential) throw new Error("Missing test credential");
    const access = await authenticateExtension(
      request("me", {}, origin, credential.token),
    );
    if (!access) throw new Error("Missing access");
    expect(
      (await handleExtensionRequest(websiteRequest("list", {}))).status,
    ).toBe(200);
    expect(
      (
        await handleExtensionRequest(
          websiteRequest("revoke", { id: access.credentialId }),
        )
      ).status,
    ).toBe(200);
    expect(
      await authenticateExtension(request("me", {}, origin, credential.token)),
    ).toBeNull();
  });
  beforeAll(async () => {
    await db.insert(user).values(
      [owner, other].map((id) => ({
        id,
        name: "Extension test",
        email: `${id}@example.test`,
      })),
    );
  });
  afterAll(async () => {
    await db.delete(user).where(inArray(user.id, [owner, other]));
    await db.$client.end();
  });
  it("accepts only exact registered IDs and callback destinations", async () => {
    const input = await grant();
    for (const redirectUri of [
      "https://evil.test",
      `${input.redirectUri}?extra=1`,
      `${input.redirectUri}/`,
      input.redirectUri.replace("https:", "http:"),
      `https://${extensionId}.chromiumapp.org.evil.test/prep-sheet`,
    ]) {
      expect(() => validateAuthorization({ ...input, redirectUri })).toThrow();
    }
    expect(() =>
      validateAuthorization({ ...input, extensionId: "a".repeat(32) }),
    ).toThrow();
  });
  it("requires correct PKCE, state and binding before allowing one concurrent exchange", async () => {
    const input = await grant();
    expect(
      await exchangeExtensionCode({ ...input, verifier: random() }),
    ).toBeNull();
    expect(
      await exchangeExtensionCode({ ...input, state: random() }),
    ).toBeNull();
    expect(
      await exchangeExtensionCode({ ...input, challenge: random() }),
    ).toBeNull();
    const results = await Promise.all([
      exchangeExtensionCode(input),
      exchangeExtensionCode(input),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await exchangeExtensionCode(input)).toBeNull();
    const credential = results.find((result) => result !== null);
    if (!credential) throw new Error("Missing test credential");
    expect(credential.account.id).toBe(owner);
    const [stored] = await db
      .select()
      .from(extensionCredential)
      .where(eq(extensionCredential.tokenHash, hashSecret(credential.token)));
    expect(stored?.tokenHash).not.toBe(credential.token);
    expect(stored?.scope).toBe("account:read collections:read recipes:import");
    expect(Date.parse(credential.expiresAt) - Date.now()).toBeGreaterThan(
      29 * 86400_000,
    );
  });
  it("rejects expired codes", async () => {
    const input = await grant();
    await db
      .update(extensionGrant)
      .set({ expiresAt: new Date(0) })
      .where(eq(extensionGrant.codeHash, hashSecret(input.code ?? "")));
    expect(await exchangeExtensionCode(input)).toBeNull();
  });
  it("enforces token origins, per-account revocation and expiry", async () => {
    const credential = await exchangeExtensionCode(await grant());
    if (!credential) throw new Error("Missing test credential");
    const req = request("me", {}, origin, credential.token);
    const access = await authenticateExtension(req);
    if (!access) throw new Error("Missing access");
    expect(access.account.id).toBe(owner);
    expect(
      await authenticateExtension(
        request("me", {}, "https://evil.test", credential.token),
      ),
    ).toBeNull();
    expect(await authenticateExtension(request("me"))).toBeNull();
    expect(await listExtensions(other)).toHaveLength(0);
    await revokeExtension(other, access.credentialId);
    expect(await authenticateExtension(req)).not.toBeNull();
    await revokeExtension(owner, access.credentialId);
    expect(await authenticateExtension(req)).toBeNull();
    const expiring = await exchangeExtensionCode(await grant());
    if (!expiring) throw new Error("Missing test credential");
    await db
      .update(extensionCredential)
      .set({ expiresAt: new Date(0) })
      .where(eq(extensionCredential.tokenHash, hashSecret(expiring.token)));
    expect(
      await authenticateExtension(request("me", {}, origin, expiring.token)),
    ).toBeNull();
  });
  it("keeps website cookies separate and requires same-origin consent", async () => {
    const website = new URL(env.BETTER_AUTH_URL).origin;
    expect(
      (
        await handleExtensionRequest(
          request("authorize", {}, "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleExtensionRequest(request("authorize", {}, origin))).status,
    ).toBe(403);
    expect(
      (await handleExtensionRequest(request("authorize", {}, website))).status,
    ).toBe(401);
    const credential = await exchangeExtensionCode(await grant());
    if (!credential) throw new Error("Missing test credential");
    expect(
      (
        await handleExtensionRequest(
          request("list", {}, website, credential.token),
        )
      ).status,
    ).toBe(401);
    const me = await handleExtensionRequest(
      request("me", {}, origin, credential.token),
    );
    expect(me.status).toBe(200);
    expect(me.headers.get("access-control-allow-origin")).toBe(origin);
    expect(me.headers.get("access-control-allow-credentials")).toBeNull();
    expect(me.headers.get("cache-control")).toBe("no-store");
    expect(
      (
        await handleExtensionRequest(
          request("disconnect", {}, origin, credential.token),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleExtensionRequest(
          request("me", {}, origin, credential.token),
        )
      ).status,
    ).toBe(401);
  });
  it("limits bodies and rejects untrusted preflights", async () => {
    expect(
      (
        await handleExtensionRequest(
          request("token", { value: "x".repeat(5000) }),
        )
      ).status,
    ).toBe(413);
    expect((await handleExtensionRequest(request("token", {}))).status).toBe(
      400,
    );
    const preflight = (value: string) =>
      new Request(`${env.BETTER_AUTH_URL}/api/extensions/token`, {
        method: "OPTIONS",
        headers: { Origin: value },
      });
    expect((await handleExtensionRequest(preflight(origin))).status).toBe(204);
    const denied = await handleExtensionRequest(preflight("https://evil.test"));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
