import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bodyByteLimit,
  bodyReadTimeoutMs,
  boundedRequest,
} from "../../../scripts/http-body.mjs";

function streamingRequest(
  path: string,
  stream: ReadableStream<Uint8Array>,
  headers = {},
) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  });
}

describe("body admission before parsers", () => {
  it("forwards the real development server's request wrapper without changing its metadata or bytes", async () => {
    // Resolve the adapter from TanStack so this exercises the version used by Vite.
    const webRequire = createRequire(
      new URL("../../../apps/web/package.json", import.meta.url),
    );
    const startRequire = createRequire(
      webRequire.resolve("@tanstack/react-start/package.json"),
    );
    const pluginRequire = createRequire(
      startRequire.resolve("@tanstack/start-plugin-core/package.json"),
    );
    const { NodeRequest } = await import(
      pathToFileURL(pluginRequire.resolve("srvx/node")).href
    );
    let requestError: unknown;
    const server = createServer(async (incoming, outgoing) => {
      try {
        const result = await boundedRequest(
          new NodeRequest({ req: incoming, res: outgoing }),
        );
        if (result instanceof Response) {
          outgoing.writeHead(result.status).end();
          return;
        }
        outgoing.setHeader("content-type", "application/json");
        outgoing.end(
          JSON.stringify({
            url: result.url,
            method: result.method,
            signature: result.headers.get("webhook-signature"),
            body: await result.text(),
          }),
        );
      } catch (error) {
        requestError = error;
        outgoing.writeHead(500).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected a local TCP listener");
      const url = `http://127.0.0.1:${address.port}/api/polar/webhooks?source=dev`;
      const body = ' {"name":"crème fraîche"}\r\n';
      const response = await fetch(url, {
        method: "POST",
        headers: { "webhook-signature": "original-signature" },
        body,
      });
      expect(requestError).toBeUndefined();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url,
        method: "POST",
        signature: "original-signature",
        body,
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("stops chunked input at the byte budget and cancels the producer", async () => {
    let pulls = 0;
    let cancelled = false;
    const request = streamingRequest(
      "/api/trpc/recipes.createManual",
      new ReadableStream(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(65_536));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    );
    const result = await boundedRequest(request);
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("Expected rejection");
    expect(result.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBe(25);
  });

  it("rejects a declared oversize body before pulling and checks bytes despite a false small length", async () => {
    let pulls = 0;
    const make = (length: string) =>
      streamingRequest(
        "/api/auth/sign-out",
        new ReadableStream(
          {
            pull(controller) {
              pulls++;
              controller.enqueue(new Uint8Array(16_385));
            },
          },
          { highWaterMark: 0 },
        ),
        { "content-length": length },
      );
    const declared = await boundedRequest(make("1000000"));
    expect(declared instanceof Response && declared.status).toBe(413);
    expect(pulls).toBe(0);
    const lied = await boundedRequest(make("1"));
    expect(lied instanceof Response && lied.status).toBe(413);
    expect(pulls).toBe(1);
  });

  it("preserves the exact signed webhook bytes at the limit", async () => {
    const controller = new AbortController();
    const bytes = new TextEncoder().encode(' {"name":"crème fraîche"}\r\n');
    const body = new Uint8Array(bodyByteLimit("/api/polar/webhooks"));
    body.fill(32);
    body.set(bytes);
    const result = await boundedRequest(
      new Request("http://localhost/api/polar/webhooks", {
        method: "POST",
        body,
        headers: { "webhook-signature": "original-signature" },
        signal: controller.signal,
      }),
    );
    expect(result).toBeInstanceOf(Request);
    if (!(result instanceof Request))
      throw new Error("Expected admitted request");
    expect(result.headers.get("webhook-signature")).toBe("original-signature");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(body);
    controller.abort();
    expect(result.signal.aborted).toBe(true);
  });

  it("rejects a slow unfinished body without waiting for its cancel hook", async () => {
    let cancelled = false;
    const result = await boundedRequest(
      streamingRequest(
        "/api/polar/webhooks",
        new ReadableStream({
          cancel() {
            cancelled = true;
            return new Promise(() => {});
          },
        }),
      ),
      20,
    );
    expect(result instanceof Response && result.status).toBe(408);
    expect(cancelled).toBe(true);
  });

  it("counts UTF-8 bytes and applies each route's budget", async () => {
    for (const path of [
      "/api/auth/callback",
      "/api/polar/webhooks",
      "/api/trpc/recipes.createManual",
      "/api/recipes/imports/photos",
    ]) {
      const result = await boundedRequest(
        new Request(`http://localhost${path}`, {
          method: "POST",
          body: "🍲".repeat(Math.floor(bodyByteLimit(path) / 4) + 1),
        }),
      );
      expect(result instanceof Response && result.status).toBe(413);
    }
  });

  it("allows five full photos and a longer read on the photo upload route", async () => {
    const path = "/api/recipes/imports/photos";
    expect(bodyByteLimit(path)).toBeGreaterThan(5 * 1_572_864 + 65_536);
    expect(bodyReadTimeoutMs(path)).toBe(60_000);
    expect(bodyReadTimeoutMs("/api/trpc/recipes.create")).toBe(15_000);
    const body = new Uint8Array(bodyByteLimit(path));
    const result = await boundedRequest(
      new Request(`http://localhost${path}`, { method: "POST", body }),
    );
    expect(result).toBeInstanceOf(Request);
    if (result instanceof Request)
      expect((await result.arrayBuffer()).byteLength).toBe(body.byteLength);
  });
});
