import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { household } from "@prep-sheet/db/schema/household";
import { oauthClient, oauthConsent } from "@prep-sheet/db/schema/oauth";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  authorizationMetadata,
  openIdMetadata,
  protectedResourceMetadata,
} from "./metadata";
import { mcpResource } from "./oauth";
import {
  authorize,
  exchangeBody,
  issueToken,
  registerClient,
  signIn,
  testAuth,
} from "./testing/oauth";

const users: string[] = [];
const clients: string[] = [];
afterAll(async () => {
  if (clients.length)
    await db.delete(oauthClient).where(inArray(oauthClient.clientId, clients));
  if (users.length) {
    await db.delete(household).where(inArray(household.ownerId, users));
    await db.delete(user).where(inArray(user.id, users));
  }
  await db.$client.end();
});
describe("assistant OAuth with PostgreSQL", () => {
  it("publishes discovery at the public origin and binds the protected resource", async () => {
    const request = new Request(
      "http://localhost:3001/.well-known/oauth-authorization-server",
    );
    expect(await (await authorizationMetadata(request)).json()).toMatchObject({
      issuer: "http://localhost:3001/api/auth",
      registration_endpoint: "http://localhost:3001/api/auth/oauth2/register",
      code_challenge_methods_supported: ["S256"],
    });
    expect((await openIdMetadata(request)).status).toBe(200);
    expect(await protectedResourceMetadata().json()).toMatchObject({
      resource: mcpResource,
      authorization_servers: ["http://localhost:3001/api/auth"],
    });
  });
  it("requires sign-in, validates PKCE, prevents code replay and revokes access", async () => {
    const { client_id: clientId } = await registerClient();
    clients.push(clientId);
    const login = await signIn(`${randomUUID()}@example.test`);
    users.push(login.user.id);
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "https://assistant.example.test/callback",
      response_type: "code",
      scope: "kitchenbinder",
      resource: mcpResource,
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
    });
    const unsigned = await testAuth.handler(
      new Request(`http://localhost:3001/api/auth/oauth2/authorize?${query}`, {
        headers: { accept: "text/html" },
      }),
    );
    expect(unsigned.headers.get("location")).toContain("/login?");
    const grant = await authorize({ cookie: login.cookie, clientId });
    const wrong = exchangeBody(grant);
    wrong.set("code_verifier", "b".repeat(43));
    const failed = await testAuth.handler(
      new Request("http://localhost:3001/api/auth/oauth2/token", {
        method: "POST",
        body: wrong,
      }),
    );
    expect(failed.ok).toBe(false);
    const tokens = await issueToken(login.cookie, clientId);
    const headers = new Headers({
      authorization: `Bearer ${tokens.access_token}`,
    });
    expect(await testAuth.api.mcpIdentity({ headers })).toMatchObject({
      userId: login.user.id,
      clientId,
    });
    const replay = await testAuth.handler(
      new Request("http://localhost:3001/api/auth/oauth2/token", {
        method: "POST",
        body: exchangeBody(grant),
      }),
    );
    expect(replay.ok).toBe(false);
    const [consent] = await db
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, clientId));
    if (!consent) throw new Error("Missing consent");
    await expect(
      testAuth.api.disconnectAssistant({
        headers: new Headers(),
        body: { id: consent.id },
      }),
    ).rejects.toBeDefined();
    await testAuth.api.disconnectAssistant({
      headers: new Headers({ cookie: login.cookie }),
      body: { id: consent.id },
    });
    await expect(testAuth.api.mcpIdentity({ headers })).rejects.toBeDefined();
    const refresh = await testAuth.handler(
      new Request("http://localhost:3001/api/auth/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token ?? "",
          resource: mcpResource,
        }),
      }),
    );
    expect(refresh.ok).toBe(false);
  });
  it("accepts sessionless identities while retaining token and grant checks", async () => {
    const { client_id: clientId } = await registerClient();
    clients.push(clientId);
    const login = await signIn(`${randomUUID()}@example.test`);
    users.push(login.user.id);
    await issueToken(login.cookie, clientId);
    const [consent] = await db
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, clientId));
    if (!consent) throw new Error("Missing consent");
    const claims = {
      iss: "http://localhost:3001/api/auth",
      sub: login.user.id,
      azp: clientId,
      aud: mcpResource,
      scope: "kitchenbinder offline_access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      kitchenbinder_grant: consent.id,
    };
    const valid = await testAuth.api.signJWT({ body: { payload: claims } });
    expect(
      await testAuth.api.mcpIdentity({
        headers: new Headers({ authorization: `Bearer ${valid.token}` }),
      }),
    ).toMatchObject({ userId: login.user.id, clientId });
    for (const overrides of [
      { aud: "https://wrong.example.test/api" },
      { scope: "offline_access" },
      { kitchenbinder_grant: randomUUID() },
      { cnf: { jkt: "bound-key" } },
      { cnf: null },
      { exp: Math.floor(Date.now() / 1000) - 1 },
    ]) {
      const invalid = await testAuth.api.signJWT({
        body: { payload: { ...claims, ...overrides } },
      });
      await expect(
        testAuth.api.mcpIdentity({
          headers: new Headers({ authorization: `Bearer ${invalid.token}` }),
        }),
      ).rejects.toBeDefined();
    }
    const signatureParts = valid.token.split(".");
    const signature = signatureParts[2];
    if (!signature) throw new Error("Missing signature");
    signatureParts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    await expect(
      testAuth.api.mcpIdentity({
        headers: new Headers({
          authorization: `Bearer ${signatureParts.join(".")}`,
        }),
      }),
    ).rejects.toBeDefined();
  });
});
