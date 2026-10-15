import { aiPolicy, estimatedAttemptCents } from "@prep-sheet/env/ai-policy";
import { z } from "zod";

const text = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || undefined : value),
  z.string().optional(),
);
const configuration = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: text,
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: text,
  SKIP_ENV_VALIDATION: text,
  PREP_SHEET_TEST_DATABASE: text,
  GOOGLE_CLIENT_ID: text,
  GOOGLE_CLIENT_SECRET: text,
  DISCORD_CLIENT_ID: text,
  DISCORD_CLIENT_SECRET: text,
  AI_ENABLED: z.enum(["true", "false"]).optional(),
  OPENAI_API_KEY: text,
  OPENAI_MODEL: z.string().trim().min(1).default(aiPolicy.model),
  BILLING_MODE: z.enum(["disabled", "sandbox", "production"]).optional(),
  POLAR_SERVER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["sandbox", "production"]).optional(),
  ),
  POLAR_ACCESS_TOKEN: text,
  POLAR_WEBHOOK_SECRET: text,
  POLAR_PRO_PRODUCT_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.uuid().optional(),
  ),
});

export type SignInProvider = "google" | "discord";

// Called by both the Node release entry points and the application's env module.
// Failure messages name settings only. Never include values or Zod input data.
export function validateProviderConfiguration(source: unknown) {
  const parsed = configuration.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid provider settings: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ")}. See docs/provider-acceptance.md.`,
    );
  }
  const settings = parsed.data;
  const fail = (message: string): never => {
    throw new Error(`${message} See docs/provider-acceptance.md.`);
  };
  const production = settings.NODE_ENV === "production";
  const origin = new URL(settings.BETTER_AUTH_URL);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    fail(
      "BETTER_AUTH_URL must be an origin without a path, query or credentials.",
    );

  const signInProviders: SignInProvider[] = [];
  for (const [provider, id, secret] of [
    ["google", settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET],
    ["discord", settings.DISCORD_CLIENT_ID, settings.DISCORD_CLIENT_SECRET],
  ] as const) {
    if (Boolean(id) !== Boolean(secret))
      fail(
        `${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET must be set together or both absent.`,
      );
    if (id && secret) signInProviders.push(provider);
  }

  const aiEnabled =
    settings.AI_ENABLED === "true" ||
    (settings.AI_ENABLED === undefined && Boolean(settings.OPENAI_API_KEY));
  const polarValues = [
    settings.POLAR_ACCESS_TOKEN,
    settings.POLAR_WEBHOOK_SECRET,
    settings.POLAR_PRO_PRODUCT_ID,
  ];
  const billingMode =
    settings.BILLING_MODE ??
    (polarValues.some(Boolean)
      ? (settings.POLAR_SERVER ?? "sandbox")
      : "disabled");
  if (aiEnabled && !settings.OPENAI_API_KEY)
    fail("AI_ENABLED=true requires OPENAI_API_KEY.");
  if (!aiEnabled && settings.OPENAI_API_KEY)
    fail("Remove OPENAI_API_KEY when AI_ENABLED=false.");
  if (aiEnabled && settings.OPENAI_MODEL !== aiPolicy.model)
    fail(
      "OPENAI_MODEL has no reviewed reservation policy. Update ai-policy.ts and its cost acceptance before enabling this model.",
    );
  if (aiEnabled && estimatedAttemptCents() > aiPolicy.reserveCentsPerAttempt)
    fail(
      "The AI input/output cost estimate exceeds its reservation. Review ai-policy.ts before enabling AI.",
    );
  if (billingMode === "disabled" && polarValues.some(Boolean))
    fail("Remove Polar credentials and product ID when BILLING_MODE=disabled.");
  if (billingMode !== "disabled") {
    if (!polarValues.every(Boolean))
      fail(
        "Enabled billing requires POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET and POLAR_PRO_PRODUCT_ID together.",
      );
    if (settings.POLAR_SERVER !== billingMode)
      fail(
        "POLAR_SERVER must be explicitly set to the same sandbox or production value as BILLING_MODE.",
      );
  }

  // Synthetic HTTP release checks may only use the wrapper's disposable database,
  // fixed local origin and no external providers. CI=true alone grants nothing.
  let isolatedTest = false;
  if (settings.PREP_SHEET_TEST_DATABASE !== undefined) {
    const database = settings.DATABASE_URL
      ? URL.parse(settings.DATABASE_URL)
      : null;
    isolatedTest =
      settings.PREP_SHEET_TEST_DATABASE === "isolated" &&
      Boolean(
        database &&
          ["127.0.0.1", "host.docker.internal"].includes(database.hostname) &&
          database.pathname === "/prep_sheet_test" &&
          database.port &&
          database.port !== "5432",
      ) &&
      origin.origin === "http://localhost:3001";
    if (!isolatedTest)
      fail(
        "PREP_SHEET_TEST_DATABASE requires the isolated test database and http://localhost:3001 origin.",
      );
    if (
      production &&
      (signInProviders.length || aiEnabled || billingMode !== "disabled")
    )
      fail("Synthetic production tests must disable all external providers.");
  }
  if (production) {
    if (!settings.BETTER_AUTH_SECRET || settings.BETTER_AUTH_SECRET.length < 32)
      fail("Production BETTER_AUTH_SECRET requires at least 32 characters.");
    if (settings.SKIP_ENV_VALIDATION)
      fail("Production cannot skip environment validation.");
    if (!isolatedTest && origin.protocol !== "https:")
      fail("Production BETTER_AUTH_URL requires HTTPS.");
    if (!isolatedTest && signInProviders.length === 0)
      fail(
        "Production requires at least one configured Google or Discord sign-in provider.",
      );
    if (settings.AI_ENABLED === undefined)
      fail("Production requires an explicit AI_ENABLED=true or false.");
    if (settings.BILLING_MODE === undefined)
      fail(
        "Production requires an explicit BILLING_MODE=disabled, sandbox or production.",
      );
  }
  return {
    signInProviders,
    aiEnabled,
    billingMode,
    model: settings.OPENAI_MODEL,
  };
}
