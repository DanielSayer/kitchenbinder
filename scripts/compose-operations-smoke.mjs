import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

assert.equal(process.env.PREP_SHEET_TEST_DATABASE, "isolated");
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/prep_sheet_test");
assert.ok(database.port && database.port !== "5432");
assert.ok(process.env.PREP_SHEET_RELEASE_IMAGE);
database.hostname = "host.docker.internal";
const directory = await mkdtemp(join(tmpdir(), "prep-sheet-compose-"));
const override = join(directory, "compose.yml");
// Runtime credentials come only from the wrapper. No literal or inherited live
// provider credentials enter these test containers.
await writeFile(
  override,
  `services:
  web:
    ports: !override ["127.0.0.1::3001"]
    extra_hosts: ["host.docker.internal:host-gateway"]
  worker:
    extra_hosts: ["host.docker.internal:host-gateway"]
`,
);
const project = `prep-sheet-ops-${randomUUID()}`;
const args = [
  "compose",
  "-p",
  project,
  "-f",
  fileURLToPath(new URL("../deploy/compose.yml", import.meta.url)),
  "-f",
  override,
];
const environment = {
  ...process.env,
  PREP_SHEET_IMAGE: process.env.PREP_SHEET_RELEASE_IMAGE,
  DATABASE_URL: database.href,
  BETTER_AUTH_URL: "http://localhost:3001",
  OPENAI_API_KEY: "",
  POLAR_ACCESS_TOKEN: "",
  POLAR_PRO_PRODUCT_ID: "",
  POLAR_WEBHOOK_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  DISCORD_CLIENT_ID: "",
  DISCORD_CLIENT_SECRET: "",
  OPS_ALERT_WEBHOOK_URL: "",
  OPS_ALERT_TOKEN: "",
};
function run(command, extra, timeout = 30_000) {
  const result = spawnSync(command, extra, {
    env: environment,
    encoding: "utf8",
    timeout,
  });
  assert.equal(result.status, 0, "isolated Compose command failed");
  return result.stdout.trim();
}
const compose = (extra, timeout) => run("docker", [...args, ...extra], timeout);
try {
  compose(
    ["up", "-d", "--wait", "--wait-timeout", "90", "web", "worker"],
    100_000,
  );
  const webId = compose(["ps", "-q", "web"]);
  const workerId = compose(["ps", "-q", "worker"]);
  for (const id of [webId, workerId])
    assert.equal(
      run("docker", ["inspect", "--format", "{{.State.Health.Status}}", id]),
      "healthy",
    );
  assert.equal(
    run("docker", [
      "inspect",
      "--format",
      "{{.HostConfig.LogConfig.Type}}",
      webId,
    ]),
    "local",
  );
  const binding = compose(["port", "web", "3001"]);
  const port = binding.match(/:(\d+)$/)?.[1];
  assert.ok(port);
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${origin}/health/ready`)).status, 200);
  compose(["stop", "worker"]);
  let unavailable = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${origin}/health/ready`);
    await response.body?.cancel();
    if (response.status === 503) {
      unavailable = true;
      break;
    }
    await setTimeout(250);
  }
  assert.ok(
    unavailable,
    "web must observe stopped worker through the shared volume",
  );
  assert.equal((await fetch(`${origin}/health/live`)).status, 200);
  compose(["start", "worker"]);
  let recovered = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await fetch(`${origin}/health/ready`);
    await response.body?.cancel();
    if (response.ok) {
      recovered = true;
      break;
    }
    await setTimeout(250);
  }
  assert.ok(recovered, "worker restart must recover readiness");
  process.stdout.write('{"event":"compose_operations_smoke_passed"}\n');
} finally {
  compose(["down", "--volumes", "--remove-orphans"], 45_000);
  await rm(directory, { recursive: true, force: true });
}
