import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

// This child runs the built artifact in plain Node, without Vite or tsx transforms.
// It can only use the disposable PostgreSQL database created by pnpm test.
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

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { cookie, ownId, longId, otherId } = z
  .object({
    cookie: z.string().min(1),
    ownId: z.uuid(),
    longId: z.uuid(),
    otherId: z.uuid(),
  })
  .parse(JSON.parse(input));
const child = fork(new URL("./start-web.mjs", import.meta.url), [], {
  env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
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
let origin;
try {
  for (let attempt = 0; attempt < 200; attempt++) {
    const match = output.match(/"event":"web_started","port":(\d+)/);
    if (match) {
      origin = `http://127.0.0.1:${match[1]}`;
      break;
    }
    assert.equal(child.exitCode, null, output);
    await setTimeout(50);
  }
  assert.ok(origin, output);
  const request = (path, authenticated = false) =>
    fetch(new URL(path, origin), {
      headers: authenticated ? { cookie } : {},
    });

  const home = await request("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Prep Sheet/);
  const asset = html.match(
    /(?:src|href)="([^"]*\/assets\/[^"]+\.(?:js|css))"/,
  )?.[1];
  assert.ok(asset, "Built homepage must reference a client asset");
  const staticAsset = await request(asset);
  assert.equal(staticAsset.status, 200);
  assert.match(staticAsset.headers.get("cache-control"), /immutable/);
  assert.ok((await staticAsset.text()).length > 100);
  const head = await fetch(new URL(asset, origin), { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await request("/assets/missing.js")).status, 404);
  assert.equal(
    (await request("/assets/%2e%2e%2f%2e%2e%2fserver/server.js")).status,
    404,
  );
  const publicFile = await request("/branding/icon-192.png");
  assert.equal(publicFile.status, 200);
  assert.equal(publicFile.headers.get("content-type"), "image/png");
  assert.deepEqual(
    Buffer.from(await publicFile.arrayBuffer()).subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const health = await request("/api/trpc/healthCheck");
  assert.equal(health.status, 200);
  assert.match(await health.text(), /OK/);
  const supportPage = await request("/support");
  assert.equal(supportPage.status, 200);
  const supportHtml = await supportPage.text();
  assert.ok(supportHtml.includes(`mailto:${process.env.SUPPORT_EMAIL}`));
  assert.ok(!supportHtml.includes(process.env.SUPPORT_OPERATOR));
  const privateApi = await request("/api/trpc/recipes.list");
  assert.equal(privateApi.status, 401);
  await privateApi.text();
  const ownRecipe = await request(
    `/api/trpc/recipes.get?input=${encodeURIComponent(JSON.stringify({ id: ownId }))}`,
    true,
  );
  assert.equal(ownRecipe.status, 200);
  z.object({
    result: z.object({ data: z.object({ id: z.literal(ownId) }) }),
  }).parse(await ownRecipe.json());
  const anonymousPdf = await request(`/api/recipes/${ownId}/pdf`);
  assert.equal(anonymousPdf.status, 401);
  await anonymousPdf.text();
  const malformed = await request("/api/recipes/not-a-uuid/pdf", true);
  assert.equal(malformed.status, 404);
  await malformed.text();
  const forbidden = await request(`/api/recipes/${otherId}/pdf`, true);
  assert.equal(forbidden.status, 404);
  await forbidden.text();

  for (const id of [ownId, longId, ownId]) {
    const pdf = await request(`/api/recipes/${id}/pdf`, true);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(pdf.headers.get("cache-control"), "private, no-store");
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    // Nunito must be embedded rather than silently falling back to a standard font.
    assert.match(bytes.toString("latin1"), /\/FontFile2\b/);
  }
  const afterPdf = await request("/api/trpc/healthCheck");
  assert.equal(afterPdf.status, 200);
  await afterPdf.text();
  const signOut = await fetch(new URL("/api/auth/sign-out", origin), {
    method: "POST",
    headers: {
      cookie,
      origin: environment.BETTER_AUTH_URL,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(signOut.status, 200);
  assert.ok(
    signOut.headers.getSetCookie().length,
    "Auth cookie headers must survive the listener",
  );
  await signOut.text();
  // Give unhandled asynchronous font-loading errors time to reach the event loop.
  await setTimeout(100);
  process.stdout.write("Production server and PDF smoke checks passed.\n");
  if (process.platform === "win32") child.send("shutdown");
  else child.kill("SIGTERM");
  const [code] = await closed;
  assert.equal(code, 0, output);
  assert.match(output, /web_stopped/);
} finally {
  if (child.exitCode === null) child.kill();
}
// Let Node drain request pools naturally. A forced success exit would conceal
// delayed asynchronous errors such as the original font crash.
