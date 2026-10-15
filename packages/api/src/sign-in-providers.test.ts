import { db } from "@prep-sheet/db";
import { providerConfiguration } from "@prep-sheet/env/server";
import { afterAll, expect, it } from "vitest";
import { appRouter } from "./routers";

afterAll(() => db.$client.end());
it("exposes only provider IDs to an unauthenticated caller", async () => {
  const original = providerConfiguration.signInProviders;
  try {
    providerConfiguration.signInProviders = ["google"];
    const result = await appRouter
      .createCaller({ auth: null, session: null })
      .signInProviders();
    expect(result).toEqual(["google"]);
    expect(JSON.stringify(result)).not.toMatch(
      /secret|token|clientId|model|billing/i,
    );
  } finally {
    providerConfiguration.signInProviders = original;
  }
});
