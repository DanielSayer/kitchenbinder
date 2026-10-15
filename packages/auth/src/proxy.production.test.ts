import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

it("verifies the packaged listener's proxy contract, OAuth origin and throttle across process replacement", () => {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    OPENAI_API_KEY: "",
    POLAR_ACCESS_TOKEN: "",
    POLAR_PRO_PRODUCT_ID: "",
    POLAR_WEBHOOK_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    DISCORD_CLIENT_ID: "",
    DISCORD_CLIENT_SECRET: "",
  };
  const image = process.env.PREP_SHEET_RELEASE_IMAGE;
  if (!image)
    execFileSync(
      process.execPath,
      [join(root, "apps/web/node_modules/vite/bin/vite.js"), "build"],
      {
        cwd: join(root, "apps/web"),
        env,
        timeout: 90_000,
        maxBuffer: 10_000_000,
      },
    );
  const containerUrl = new URL(process.env.DATABASE_URL ?? "");
  if (process.platform !== "linux")
    containerUrl.hostname = "host.docker.internal";
  const output = execFileSync(
    image ? "docker" : process.execPath,
    image
      ? [
          "run",
          "--rm",
          "-i",
          process.platform === "linux"
            ? "--network=host"
            : "--add-host=host.docker.internal:host-gateway",
          "-e",
          "NODE_ENV=production",
          "-e",
          "PREP_SHEET_TEST_DATABASE=isolated",
          "-e",
          `DATABASE_URL=${containerUrl.href}`,
          "-e",
          `BETTER_AUTH_SECRET=${process.env.BETTER_AUTH_SECRET}`,
          "-e",
          `BETTER_AUTH_URL=${process.env.BETTER_AUTH_URL}`,
          image,
          "node",
          "scripts/proxy-server-smoke.mjs",
        ]
      : [join(root, "scripts/proxy-server-smoke.mjs")],
    {
      cwd: root,
      env,
      timeout: 45_000,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    },
  );
  expect(output).toContain(
    "Production proxy, OAuth origin and shared throttle smoke checks passed.",
  );
}, 150_000);
