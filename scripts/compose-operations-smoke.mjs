import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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
const linux = process.platform === "linux";
if (!linux) database.hostname = "host.docker.internal";
let hostPort;
if (linux) {
  // The wrapper exposes PostgreSQL only on host loopback. Linux containers need
  // host networking to reach it. Reserve a random listener port for this test.
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  hostPort = reservation.address().port;
  await new Promise((done) => reservation.close(done));
}
const directory = await mkdtemp(join(tmpdir(), "prep-sheet-compose-"));
const override = join(directory, "compose.yml");
// Runtime credentials come only from the wrapper. No literal or inherited live
// provider credentials enter these test containers.
await writeFile(
  override,
  linux
    ? `services:
  web:
    network_mode: host
    ports: !reset []
    environment:
      HOST: 127.0.0.1
      PORT: "${hostPort}"
      PREP_SHEET_TEST_DATABASE: isolated
  worker:
    network_mode: host
    environment:
      PREP_SHEET_TEST_DATABASE: isolated
`
    : `services:
  web:
    ports: !override ["127.0.0.1::3001"]
    extra_hosts: ["host.docker.internal:host-gateway"]
    environment:
      PREP_SHEET_TEST_DATABASE: isolated
  worker:
    extra_hosts: ["host.docker.internal:host-gateway"]
    environment:
      PREP_SHEET_TEST_DATABASE: isolated
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
  AI_ENABLED: "false",
  BILLING_MODE: "disabled",
  SUPPORT_EMAIL: "support@example.test",
  SUPPORT_OPERATOR: "Isolated Compose test operator",
  WEB_PROXY_SECRET: randomBytes(32).toString("base64url"),
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
  // Confirm Docker applied Compose's cgroup limits, not just that YAML parsed.
  for (const id of [webId, workerId]) {
    const limits = JSON.parse(
      run("docker", ["inspect", "--format", "{{json .HostConfig}}", id]),
    );
    assert.ok(limits.Memory > 0 && limits.NanoCpus > 0);
    assert.equal(limits.MemorySwap, limits.Memory);
    assert.ok(limits.MemoryReservation > 0);
    assert.ok(limits.MemoryReservation < limits.Memory);
    assert.ok(limits.PidsLimit > 0);
  }
  assert.equal(
    run("docker", [
      "inspect",
      "--format",
      "{{.HostConfig.LogConfig.Type}}",
      webId,
    ]),
    "local",
  );
  const port =
    hostPort ?? compose(["port", "web", "3001"]).match(/:(\d+)$/)?.[1];
  assert.ok(port);
  const origin = `http://127.0.0.1:${port}`;
  const headers = {
    "x-prep-sheet-proxy-secret": environment.WEB_PROXY_SECRET,
    "x-prep-sheet-client-ip": "127.0.0.1",
  };
  assert.equal((await fetch(`${origin}/health/ready`)).status, 403);
  const probe = (path) => fetch(`${origin}${path}`, { headers });
  assert.equal((await probe("/health/ready")).status, 200);
  compose(["stop", "worker"]);
  let unavailable = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await probe("/health/ready");
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
  assert.equal((await probe("/health/live")).status, 200);
  compose(["start", "worker"]);
  let recovered = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await probe("/health/ready");
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
