import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";
import { auth } from "./index";

function setup() {
  return betterAuth({
    ...auth.options,
    database: memoryAdapter({
      user: [],
      account: [],
      session: [],
      verification: [],
    }),
    baseURL: "http://localhost:3001",
    secret: "test-secret-only-not-used-outside-tests-123456789",
    plugins: [],
    // Only the test instance has passwords, to establish real signed sessions.
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: { clientId: "test-google", clientSecret: "test-secret" },
      discord: { clientId: "test-discord", clientSecret: "test-secret" },
    },
  });
}

async function session(testAuth: ReturnType<typeof setup>) {
  const response = await testAuth.api.signUpEmail({
    body: {
      name: "Test",
      email: "test@example.com",
      password: "test-password-123456",
    },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  });
}

describe("social sign-in", () => {
  it.each(["sign-in", "link", "valid-link"])(
    "enforces account ownership during %s callbacks",
    async (mode) => {
      const testAuth = setup();
      const headers = await session(testAuth);
      const current = await testAuth.api.getSession({ headers });
      if (!current) throw new Error("Missing test session");
      const context = await testAuth.$context;
      await context.internalAdapter.updateUser(current.user.id, {
        emailVerified: true,
      });
      const google = context.socialProviders.find(
        (provider) => provider.id === "google",
      );
      if (!google) throw new Error("Missing Google provider");
      // Only the external provider is mocked; cookies, state, callbacks and persistence are real.
      vi.spyOn(google, "validateAuthorizationCode").mockResolvedValue({
        accessToken: "test-token",
        scopes: ["email"],
      });
      vi.spyOn(google, "getUserInfo").mockResolvedValue({
        user: {
          name: "Test",
          email: mode === "link" ? "different@example.com" : "test@example.com",
          emailVerified: true,
        },
        data: { sub: "google-test-id" },
      });
      const started =
        mode === "sign-in"
          ? await testAuth.api.signInSocial({
              body: {
                provider: "google",
                callbackURL: "/",
                errorCallbackURL: "/login",
                disableRedirect: true,
              },
              returnHeaders: true,
            })
          : await testAuth.api.linkSocialAccount({
              headers,
              body: {
                provider: "google",
                callbackURL: "/settings",
                errorCallbackURL: "/login",
                disableRedirect: true,
              },
              returnHeaders: true,
            });
      const state = new URL(started.response.url ?? "").searchParams.get(
        "state",
      );
      if (!state) throw new Error("Missing OAuth state");
      const response = await testAuth.handler(
        new Request(
          `http://localhost:3001/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
          {
            headers: {
              cookie: started.headers
                .getSetCookie()
                .map((cookie) => cookie.split(";")[0])
                .join("; "),
            },
          },
        ),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain(
        mode === "sign-in"
          ? "account_not_linked"
          : mode === "link"
            ? "email_does_not_match"
            : "/settings",
      );
      const accounts = await testAuth.api.listUserAccounts({ headers });
      expect(accounts.some((account) => account.providerId === "google")).toBe(
        mode === "valid-link",
      );
      if (mode === "valid-link") {
        expect(
          accounts.find((account) => account.providerId === "google"),
        ).toMatchObject({ accountId: "google-test-id" });
      }
    },
  );

  it("starts Google OAuth with the expected callback", async () => {
    const testAuth = setup();
    const result = await testAuth.api.signInSocial({
      body: {
        provider: "google",
        callbackURL: "/join#invite",
        disableRedirect: true,
      },
    });
    expect(result.url).toBeDefined();
    const url = new URL(result.url ?? "");
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/auth/callback/google",
    );
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("rejects unauthenticated account linking", async () => {
    const testAuth = setup();
    await expect(
      testAuth.api.linkSocialAccount({
        headers: new Headers(),
        body: { provider: "google", callbackURL: "/settings" },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("allows a fresh session to start explicit linking and rejects an old session", async () => {
    const testAuth = setup();
    const headers = await session(testAuth);
    const result = await testAuth.api.linkSocialAccount({
      headers,
      body: {
        provider: "google",
        callbackURL: "/settings",
        disableRedirect: true,
      },
    });
    expect(result.url).toContain("accounts.google.com");
    const current = await testAuth.api.getSession({ headers });
    if (!current) throw new Error("Missing test session");
    const context = await testAuth.$context;
    await context.internalAdapter.updateSession(current.session.token, {
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });
    await expect(
      testAuth.api.linkSocialAccount({
        headers,
        body: { provider: "google", callbackURL: "/settings" },
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      body: { code: "SESSION_NOT_FRESH" },
    });
  });
});
