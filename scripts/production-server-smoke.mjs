import assert from "node:assert/strict";
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
assert.equal(database.hostname, "127.0.0.1");
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
const { default: server } = await import("../apps/web/dist/server/server.js");
const origin = environment.BETTER_AUTH_URL;
const request = (path, authenticated = false) =>
  server.fetch(
    new Request(new URL(path, origin), {
      headers: authenticated ? { cookie } : {},
    }),
  );

const home = await request("/");
assert.equal(home.status, 200);
assert.match(await home.text(), /Prep Sheet/);
const health = await request("/api/trpc/healthCheck");
assert.equal(health.status, 200);
assert.match(await health.text(), /OK/);
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
// Give unhandled asynchronous font-loading errors time to reach the event loop.
await setTimeout(100);
process.stdout.write("Production server and PDF smoke checks passed.\n");
// Let Node drain request pools naturally. A forced success exit would conceal
// delayed asynchronous errors such as the original font crash.
