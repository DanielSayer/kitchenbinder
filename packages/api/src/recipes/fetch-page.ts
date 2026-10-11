import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { logImport } from "../import-diagnostics";

export const PAGE_ERROR =
  "Couldn't read this page. Paste the recipe text instead.";

export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function recipeUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error(PAGE_ERROR);
  url.hash = "";
  return url;
}

// Pin the request to the validated address, including after every redirect.
export async function fetchPage(
  input: string,
  signal = AbortSignal.timeout(15000),
  redirects = 0,
  importId?: string,
): Promise<string> {
  const url = recipeUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error(PAGE_ERROR);
  const target = addresses[0];
  if (!target) throw new Error(PAGE_ERROR);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        signal,
        headers: {
          "User-Agent": "PrepSheet/1.0 recipe importer",
          Accept: "text/html",
          "Accept-Encoding": "identity",
        },
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [target])
            : callback(null, target.address, target.family),
      },
      (response) => {
        // Drained redirect/error responses can also emit asynchronous errors.
        response.on("error", reject);
        const status = response.statusCode ?? 500;
        if (importId)
          logImport({
            event: "import_page_response",
            importId,
            hostname,
            status,
            redirect: redirects,
          });
        if (
          status >= 300 &&
          status < 400 &&
          response.headers.location &&
          redirects < 3
        ) {
          response.resume();
          try {
            fetchPage(
              new URL(response.headers.location, url).href,
              signal,
              redirects + 1,
              importId,
            ).then(resolve, reject);
          } catch (cause) {
            reject(new Error(PAGE_ERROR, { cause }));
          }
          return;
        }
        if (
          status !== 200 ||
          !response.headers["content-type"]?.includes("text/html")
        ) {
          response.resume();
          reject(new Error(PAGE_ERROR));
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2_000_000) request.destroy(new Error(PAGE_ERROR));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8")),
        );
      },
    );
    request.on("error", reject);
  });
}
