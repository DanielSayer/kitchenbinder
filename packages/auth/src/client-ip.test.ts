import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createClientIpBoundary } from "../../../scripts/client-ip.mjs";

const secret = "proxy-test-secret-12345678901234567890";
const servers: ReturnType<typeof createServer>[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function listener(proxySecret?: string) {
  const boundary = createClientIpBoundary(proxySecret);
  const server = createServer((incoming, outgoing) => {
    const result = boundary(incoming, "https://public.example.test");
    if ("status" in result) outgoing.writeHead(result.status).end();
    else {
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify(Object.fromEntries(result.headers)));
    }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return (headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${address.port}`, { headers });
}

describe("Node client IP trust boundary over HTTP", () => {
  it("ignores forged headers in direct mode and preserves the actual Origin", async () => {
    const request = await listener();
    const claims: Record<string, string>[] = [
      {},
      {
        host: "evil.example.test",
        forwarded: "for=203.0.113.1;host=evil.example.test;proto=http",
        "x-forwarded-for": "203.0.113.1, 192.0.2.10",
        "x-forwarded-host": "evil.example.test",
        "x-forwarded-proto": "http",
        "x-forwarded-port": "80",
        "x-real-ip": "203.0.113.2",
        "cf-connecting-ip": "203.0.113.3",
        "true-client-ip": "203.0.113.4",
        "x-prep-sheet-client-ip": "203.0.113.5",
        "x-prep-sheet-proxy-secret": secret,
      },
    ];
    for (const headers of claims) {
      const response = await request({
        ...headers,
        origin: "https://evil.example.test",
      });
      expect(response.status).toBe(200);
      const received = z
        .record(z.string(), z.string())
        .parse(await response.json());
      expect(received["x-prep-sheet-client-ip"]).toBe("127.0.0.1");
      expect(received.host).toBe("public.example.test");
      expect(received.origin).toBe("https://evil.example.test");
      for (const name of Object.keys(received)) {
        expect(name).not.toMatch(
          /^(forwarded|x-forwarded-|x-real-ip|cf-connecting-ip|true-client-ip|x-prep-sheet-proxy-secret)/,
        );
      }
    }
  });

  it("requires proxy authentication before forwarding even a static request", async () => {
    const request = await listener(secret);
    for (const supplied of [undefined, "wrong", "x".repeat(secret.length)]) {
      expect(
        (
          await request({
            "x-prep-sheet-client-ip": "203.0.113.1",
            ...(supplied ? { "x-prep-sheet-proxy-secret": supplied } : {}),
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await request({
          "x-prep-sheet-proxy-secret": `${secret}, ${secret}`,
          "x-prep-sheet-client-ip": "203.0.113.1",
        })
      ).status,
    ).toBe(403);
  });

  it("rejects missing, malformed and chained proxy identities", async () => {
    const request = await listener(secret);
    for (const ip of [
      undefined,
      "unknown",
      "203.0.113.1:443",
      "203.0.113.1, 192.0.2.10",
      "fe80::1%eth0",
    ]) {
      expect(
        (
          await request({
            "x-prep-sheet-proxy-secret": secret,
            ...(ip ? { "x-prep-sheet-client-ip": ip } : {}),
          })
        ).status,
      ).toBe(400);
    }
  });

  it("preserves different proxy-verified users while discarding arbitrary forwarding chains", async () => {
    const request = await listener(secret);
    for (const ip of ["203.0.113.1", "198.51.100.2", "2001:db8:1::1"]) {
      const response = await request({
        "x-prep-sheet-proxy-secret": secret,
        "x-prep-sheet-client-ip": ip,
        "x-forwarded-for": "8.8.8.8, 192.0.2.10, 192.0.2.11",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "evil.example.test",
      });
      expect(response.status).toBe(200);
      const received = z
        .record(z.string(), z.string())
        .parse(await response.json());
      expect(received["x-prep-sheet-client-ip"]).toBe(ip);
      expect(received.host).toBe("public.example.test");
      expect(received["x-forwarded-for"]).toBeUndefined();
    }
  });

  it("refuses empty or unsuitable proxy secrets at startup", () => {
    for (const value of [
      "",
      "short",
      "a".repeat(257),
      `${secret}\n`,
      `${secret} invalid`,
    ])
      expect(() => createClientIpBoundary(value)).toThrow("WEB_PROXY_SECRET");
  });
});
