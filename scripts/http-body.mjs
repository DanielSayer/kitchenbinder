export const TRPC_MAX_BATCH_SIZE = 5;
export const BODY_READ_TIMEOUT_MS = 15_000;
export const PHOTO_UPLOAD_PATH = "/api/recipes/imports/photos";

export function bodyByteLimit(pathname) {
  if (pathname.startsWith("/api/trpc/")) return 1_572_864;
  if (pathname === "/api/polar/webhooks") return 262_144;
  // Five 1.5 MiB photos plus multipart framing and the request JSON.
  if (pathname === PHOTO_UPLOAD_PATH) return 8_388_608;
  return 16_384;
}

// Photo uploads may come from slow mobile connections.
export function bodyReadTimeoutMs(pathname) {
  return pathname === PHOTO_UPLOAD_PATH ? 60_000 : BODY_READ_TIMEOUT_MS;
}

export function bodyRejection(status) {
  return new Response(
    status === 413 ? "Request body too large." : "Request body timed out.",
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

// Count bytes before any JSON/form parsing or signature verification. Buffering
// is bounded, and forwarding the original bytes preserves webhook signatures.
export async function boundedRequest(
  request,
  timeoutMs = bodyReadTimeoutMs(new URL(request.url).pathname),
) {
  const limit = bodyByteLimit(new URL(request.url).pathname);
  if (Number(request.headers.get("content-length")) > limit) {
    void request.body?.cancel().catch(() => {});
    return bodyRejection(413);
  }
  if (!request.body) return request;
  const reader = request.body.getReader();
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(bodyRejection(408)), timeoutMs);
  });
  const read = async () => {
    // Collect chunks rather than reserving the full limit for every request.
    const chunks = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (size + next.value.byteLength > limit) return bodyRejection(413);
      chunks.push(next.value);
      size += next.value.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Development adapters can implement Request without Node's private fields.
    // Rebuild from public fields rather than cloning the adapter as a native Request.
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
      body: bytes,
      duplex: "half",
    });
  };
  try {
    return await Promise.race([read(), expired]);
  } finally {
    clearTimeout(timer);
    // Do not wait for a peer's cancellation hook to acknowledge rejection.
    void reader.cancel().catch(() => {});
  }
}
