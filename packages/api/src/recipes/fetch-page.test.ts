import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const probe = fileURLToPath(
  new URL("./fixtures/fetch-page-probe.mjs", import.meta.url),
);

describe("asynchronous page failures", () => {
  it.each(["malformed", "redirect-stream", "rejected-stream"])(
    "rejects %s and continues in a process without an exception handler",
    (scenario) => {
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", probe, scenario],
        { encoding: "utf8", timeout: 5000 },
      );
      expect(child.error).toBeUndefined();
      expect(child.signal).toBeNull();
      expect(child.stderr).toBe("");
      expect(child.status).toBe(0);
      expect(child.stdout).toBe("FETCH_REJECTED_AND_CONTINUED\n");
    },
  );
});
