import { defineConfig } from "vitest/config";

// This config is only invoked through pnpm test and never loads a local .env.
if (process.env.PREP_SHEET_TEST_DATABASE !== "isolated")
  throw new Error("Run deployment database checks through pnpm test.");
export default defineConfig({
  test: {
    include: ["deploy/database-roles.test.mjs"],
    fileParallelism: false,
    testTimeout: 90_000,
  },
});
