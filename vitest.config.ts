import { defineConfig } from "vitest/config";

if (process.env.PREP_SHEET_TEST_DATABASE !== "isolated") {
  throw new Error(
    "Run tests with pnpm test so they use an isolated PostgreSQL container.",
  );
}
const databaseUrl = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/",
);
if (
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.pathname !== "/prep_sheet_test" ||
  !databaseUrl.port ||
  databaseUrl.port === "5432"
) {
  throw new Error("Vitest requires the wrapper's isolated PostgreSQL URL.");
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Integration suites share a PostgreSQL import queue.
    fileParallelism: false,
    include: [
      "packages/**/*.test.ts",
      "apps/web/**/*.test.ts",
      "deploy/**/*.test.mjs",
    ],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
