import { afterEach, expect, it, vi } from "vitest";
import {
  downscalePhoto,
  fitWithin,
  PhotoImportError,
  photoBlobs,
  sendPhotoImport,
} from "./import-photos";

const id = "00000000-0000-4000-8000-000000000001";
const request = { id, input: "Grandma's book", householdId: null };

afterEach(() => photoBlobs.clear());

it("fits the longest edge within 1600 px without enlarging", () => {
  expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  expect(fitWithin(1000, 3200)).toEqual({ width: 500, height: 1600 });
  expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
});

it("re-encodes smaller until a photo fits 1.5 MB, then releases the bitmap", async () => {
  const close = vi.fn();
  const encode = vi
    .fn()
    .mockResolvedValueOnce(new Blob([new Uint8Array(2_000_000)]))
    .mockResolvedValueOnce(new Blob([new Uint8Array(1_600_000)]))
    .mockResolvedValueOnce(new Blob([new Uint8Array(900_000)]));
  const blob = await downscalePhoto(new Blob(), {
    decode: async () => ({ width: 4000, height: 3000, close }),
    encode,
  });
  expect(blob.size).toBe(900_000);
  expect(encode.mock.calls.map(([, size, quality]) => [size, quality])).toEqual(
    [
      [{ width: 1600, height: 1200 }, 0.82],
      [{ width: 1600, height: 1200 }, 0.68],
      [{ width: 1200, height: 900 }, 0.68],
    ],
  );
  expect(close).toHaveBeenCalledOnce();
});

it("explains photos the browser can't decode, such as HEIC", async () => {
  await expect(
    downscalePhoto(new Blob(), {
      decode: () =>
        Promise.reject(new DOMException("bad", "InvalidStateError")),
      encode: vi.fn(),
    }),
  ).rejects.toThrow("couldn't be opened in this browser");
});

it("uploads the request and photos as multipart", async () => {
  const photo = new Blob(["jpeg"], { type: "image/jpeg" });
  photoBlobs.set(id, [photo, photo]);
  const send = vi.fn().mockResolvedValue(Response.json({ kind: "queued", id }));
  const checkStatus = vi.fn();
  await expect(sendPhotoImport(request, checkStatus, send)).resolves.toEqual({
    kind: "queued",
    id,
  });
  expect(checkStatus).not.toHaveBeenCalled();
  const [url, init] = send.mock.calls[0] ?? [];
  expect(url).toBe("/api/recipes/imports/photos");
  const form = init.body as FormData;
  expect(JSON.parse(form.get("request") as string)).toEqual(request);
  expect(form.getAll("photo")).toHaveLength(2);
});

it("passes rejection codes through like a tRPC error", async () => {
  photoBlobs.set(id, [new Blob(["jpeg"])]);
  const rejected = await sendPhotoImport(request, vi.fn(), async () =>
    Response.json(
      { error: { code: "TOO_MANY_REQUESTS", message: "Slow down." } },
      { status: 429 },
    ),
  ).catch((error: unknown) => error);
  expect(rejected).toBeInstanceOf(PhotoImportError);
  expect(rejected).toMatchObject({
    message: "Slow down.",
    data: { code: "TOO_MANY_REQUESTS" },
  });
  await expect(
    sendPhotoImport(
      request,
      vi.fn(),
      async () => new Response("Request body too large.", { status: 413 }),
    ),
  ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
});

it("recovers an admitted import after a reload, or asks for the photos again", async () => {
  const send = vi.fn();
  await expect(
    sendPhotoImport(
      request,
      async () => ({ kind: "processing", id, stage: "generating" }),
      send,
    ),
  ).resolves.toMatchObject({ kind: "processing" });
  await expect(
    sendPhotoImport(
      request,
      () =>
        Promise.reject(
          Object.assign(new Error("Import not found."), {
            data: { code: "NOT_FOUND" },
          }),
        ),
      send,
    ),
  ).rejects.toMatchObject({
    message: "Photos weren't sent. Add them again.",
    data: { code: "PRECONDITION_FAILED" },
  });
  expect(send).not.toHaveBeenCalled();
});
