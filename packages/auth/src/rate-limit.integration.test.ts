import { createHmac, randomUUID } from "node:crypto";
import { createDb } from "@prep-sheet/db";
import { authRateLimit } from "@prep-sheet/db/schema/auth-rate-limit";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { eq, sql } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
import { auth } from "./index";
import { createAuthRateLimitStorage } from "./rate-limit";

const pools = [createDb(), createDb()];
const first = pools[0];
const second = pools[1];
if (!first || !second) throw new Error("Missing test databases");
const secret = `rate-limit-test-${randomUUID()}`;
const digest = (key: string) =>
  createHmac("sha256", secret)
    .update("auth-rate-limit\0")
    .update(key)
    .digest("hex");
const storage = (db: ReturnType<typeof createDb>) =>
  createAuthRateLimitStorage({ db, secret });

function replica(db: ReturnType<typeof createDb>) {
  return betterAuth({
    ...auth.options,
    database: memoryAdapter({
      user: [],
      account: [],
      session: [],
      verification: [],
    }),
    plugins: [],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 7,
      customStorage: storage(db),
    },
  });
}
const request = (
  ip: string,
  path = "get-session",
  headers: Record<string, string> = {},
) =>
  new Request(`http://localhost:3001/api/auth/${path}`, {
    headers: { "x-prep-sheet-client-ip": ip, ...headers },
  });
afterAll(async () => {
  await first.delete(authRateLimit);
  await Promise.all(pools.map((db) => db.$client.end()));
});

it("enforces one atomic allowance across concurrent replicas and new process pools", async () => {
  const replicas = [replica(first), replica(second)];
  const responses = await Promise.all(
    Array.from({ length: 40 }, (_, index) => {
      const server = replicas[index % 2];
      if (!server) throw new Error("Missing replica");
      return server.handler(request("203.0.113.10"));
    }),
  );
  expect(responses.filter((response) => response.status === 200)).toHaveLength(
    7,
  );
  expect(responses.filter((response) => response.status === 429)).toHaveLength(
    33,
  );
  for (const response of responses.filter((value) => value.status === 429))
    expect(Number(response.headers.get("x-retry-after"))).toBeGreaterThan(0);

  const restartedPool = createDb();
  pools.push(restartedPool);
  expect(
    (await replica(restartedPool).handler(request("203.0.113.10"))).status,
  ).toBe(429);
  expect((await replicas[0]?.handler(request("203.0.113.11")))?.status).toBe(
    200,
  );
  const rows = await first.select().from(authRateLimit);
  expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key))).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("203.0.113");
});

it("keeps Better Auth's stricter sign-in limit and ignores forged alternate IP headers", async () => {
  const server = replica(first);
  const start = () =>
    server.handler(
      new Request("http://localhost:3001/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          "x-prep-sheet-client-ip": "203.0.113.12",
          "x-forwarded-for": `198.51.100.${Math.ceil(Math.random() * 200)}`,
          "x-real-ip": "198.51.100.250",
          origin: "http://localhost:3001",
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: "not-configured" }),
      }),
    );
  for (let index = 0; index < 3; index++)
    expect((await start()).status).not.toBe(429);
  expect((await start()).status).toBe(429);
});

it("normalises IPv4-mapped IPv6 and groups IPv6 users by /64 across replicas", async () => {
  const server = replica(first);
  for (let index = 0; index < 7; index++)
    expect((await server.handler(request("198.51.100.13"))).status).toBe(200);
  expect(
    (await replica(second).handler(request("::ffff:198.51.100.13"))).status,
  ).toBe(429);
  for (let index = 0; index < 7; index++)
    expect(
      (await server.handler(request(`2001:db8:1234:5678::${index + 1}`)))
        .status,
    ).toBe(200);
  expect(
    (await server.handler(request("2001:0db8:1234:5678:abcd:1234:5678:9abc")))
      .status,
  ).toBe(429);
  expect((await server.handler(request("2001:db8:1234:5679::1"))).status).toBe(
    200,
  );
});

it("resets an expired bucket using database time and prunes a bounded number of expired keys", async () => {
  const key = randomUUID();
  const rule = { max: 2, window: 60 };
  const store = storage(first);
  expect((await store.consume(key, rule)).allowed).toBe(true);
  expect((await store.consume(key, rule)).allowed).toBe(true);
  expect((await store.consume(key, rule)).allowed).toBe(false);
  await first
    .update(authRateLimit)
    .set({ expiresAt: new Date(0) })
    .where(eq(authRateLimit.key, digest(key)));
  await first.insert(authRateLimit).values(
    Array.from({ length: 25 }, (_, index) => ({
      key: `expired-${index}`,
      count: 1,
      expiresAt: new Date(0),
    })),
  );
  expect((await storage(second).consume(key, rule)).allowed).toBe(true);
  expect(
    await first.select().from(authRateLimit).where(sql`key LIKE 'expired-%'`),
  ).toHaveLength(15);
  const current = await first
    .select()
    .from(authRateLimit)
    .where(eq(authRateLimit.key, digest(key)));
  expect(current[0]?.count).toBe(1);
});

it("fails closed when the shared store is unavailable without exposing connection details", async () => {
  const unavailable = createDb();
  await unavailable.$client.end();
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      storage(unavailable).consume("private-ip|/private-path", {
        max: 7,
        window: 60,
      }),
    ).rejects.toThrow("Authentication rate limit unavailable");
    expect(diagnostic).toHaveBeenCalledWith(
      '{"event":"auth_rate_limit_unavailable"}',
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(
      /private-ip|private-path|postgres/,
    );
  } finally {
    diagnostic.mockRestore();
  }
});
