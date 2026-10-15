import type { IncomingMessage } from "node:http";

export const clientIpHeader: "x-prep-sheet-client-ip";
export const proxySecretHeader: "x-prep-sheet-proxy-secret";
export function createClientIpBoundary(
  secret: string | undefined,
): (
  incoming: Pick<IncomingMessage, "headers" | "socket">,
  origin: string,
) => { headers: Headers } | { status: number };
