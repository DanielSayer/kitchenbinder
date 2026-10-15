import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

const environment = z
  .object({
    DATABASE_URL: z.url(),
    PREP_SHEET_TEST_DATABASE: z.literal("isolated"),
    BETTER_AUTH_URL: z.url(),
  })
  .parse(process.env);
const database = new URL(environment.DATABASE_URL);
assert.ok(["127.0.0.1", "host.docker.internal"].includes(database.hostname));
assert.equal(database.pathname, "/prep_sheet_test");
assert.ok(database.port && database.port !== "5432");
const secret = randomBytes(32).toString("base64url");
const children = [];

async function start(proxySecret) {
  const child = fork(new URL("./start-web.mjs", import.meta.url), [], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      // Vitest exports TEST=true, which otherwise disables Better Auth CSRF.
      TEST: "false",
      WEB_PROXY_SECRET: proxySecret,
      // Starting OAuth creates local state and a URL only. No provider call.
      GOOGLE_CLIENT_ID: "proxy-smoke-client-id",
      GOOGLE_CLIENT_SECRET: "proxy-smoke-client-secret",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const closed = once(child, "exit");
  const instance = {
    child,
    async stop() {
      if (child.exitCode !== null) return;
      child.send("shutdown");
      const [code] = await closed;
      assert.equal(code, 0, output);
    },
  };
  children.push(instance);
  for (let attempt = 0; attempt < 200; attempt++) {
    const match = output.match(/"event":"web_started","port":(\d+)/);
    if (match) return { ...instance, origin: `http://127.0.0.1:${match[1]}` };
    assert.equal(child.exitCode, null, output);
    await setTimeout(50);
  }
  throw new Error("Proxy smoke listener did not start");
}

try {
  const first = await start(secret);
  const second = await start(secret);
  const identity = "198.51.100.99";
  const verified = (ip) => ({
    "x-prep-sheet-proxy-secret": secret,
    "x-prep-sheet-client-ip": ip,
  });
  const signIn = (instance, headers) =>
    fetch(`${instance.origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: environment.BETTER_AUTH_URL,
        ...headers,
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/",
        disableRedirect: true,
      }),
    });
  assert.equal((await fetch(first.origin)).status, 403);
  assert.equal(
    (await fetch(`${first.origin}/branding/icon-192.png`)).status,
    403,
  );
  assert.equal(
    (
      await fetch(first.origin, {
        headers: {
          ...verified(identity),
          "x-prep-sheet-proxy-secret": "wrong",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(first.origin, {
        headers: { "x-prep-sheet-proxy-secret": secret },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(first.origin, {
        headers: verified("198.51.100.99, 192.0.2.1"),
      })
    ).status,
    400,
  );

  for (const [index, instance] of [first, second, first].entries()) {
    const response = await signIn(instance, {
      ...verified(identity),
      host: "evil.example.test",
      forwarded: "for=8.8.8.8;host=evil.example.test;proto=http",
      "x-forwarded-for": `203.0.113.${index + 1}, 192.0.2.1`,
      "x-forwarded-host": "evil.example.test",
      "x-forwarded-proto": "https",
      "x-real-ip": `203.0.113.${index + 1}`,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = z.object({ url: z.url() }).parse(await response.json());
    const redirect = new URL(body.url).searchParams.get("redirect_uri");
    assert.equal(
      redirect,
      `${environment.BETTER_AUTH_URL}/api/auth/callback/google`,
    );
  }
  const throttled = await signIn(second, verified(identity));
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers.get("x-retry-after")) > 0);
  await first.stop();
  const replacement = await start(secret);
  assert.equal((await signIn(replacement, verified(identity))).status, 429);
  assert.equal(
    (await signIn(replacement, verified("198.51.100.100"))).status,
    200,
  );
  assert.equal(
    (
      await signIn(replacement, {
        ...verified("198.51.100.101"),
        origin: "https://evil.example.test",
        cookie: "unrelated-test-cookie=present",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${replacement.origin}/api/trpc/healthCheck`, {
        headers: verified(identity),
      })
    ).status,
    200,
  );

  await second.stop();
  await replacement.stop();
  const direct = await start(undefined);
  const forged = (index) => ({
    "x-prep-sheet-client-ip": `203.0.113.${index}`,
    "x-forwarded-for": `203.0.113.${index}`,
  });
  for (let index = 1; index <= 3; index++)
    assert.equal((await signIn(direct, forged(index))).status, 200);
  assert.equal((await signIn(direct, forged(4))).status, 429);
  await direct.stop();
  process.stdout.write(
    "Production proxy, OAuth origin and shared throttle smoke checks passed.\n",
  );
} finally {
  for (const { child } of children) if (child.exitCode === null) child.kill();
}
