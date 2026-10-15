import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(!process.env.PREP_SHEET_RELEASE_IMAGE)(
  "checks Compose probes, shared heartbeat permissions, worker loss and recovery",
  () => {
    const output = execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../../scripts/compose-operations-smoke.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: process.env,
        encoding: "utf8",
        timeout: 150_000,
      },
    );
    expect(output).toContain('"event":"compose_operations_smoke_passed"');
  },
  155_000,
);
