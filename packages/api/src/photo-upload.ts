import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { AccountRequestLimit } from "./account-request-limit";
import { photoImportLimits } from "./import-contract";
import { submitPhotoImport } from "./imports";

export type UploadedPhoto = { mediaType: string; data: Buffer };

const reject = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });

// Trust the bytes, not the declared type. The worker re-encodes them anyway.
export function sniffPhotoType(data: Uint8Array) {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...data.subarray(start, end));
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Read the multipart upload: a "request" JSON field and 1–5 "photo" files. */
export async function readPhotoUpload(form: FormData) {
  const raw = form.get("request");
  let request: unknown;
  try {
    request = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    throw reject("The import request is invalid.");
  }
  if (!request) throw reject("The import request is invalid.");
  const files = form.getAll("photo");
  if (!files.length) throw reject("Add at least one photo.");
  if (files.length > photoImportLimits.count)
    throw reject(`Add up to ${photoImportLimits.count} photos.`);
  const photos: UploadedPhoto[] = [];
  for (const file of files) {
    if (typeof file === "string") throw reject("A photo is invalid.");
    if (file.size > photoImportLimits.bytes)
      throw reject("Each photo must be 1.5 MB or smaller.");
    const data = Buffer.from(await file.arrayBuffer());
    const mediaType = sniffPhotoType(data);
    if (!mediaType) throw reject("Photos must be JPEG, PNG or WebP images.");
    photos.push({ mediaType, data });
  }
  return { request, photos };
}

const accounts = new AccountRequestLimit(10);
const privateHeaders = { "Cache-Control": "private, no-store" };
const statusCodes: Partial<Record<TRPCError["code"], number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  TOO_MANY_REQUESTS: 429,
};

// Errors carry tRPC codes so the client treats them like recipes.create.
function failure(
  code: TRPCError["code"],
  message: string,
  headers: Record<string, string> = {},
) {
  return Response.json(
    { error: { code, message } },
    {
      status: statusCodes[code] ?? 500,
      headers: { ...privateHeaders, ...headers },
    },
  );
}

/** POST /api/recipes/imports/photos. The body is already size-bounded. */
export async function handlePhotoUpload(
  request: Request,
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>,
  limit = accounts,
) {
  // Multipart forms are a "simple" cross-site request; require our own origin.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return failure("FORBIDDEN", "This request came from another site.");
  const session = await getSession(request.headers);
  if (!session) return failure("UNAUTHORIZED", "Sign in to import photos.");
  const retryAfter = limit.take(session.user.id);
  if (retryAfter !== null)
    return failure(
      "TOO_MANY_REQUESTS",
      "Too many requests. Try again shortly.",
      {
        "Retry-After": String(retryAfter),
      },
    );
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return failure("BAD_REQUEST", "The photo upload is invalid.");
    }
    const { request: value, photos } = await readPhotoUpload(form);
    const status = await submitPhotoImport(session.user.id, value, photos);
    return Response.json(status, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof ZodError)
      return failure("BAD_REQUEST", "The import request is invalid.");
    if (error instanceof TRPCError && statusCodes[error.code])
      return failure(error.code, error.message);
    console.error(
      JSON.stringify({
        event: "photo_upload_failed",
        failure: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return failure(
      "INTERNAL_SERVER_ERROR",
      "Couldn't send your photos. Try again.",
    );
  }
}
