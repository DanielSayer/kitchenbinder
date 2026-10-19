import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { aiPolicy } from "./ai-policy";
import { validateProviderConfiguration } from "./providers";

const production = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://recipes.example.test",
  BETTER_AUTH_SECRET: "test-only-signing-secret-at-least-32-characters",
  GOOGLE_CLIENT_ID: "test-google-id",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
  AI_ENABLED: "false",
  BILLING_MODE: "disabled",
};
const billing = {
  BILLING_MODE: "sandbox",
  POLAR_SERVER: "sandbox",
  POLAR_ACCESS_TOKEN: "test-polar-token",
  POLAR_WEBHOOK_SECRET: "test-webhook-secret",
  POLAR_PRO_PRODUCT_ID: "11111111-1111-4111-8111-111111111111",
};

describe("provider configuration", () => {
  it("allows a production manual-entry service with one OAuth provider and AI/billing explicitly off", () => {
    expect(validateProviderConfiguration(production)).toEqual({
      signInProviders: ["google"],
      aiEnabled: false,
      billingMode: "disabled",
      model: "gpt-6-luna",
    });
  });

  it.each([
    { BETTER_AUTH_URL: "http://recipes.example.test" },
    { BETTER_AUTH_URL: "https://recipes.example.test/path" },
    { BETTER_AUTH_URL: "https://recipes.example.test?query=1" },
    { BETTER_AUTH_URL: "https://recipes.example.test#fragment" },
    { BETTER_AUTH_URL: "https://user:secret@recipes.example.test" },
    { GOOGLE_CLIENT_ID: "" },
    { GOOGLE_CLIENT_SECRET: " " },
    { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" },
    { DISCORD_CLIENT_ID: "discord-without-secret" },
    { DISCORD_CLIENT_SECRET: "secret-without-id" },
    { AI_ENABLED: undefined },
    { AI_ENABLED: "true" },
    { OPENAI_API_KEY: "unused-key" },
    {
      AI_ENABLED: "true",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-6-astra",
    },
    { BILLING_MODE: undefined },
    { BILLING_MODE: "sandbox" },
    { POLAR_ACCESS_TOKEN: "unused-token" },
    { ...billing, POLAR_WEBHOOK_SECRET: "" },
    { ...billing, POLAR_PRO_PRODUCT_ID: "" },
    { ...billing, POLAR_ACCESS_TOKEN: "" },
    { ...billing, POLAR_PRO_PRODUCT_ID: "not-a-uuid" },
    { ...billing, POLAR_SERVER: undefined },
    { ...billing, POLAR_SERVER: "production" },
    { ...billing, BILLING_MODE: "production" },
    { SKIP_ENV_VALIDATION: "1" },
  ])("rejects incomplete, mismatched or unsafe settings %j", (overrides) => {
    expect(() =>
      validateProviderConfiguration({ ...production, ...overrides }),
    ).toThrow();
  });

  it.each(["sandbox", "production"])(
    "requires deliberate matching %s billing settings",
    (mode) => {
      expect(
        validateProviderConfiguration({
          ...production,
          ...billing,
          BILLING_MODE: mode,
          POLAR_SERVER: mode,
        }).billingMode,
      ).toBe(mode);
    },
  );

  it("allows only the reviewed model when AI is enabled", () => {
    expect(
      validateProviderConfiguration({
        ...production,
        AI_ENABLED: "true",
        OPENAI_API_KEY: "test-key",
      }).aiEnabled,
    ).toBe(true);
    // A disabled feature cannot call this model and needs no model acceptance.
    expect(
      validateProviderConfiguration({
        ...production,
        OPENAI_MODEL: "future-model",
      }).aiEnabled,
    ).toBe(false);
  });

  it("rejects an enabled envelope whose reviewed cost estimate outgrows its reservation", () => {
    const original = aiPolicy.maxOutputTokens;
    try {
      aiPolicy.maxOutputTokens = 1_000_000;
      expect(() =>
        validateProviderConfiguration({
          ...production,
          AI_ENABLED: "true",
          OPENAI_API_KEY: "test-key",
        }),
      ).toThrow(/exceeds its reservation/);
    } finally {
      aiPolicy.maxOutputTokens = original;
    }
  });

  it("keeps provider-free local development usable but rejects partial local credentials", () => {
    expect(
      validateProviderConfiguration({
        BETTER_AUTH_URL: "http://localhost:3001",
      }).signInProviders,
    ).toEqual([]);
    expect(() =>
      validateProviderConfiguration({
        BETTER_AUTH_URL: "http://localhost:3001",
        GOOGLE_CLIENT_ID: "partial",
      }),
    ).toThrow(/together/);
  });

  const isolated = {
    ...production,
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    BETTER_AUTH_URL: "http://localhost:3001",
    PREP_SHEET_TEST_DATABASE: "isolated",
    DATABASE_URL:
      "postgresql://postgres:test_password@127.0.0.1:59000/prep_sheet_test",
  };
  it("permits synthetic production HTTP only with the isolated topology and no providers", () => {
    expect(validateProviderConfiguration(isolated).signInProviders).toEqual([]);
    expect(
      validateProviderConfiguration({
        ...isolated,
        DATABASE_URL: isolated.DATABASE_URL.replace(
          "127.0.0.1",
          "host.docker.internal",
        ),
      }).aiEnabled,
    ).toBe(false);
  });
  it.each([
    { PREP_SHEET_TEST_DATABASE: undefined, CI: "true" },
    {
      DATABASE_URL:
        "postgresql://postgres:password@127.0.0.1:5432/prep_sheet_test",
    },
    {
      DATABASE_URL: "postgresql://postgres:password@127.0.0.1:59000/prep-sheet",
    },
    {
      DATABASE_URL:
        "postgresql://postgres:password@db.example.test:59000/prep_sheet_test",
    },
    { BETTER_AUTH_URL: "http://public.example.test" },
    { GOOGLE_CLIENT_ID: "test-id", GOOGLE_CLIENT_SECRET: "test-secret" },
    { AI_ENABLED: "true", OPENAI_API_KEY: "test-key" },
    billing,
  ])("rejects widening the synthetic topology %j", (overrides) => {
    expect(() =>
      validateProviderConfiguration({ ...isolated, ...overrides }),
    ).toThrow();
  });

  it("does not expose malformed setting values in diagnostics", () => {
    const secret = "private-value-that-must-not-be-logged";
    try {
      validateProviderConfiguration({
        ...production,
        POLAR_PRO_PRODUCT_ID: secret,
      });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("POLAR_PRO_PRODUCT_ID");
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects unsafe release configuration before a database connection in plain Node", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import { verifyRelease } from './scripts/release-environment.mjs';
      try { await verifyRelease(); process.exitCode = 1; }
      catch (error) { if (!error.message.includes('HTTPS')) throw error; console.log('configuration rejected before database access'); }
    `,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...production,
          PREP_SHEET_TEST_DATABASE: "",
          BETTER_AUTH_URL: "http://unsafe.example.test",
          DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/unreachable",
          OPENAI_API_KEY: "",
          SKIP_ENV_VALIDATION: "",
        },
      },
    );
    expect(output).toContain("configuration rejected before database access");
  });
});
