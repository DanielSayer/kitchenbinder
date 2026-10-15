import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("backs up and restores into disposable PG18 with migration and authenticated HTTP acceptance", () => {
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../../scripts/recovery-smoke.mjs", import.meta.url),
      ),
    ],
    {
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  process.stdout.write(output);
  expect(output).toContain('"event":"recovery_rehearsal_completed"');
}, 125_000);
