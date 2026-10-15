import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createClientIpBoundary } from "./client-ip.mjs";
import { bodyByteLimit } from "./http-body.mjs";
import { incomingBody, rejectIncomingBody } from "./incoming-body.mjs";
import { createOperations } from "./operations.mjs";
import { verifyRelease } from "./release-environment.mjs";

const clientIpBoundary = createClientIpBoundary(process.env.WEB_PROXY_SECRET);
const origin = await verifyRelease();
const root = await realpath(
  fileURLToPath(new URL("../apps/web/dist/client/", import.meta.url)),
);
const { default: application } = await import(
  "../apps/web/dist/server/server.js"
);
const port = Number(process.env.PORT ?? 3001);
const grace = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
if (
  !Number.isInteger(port) ||
  port < 0 ||
  port > 65535 ||
  !Number.isInteger(grace) ||
  grace < 1
) {
  throw new Error("Invalid PORT or SHUTDOWN_TIMEOUT_MS");
}
const types = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};
let stopping = false;
const operations = createOperations();
const server = createServer(async (incoming, outgoing) => {
  const requestId = randomUUID();
  const started = Date.now();
  let route = "application";
  outgoing.setHeader("x-request-id", requestId);
  outgoing.on("finish", () => {
    if (outgoing.statusCode >= 500)
      console.error(
        JSON.stringify({
          event: "web_request_failed",
          timestamp: new Date().toISOString(),
          requestId,
          route,
          status: outgoing.statusCode,
          elapsedMs: Date.now() - started,
        }),
      );
  });
  const abort = new AbortController();
  outgoing.on("close", () => {
    if (!outgoing.writableFinished) abort.abort();
  });
  try {
    if (stopping) {
      outgoing.writeHead(503, { connection: "close" }).end();
      return;
    }
    const boundary = clientIpBoundary(incoming, origin);
    if ("status" in boundary) {
      outgoing.writeHead(boundary.status, { connection: "close" }).end();
      return;
    }
    // The configured public origin supplies protocol/host. Untrusted forwarded
    // headers and Host cannot change auth redirects or SSR request origin.
    const target = new URL(incoming.url ?? "/", origin);
    const url = new URL(origin);
    url.pathname = target.pathname;
    url.search = target.search;
    const hasBody = !["GET", "HEAD"].includes(incoming.method ?? "");
    if (
      !hasBody &&
      (incoming.headers["transfer-encoding"] !== undefined ||
        Number(incoming.headers["content-length"]) > 0)
    ) {
      rejectIncomingBody(
        incoming,
        outgoing,
        413,
        "GET and HEAD requests cannot include a body.",
      );
      return;
    }
    if (
      Number(incoming.headers["content-length"]) > bodyByteLimit(url.pathname)
    ) {
      rejectIncomingBody(incoming, outgoing, 413, "Request body too large.");
      return;
    }
    if (["/health/live", "/health/ready"].includes(url.pathname)) {
      route = "health";
      if (!["GET", "HEAD"].includes(incoming.method ?? "")) {
        outgoing.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const status =
        url.pathname === "/health/live"
          ? undefined
          : await operations.snapshot();
      const ready =
        status === undefined || (status.database && status.worker.ok);
      outgoing.writeHead(ready ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      outgoing.end(
        incoming.method === "HEAD"
          ? undefined
          : JSON.stringify({ status: ready ? "ok" : "unavailable" }),
      );
      return;
    }
    if (["GET", "HEAD"].includes(incoming.method ?? "")) {
      if (url.pathname.startsWith("/assets/")) route = "asset";
      const candidate = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (candidate.startsWith(root + sep)) {
        let file;
        try {
          file = await realpath(candidate);
        } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        }
        if (file?.startsWith(root + sep) && (await stat(file)).isFile()) {
          outgoing.writeHead(200, {
            "content-type": types[extname(file)] ?? "application/octet-stream",
            "cache-control": url.pathname.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "public, max-age=0, must-revalidate",
            "x-content-type-options": "nosniff",
          });
          if (incoming.method === "HEAD") outgoing.end();
          else
            await pipeline(createReadStream(file), outgoing, {
              signal: abort.signal,
            });
          return;
        }
      }
      if (url.pathname.startsWith("/assets/")) {
        outgoing.writeHead(404).end();
        return;
      }
    }
    const { headers } = boundary;
    headers.set("x-request-id", requestId);
    // The built Fetch entry counts streamed bytes, including chunked requests,
    // before dispatching to auth, tRPC or raw webhook parsers.
    const response = await application.fetch(
      new Request(url, {
        method: incoming.method,
        headers,
        signal: abort.signal,
        ...(hasBody ? { body: incomingBody(incoming), duplex: "half" } : {}),
      }),
    );
    if ([408, 413].includes(response.status)) {
      rejectIncomingBody(
        incoming,
        outgoing,
        response.status,
        new Uint8Array(await response.arrayBuffer()),
        Object.fromEntries(response.headers),
      );
      return;
    }
    for (const [name, value] of response.headers) {
      if (name !== "set-cookie" && name !== "x-request-id")
        outgoing.setHeader(name, value);
    }
    if (response.headers.getSetCookie().length)
      outgoing.setHeader("set-cookie", response.headers.getSetCookie());
    outgoing.writeHead(response.status);
    if (response.body && incoming.method !== "HEAD") {
      await pipeline(Readable.fromWeb(response.body), outgoing, {
        signal: abort.signal,
      });
    } else {
      await response.body?.cancel();
      outgoing.end();
    }
  } catch {
    // Never log request URLs, cookies or exception messages.
    if (!abort.signal.aborted && outgoing.headersSent)
      console.error(
        JSON.stringify({
          event: "web_response_interrupted",
          timestamp: new Date().toISOString(),
          requestId,
          route,
          elapsedMs: Date.now() - started,
        }),
      );
    if (!outgoing.headersSent) outgoing.writeHead(500).end();
    else outgoing.destroy();
  }
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.listen(port, process.env.HOST ?? "0.0.0.0", () => {
  console.info(
    JSON.stringify({ event: "web_started", port: server.address().port }),
  );
});
function stop() {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ event: "web_stopping" }));
  const timer = setTimeout(() => {
    server.closeAllConnections();
    console.error(JSON.stringify({ event: "web_shutdown_timeout" }));
    process.exit(1);
  }, grace);
  timer.unref();
  server.close(async () => {
    await operations.close();
    console.info(JSON.stringify({ event: "web_stopped" }));
    // Auth and API pools are owned inside the SSR bundle. All requests have
    // drained; process exit closes their idle database connections.
    process.exit(0);
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, stop);
}
// IPC also lets supervisors and Windows release tests request a graceful stop.
process.on("message", (message) => {
  if (message === "shutdown") stop();
});
