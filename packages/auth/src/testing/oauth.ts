import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { z } from "zod";
import { auth } from "../index";
import { mcpResource } from "../oauth";

// Passwords exist only on this isolated test instance. Production uses social login.
export const testAuth = betterAuth({
  ...auth.options,
  plugins: auth.options.plugins.filter(
    (plugin) => plugin.id !== "tanstack-start-cookies",
  ),
  emailAndPassword: { enabled: true },
});
const redirectResult = z.object({ url: z.string() });
export const tokenResult = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
});
export const registrationResult = z.object({ client_id: z.string() });

export async function registerClient() {
  const response = await testAuth.handler(
    new Request("http://localhost:3001/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test assistant",
        redirect_uris: ["https://assistant.example.test/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }),
  );
  if (response.status !== 201 && response.status !== 200)
    throw new Error(`DCR failed: ${response.status} ${await response.text()}`);
  return registrationResult.parse(await response.json());
}
export async function signIn(email: string) {
  const response = await testAuth.api.signUpEmail({
    body: { name: "MCP test", email, password: "isolated-mcp-password-123456" },
    asResponse: true,
  });
  if (!response.ok) throw new Error(`Signup failed: ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  const session = await testAuth.api.getSession({
    headers: new Headers({ cookie }),
  });
  if (!session) throw new Error("Missing test session");
  return { cookie, user: session.user };
}
export async function authorize({
  cookie,
  clientId,
  resource = mcpResource,
}: {
  cookie: string;
  clientId: string;
  resource?: string;
}) {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://assistant.example.test/callback",
    scope: "kitchenbinder offline_access",
    resource,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(16).toString("hex"),
    prompt: "consent",
  });
  const response = await testAuth.handler(
    new Request(`http://localhost:3001/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie, accept: "text/html" },
    }),
  );
  const location = response.headers.get("location");
  if (!location)
    throw new Error(
      `Authorize failed: ${response.status} ${await response.text()}`,
    );
  const signedQuery = new URL(location, "http://localhost:3001").search.slice(
    1,
  );
  const consentResponse = await testAuth.handler(
    new Request("http://localhost:3001/api/auth/oauth2/consent", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: signedQuery }),
    }),
  );
  if (!consentResponse.ok)
    throw new Error(
      `Consent failed: ${consentResponse.status} ${await consentResponse.text()}`,
    );
  const consent = await consentResponse.json();
  const callback = new URL(redirectResult.parse(consent).url);
  if (callback.searchParams.get("state") !== query.get("state"))
    throw new Error("OAuth state mismatch");
  const code = callback.searchParams.get("code");
  if (!code)
    throw new Error(
      `No authorisation code: ${callback.searchParams.get("error")}`,
    );
  return { code, verifier, clientId, resource };
}
export function exchangeBody(grant: Awaited<ReturnType<typeof authorize>>) {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: grant.clientId,
    code: grant.code,
    code_verifier: grant.verifier,
    redirect_uri: "https://assistant.example.test/callback",
    resource: grant.resource,
  });
}
export async function issueToken(cookie: string, clientId: string) {
  const grant = await authorize({ cookie, clientId });
  const response = await testAuth.handler(
    new Request("http://localhost:3001/api/auth/oauth2/token", {
      method: "POST",
      body: exchangeBody(grant),
    }),
  );
  if (!response.ok)
    throw new Error(
      `Token exchange failed: ${response.status} ${await response.text()}`,
    );
  return tokenResult.parse(await response.json());
}
