import type { ImportStatus } from "@prep-sheet/api/import-contract";
import type { PendingImport } from "./import-draft";

export const maxPhotos = 5;
// Matches the server's per-photo limit.
const maxPhotoBytes = 1_572_864;
const longestEdge = 1600;

// Photos are too large for sessionStorage, so they live only in this tab's
// memory until the import leaves the queue. A reload before admission loses them.
export const photoBlobs = new Map<string, Blob[]>();

/** An upload rejection shaped like a tRPC client error for the queue card. */
export class PhotoImportError extends Error {
  readonly data: { code: string };
  constructor(code: string, message: string) {
    super(message);
    this.data = { code };
  }
}

export function fitWithin(width: number, height: number, edge = longestEdge) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type Decoded = { width: number; height: number; close?: () => void };
export type PhotoCodec<Image extends Decoded = Decoded> = {
  decode: (file: Blob) => Promise<Image>;
  encode: (
    image: Image,
    size: { width: number; height: number },
    quality: number,
  ) => Promise<Blob>;
};

const browserCodec: PhotoCodec<ImageBitmap> = {
  // Applies EXIF orientation, so the re-encoded JPEG needs no metadata.
  decode: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  async encode(image, { width, height }, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    // JPEG has no transparency; keep transparent screenshots readable.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) throw new Error("Couldn't encode photo");
    return blob;
  },
};

/** Downscale and re-encode a picked photo as JPEG of at most 1.5 MB. */
export async function downscalePhoto<Image extends Decoded>(
  file: Blob,
  codec: PhotoCodec<Image> = browserCodec as unknown as PhotoCodec<Image>,
) {
  let image: Image;
  try {
    image = await codec.decode(file);
  } catch {
    throw new Error(
      "This photo couldn't be opened in this browser. Try a JPEG or PNG, or take a screenshot of it.",
    );
  }
  try {
    for (const [edge, quality] of [
      [longestEdge, 0.82],
      [longestEdge, 0.68],
      [1200, 0.68],
      [1000, 0.6],
    ] as const) {
      const blob = await codec.encode(
        image,
        fitWithin(image.width, image.height, edge),
        quality,
      );
      if (blob.size <= maxPhotoBytes) return blob;
    }
    throw new Error("This photo is too large. Try a smaller photo.");
  } finally {
    image.close?.();
  }
}

/**
 * Send a photo import, or, when this tab no longer holds its photos, recover
 * the status of an earlier admission.
 */
export async function sendPhotoImport(
  request: PendingImport,
  checkStatus: () => Promise<ImportStatus>,
  send: typeof fetch = fetch,
): Promise<ImportStatus> {
  const blobs = photoBlobs.get(request.id);
  if (!blobs) {
    try {
      return await checkStatus();
    } catch (error) {
      const code = (error as { data?: { code?: string } } | null)?.data?.code;
      if (code === "NOT_FOUND")
        throw new PhotoImportError(
          "PRECONDITION_FAILED",
          "Photos weren't sent. Add them again.",
        );
      throw error;
    }
  }
  const form = new FormData();
  form.append(
    "request",
    JSON.stringify({
      id: request.id,
      input: request.input,
      householdId: request.householdId,
    }),
  );
  for (const blob of blobs) form.append("photo", blob, "photo.jpg");
  const response = await send("/api/recipes/imports/photos", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => null);
  if (response.ok && body) return body as ImportStatus;
  if (response.status === 413)
    throw new PhotoImportError("BAD_REQUEST", "These photos are too large.");
  // No code means an uncertain outcome: the card checks status before retrying.
  throw new PhotoImportError(
    body?.error?.code ?? "INTERNAL_SERVER_ERROR",
    body?.error?.message ?? "Couldn't send your photos. Try again.",
  );
}
