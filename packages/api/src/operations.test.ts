import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("detects operational failures with bounded queries and delivers private alert recovery", () => {
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../../scripts/operations-smoke.mjs", import.meta.url),
      ),
    ],
    {
      env: process.env,
      encoding: "utf8",
      timeout: 25_000,
    },
  );
  expect(output).toContain('"event":"operations_smoke_passed"');
}, 30_000);
