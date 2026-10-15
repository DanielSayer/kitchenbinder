import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

// Only the Node listener may supply this header to the Fetch application.
export const clientIpHeader = "x-prep-sheet-client-ip";
export const proxySecretHeader = "x-prep-sheet-proxy-secret";

export function createClientIpBoundary(secret) {
  if (secret !== undefined && !/^[a-zA-Z0-9_-]{32,256}$/.test(secret)) {
    throw new Error("WEB_PROXY_SECRET must be 32-256 base64url characters");
  }
  const expected = secret === undefined ? undefined : Buffer.from(secret);
  return (incoming, origin) => {
    let ip = incoming.socket.remoteAddress;
    if (expected) {
      const supplied = incoming.headers[proxySecretHeader];
      if (
        typeof supplied !== "string" ||
        Buffer.byteLength(supplied) !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), expected)
      ) {
        return { status: 403 };
      }
      ip = incoming.headers[clientIpHeader];
    }
    // Chains, duplicate headers, addresses with ports and zone IDs are invalid.
    if (typeof ip !== "string" || ip.includes("%") || !isIP(ip)) {
      return { status: 400 };
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (
        name === "forwarded" ||
        name.startsWith("x-forwarded-") ||
        name.startsWith("x-prep-sheet-") ||
        ["x-real-ip", "true-client-ip", "cf-connecting-ip"].includes(name)
      )
        continue;
      if (Array.isArray(value))
        for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    headers.set("host", new URL(origin).host);
    headers.set(clientIpHeader, ip);
    return { headers };
  };
}
