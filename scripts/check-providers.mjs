import { aiPolicy } from "../packages/env/src/ai-policy.ts";
import { validateProviderConfiguration } from "../packages/env/src/providers.ts";

try {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: This standalone acceptance command never permits the test wrapper's topology.
  if (process.env.PREP_SHEET_TEST_DATABASE)
    throw new Error(
      "Provider acceptance cannot use the synthetic test topology.",
    );
  const configuration = validateProviderConfiguration({
    ...process.env,
    NODE_ENV: "production",
  });
  console.info(
    JSON.stringify({
      event: "provider_configuration_valid",
      ...configuration,
      aiPolicy,
      externalAcceptance: "pending; follow docs/provider-acceptance.md",
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid provider configuration",
  );
  process.exitCode = 1;
}
