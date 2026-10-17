/* biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Standalone Node validation, never cached by Turbo. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// No database or provider credentials are used. All listeners publish on loopback.
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "prep-sheet-ingress-"));
const name = `prep-sheet-ingress-${randomUUID()}`;
const nginx =
  process.env.NGINX_TEST_IMAGE ??
  "nginx:stable-alpine@sha256:ed84151ed2d47ef93c0939eb9b9754c6990db6092cd2081e11988a47a83d47ea";
const node =
  process.env.NODE_TEST_IMAGE ??
  "node:26.7.0-bookworm-slim@sha256:4db36457f406501e6f608802e5da617e5fbd0e80b75901b6a09de1ae5a667d32";
const secret = "isolated-proxy-secret-never-used-for-deployment";
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
const docker = (...args) => run("docker", args);
const render = (text) =>
  text
    .replaceAll("PUBLIC_HOST", "ingress.example.test")
    .replaceAll("TLS_CERTIFICATE_PATH", "/test/cert.pem")
    .replaceAll("TLS_PRIVATE_KEY_PATH", "/test/key.pem")
    .replaceAll("/etc/nginx/snippets/prep-sheet-proxy.conf", "/test/proxy.conf")
    .replaceAll(
      "/etc/nginx/private/prep-sheet-proxy-secret.conf",
      "/test/secret.conf",
    );
try {
  await writeFile(join(directory, "empty.env"), "");
  const env = {
    ...process.env,
    PREP_SHEET_IMAGE: "prep-sheet:isolated-validation",
    DATABASE_URL:
      "postgresql://runtime:isolated@db.invalid/app?sslmode=verify-full",
    BETTER_AUTH_SECRET: "isolated-session-secret-only-123456789",
    BETTER_AUTH_URL: "https://ingress.example.test",
    WEB_PROXY_SECRET: secret,
    SUPPORT_EMAIL: "support@example.test",
    SUPPORT_OPERATOR: "Isolated test operator",
    AI_ENABLED: "false",
    BILLING_MODE: "disabled",
  };
  const composeArgs = [
    "compose",
    "--env-file",
    join(directory, "empty.env"),
    "-f",
    join(root, "deploy/compose.yml"),
    "--profile",
    "monitoring",
    "config",
    "--format",
    "json",
  ];
  const config = JSON.parse(run("docker", composeArgs, { env }));
  for (const service of Object.values(config.services)) {
    assert.equal(service.image, env.PREP_SHEET_IMAGE);
    assert.ok(
      service.cpus > 0 && service.mem_limit > 0 && service.pids_limit > 0,
    );
    assert.equal(service.memswap_limit, service.mem_limit);
    assert.ok(Number(service.mem_reservation) < Number(service.mem_limit));
  }
  assert.equal(config.services.web.ports[0].host_ip, "127.0.0.1");
  assert.equal(config.services.worker.ports, undefined);
  assert.equal(config.services.worker.environment.WEB_PROXY_SECRET, undefined);
  assert.equal(config.services.web.stop_grace_period, "40s");
  assert.equal(config.services.worker.stop_grace_period, "3m20s");
  assert.equal(config.services.web.volumes[0].read_only, true);
  assert.equal(config.services.worker.volumes[0].read_only, undefined);
  assert.notEqual(
    spawnSync("docker", composeArgs, {
      env: { ...env, WEB_PROXY_SECRET: "" },
      encoding: "utf8",
    }).status,
    0,
  );
  const custom = JSON.parse(
    run("docker", composeArgs, {
      env: { ...env, WEB_MEMORY_LIMIT: "2g", WEB_CPUS: "1.25" },
    }),
  );
  assert.equal(Number(custom.services.web.mem_limit), 2 * 1024 ** 3);
  assert.equal(custom.services.web.cpus, 1.25);

  const openssl =
    process.env.OPENSSL_BINARY ??
    (process.platform === "win32" &&
    existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl");
  run(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=ingress.example.test",
      "-addext",
      "subjectAltName=DNS:ingress.example.test",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
    ],
    { env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  await writeFile(
    join(directory, "proxy.conf"),
    render(await readFile(join(root, "deploy/nginx-proxy.conf"), "utf8")),
  );
  await writeFile(
    join(directory, "secret.conf"),
    `proxy_set_header X-Prep-Sheet-Proxy-Secret "${secret}";\n`,
  );
  const configuration = render(
    await readFile(join(root, "deploy/nginx.conf.example"), "utf8"),
  );
  await writeFile(
    join(directory, "nginx.conf"),
    `events { worker_connections 256; }\nhttp { access_log off; ${configuration} }`,
  );
  await writeFile(
    join(directory, "bootstrap.conf"),
    `events {}\nhttp { ${render(await readFile(join(root, "deploy/nginx-bootstrap.conf.example"), "utf8"))} }`,
  );
  await writeFile(
    join(directory, "http-body.mjs"),
    await readFile(join(root, "scripts/http-body.mjs")),
  );
  await writeFile(
    join(directory, "upstream.mjs"),
    `
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { boundedRequest } from './http-body.mjs';
createServer(async (req, res) => {
  const request = new Request('http://upstream' + req.url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
  const bounded = await boundedRequest(request);
  if (bounded instanceof Response) { res.writeHead(bounded.status); res.end(); return; }
  const body = await bounded.text();
  if (req.url === '/hold') await new Promise(r => setTimeout(r, 2000));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ headers: req.headers, body }));
}).listen(3001, '127.0.0.1');
`,
  );
  for (const file of ["nginx.conf", "bootstrap.conf"])
    docker(
      "run",
      "--rm",
      "-v",
      `${directory}:/test:ro`,
      nginx,
      "nginx",
      "-t",
      "-c",
      `/test/${file}`,
    );
  docker(
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1::443",
    "-p",
    "127.0.0.1::80",
    "-v",
    `${directory}:/test:ro`,
    nginx,
    "nginx",
    "-c",
    "/test/nginx.conf",
    "-g",
    "daemon off;",
  );
  docker(
    "run",
    "-d",
    "--name",
    `${name}-upstream`,
    "--network",
    `container:${name}`,
    "-v",
    `${directory}:/test:ro`,
    node,
    "node",
    "/test/upstream.mjs",
  );
  const port = Number(docker("port", name, "443").match(/:(\d+)$/)[1]);
  const httpPort = Number(docker("port", name, "80").match(/:(\d+)$/)[1]);
  const ca = await readFile(join(directory, "cert.pem"));
  function call(
    path,
    {
      headers = {},
      body,
      chunked = false,
      slow = false,
      servername = "ingress.example.test",
      plain = false,
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      const req = (plain ? httpRequest : httpsRequest)(
        {
          hostname: "127.0.0.1",
          port: plain ? httpPort : port,
          servername,
          ca,
          path,
          method: body === undefined ? "GET" : "POST",
          headers: {
            host: "ingress.example.test",
            ...(body !== undefined && !chunked
              ? { "content-length": Buffer.byteLength(body) }
              : {}),
            ...headers,
          },
          agent: false,
        },
        (res) => {
          const data = [];
          res.on("data", (chunk) => data.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(data).toString(),
            }),
          );
        },
      );
      req.setTimeout(25_000, () => req.destroy(new Error("request timed out")));
      req.on("error", reject);
      let interval;
      req.on("close", () => clearInterval(interval));
      if (slow) {
        req.write("x");
        interval = setInterval(() => req.write("x"), 1000);
      } else if (chunked) {
        req.write(body);
        req.end();
      } else req.end(body);
    });
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await call("/health/live");
    if (response.status === 200) break;
    assert.ok(attempt < 39, "fixture upstream must start");
    await setTimeout(250);
  }
  assert.equal(
    (await call("/path?x=1", { plain: true })).headers.location,
    "https://ingress.example.test/path?x=1",
  );
  await assert.rejects(call("/", { servername: "unknown.example.test" }));
  await assert.rejects(
    call("/", { headers: { host: "unknown.example.test" } }),
  );
  await assert.rejects(
    call("/", { plain: true, headers: { host: "unknown.example.test" } }),
  );
  const identity = await call("/", {
    headers: {
      "x-prep-sheet-proxy-secret": "forged",
      "x-prep-sheet-client-ip": "203.0.113.44",
      forwarded: "for=203.0.113.44",
      "x-forwarded-for": "203.0.113.44",
      "x-real-ip": "203.0.113.44",
      "cf-connecting-ip": "203.0.113.44",
      origin: "https://untrusted.example.test",
    },
  });
  const received = JSON.parse(identity.body).headers;
  assert.equal(received["x-prep-sheet-proxy-secret"], secret);
  assert.notEqual(received["x-prep-sheet-client-ip"], "203.0.113.44");
  for (const key of [
    "forwarded",
    "x-forwarded-for",
    "x-real-ip",
    "cf-connecting-ip",
  ])
    assert.equal(received[key], undefined);
  assert.equal(received.origin, "https://untrusted.example.test");
  for (const key of [
    "strict-transport-security",
    "content-security-policy",
    "permissions-policy",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
  ])
    assert.ok(identity.headers[key]);
  const raw = '{ "raw": "é",\r\n "untouched": true }';
  const webhook = await call("/api/polar/webhooks", {
    body: raw,
    chunked: true,
    headers: { "webhook-signature": "fixture-signature" },
  });
  assert.equal(JSON.parse(webhook.body).body, raw);
  assert.equal(
    JSON.parse(webhook.body).headers["webhook-signature"],
    "fixture-signature",
  );
  for (const [path, limit] of [
    ["/", 16384],
    ["/api/auth/sign-in/social", 16384],
    ["/api/trpc/save", 1572864],
    ["/api/extensions/import", 200000],
    ["/api/polar/webhooks", 262144],
    ["/api/polar/webhooks/", 16384],
  ]) {
    assert.equal(
      (await call(path, { body: "x".repeat(limit) })).status,
      200,
      path,
    );
    for (const chunked of [false, true]) {
      const response = await call(path, {
        body: "x".repeat(limit + 1),
        chunked,
      });
      assert.equal(response.status, 413, path);
      assert.ok(response.headers["strict-transport-security"]);
    }
    await setTimeout(800);
  }
  assert.equal(
    (await call("/api/%74rpc/save", { body: "x".repeat(16385) })).status,
    413,
  );
  assert.equal(
    (
      await call("/api/polar/webhooks", {
        body: raw,
        headers: { "content-encoding": "gzip" },
      })
    ).status,
    415,
  );
  const started = Date.now();
  assert.equal(
    (await call("/api/trpc/slow", { body: "x", chunked: true, slow: true }))
      .status,
    408,
  );
  assert.ok(
    Date.now() - started < 20_000,
    "trickling upload must meet total Node body deadline through nginx",
  );
  const held = Array.from({ length: 12 }, () => call("/hold"));
  await setTimeout(350);
  assert.equal(
    (await call("/hold")).status,
    429,
    "per-IP connection admission",
  );
  assert.equal(
    (await call("/health/live")).status,
    200,
    "probe allowance during connection overload",
  );
  await Promise.all(held);
  await setTimeout(5000);
  const flood = await Promise.all(Array.from({ length: 100 }, () => call("/")));
  assert.ok(
    flood.some((response) => response.status === 429),
    "request admission must reject a burst",
  );
  assert.equal(
    (await call("/health/live")).status,
    200,
    "probe allowance during rate overload",
  );
  await setTimeout(5000);
  assert.equal((await call("/")).status, 200, "admission must recover");
  process.stdout.write(
    `Deployment checks passed: Compose parser, nginx TLS/bootstrap parsers, identity, raw webhook, route/stream/time limits, overload and recovery. nginx image ${nginx}; certificate SHA256 ${createHash("sha256").update(ca).digest("hex").slice(0, 12)}\n`,
  );
} finally {
  for (const container of [`${name}-upstream`, name])
    spawnSync("docker", ["rm", "-f", container], {
      stdio: "ignore",
      timeout: 15_000,
    });
  await rm(directory, { recursive: true, force: true });
}
