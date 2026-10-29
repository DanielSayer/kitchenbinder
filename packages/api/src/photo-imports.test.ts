import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { recipeImport, recipeImportPhoto } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AccountRequestLimit } from "./account-request-limit";
import {
  discardWebsiteImport,
  importStatus,
  processNextImport,
  submitPhotoImport,
} from "./imports";
import {
  handlePhotoUpload,
  readPhotoUpload,
  sniffPhotoType,
} from "./photo-upload";
import { sampleRecipe } from "./recipes/fixtures";

const owner = randomUUID();
const png = await sharp({
  create: { width: 2400, height: 1200, channels: 3, background: "#c0ffee" },
})
  .png()
  .withMetadata({ exif: { IFD0: { Artist: "Private author" } } })
  .toBuffer();
const otherPng = await sharp({
  create: { width: 40, height: 40, channels: 3, background: "#123456" },
})
  .png()
  .toBuffer();
const photo = (data = png) => ({ mediaType: "image/png", data });
const request = () => ({ id: randomUUID(), input: "", householdId: null });
const generated = {
  recipes: [{ content: sampleRecipe, tagIds: [] as string[] }],
  sourceUrl: null,
  origin: "imported" as const,
};
const storedPhotos = async (id: string) =>
  db
    .select({ position: recipeImportPhoto.position })
    .from(recipeImportPhoto)
    .where(eq(recipeImportPhoto.importId, id));

function form(fields: Record<string, string | Blob | (string | Blob)[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const item of [value].flat()) data.append(name, item);
  return data;
}
const file = (data: Uint8Array, type = "image/png") =>
  new File([new Uint8Array(data)], "photo", { type });

describe("photo upload parsing", () => {
  it("sniffs JPEG, PNG and WebP from the bytes", async () => {
    expect(sniffPhotoType(png)).toBe("image/png");
    expect(sniffPhotoType(await sharp(png).jpeg().toBuffer())).toBe(
      "image/jpeg",
    );
    expect(sniffPhotoType(await sharp(png).webp().toBuffer())).toBe(
      "image/webp",
    );
    expect(sniffPhotoType(Buffer.from("<svg></svg>"))).toBeNull();
  });
  it("reads the request and photos in order", async () => {
    const value = request();
    const upload = await readPhotoUpload(
      form({
        request: JSON.stringify(value),
        photo: [file(png), file(otherPng, "image/jpeg")],
      }),
    );
    expect(upload.request).toEqual(value);
    expect(upload.photos.map(({ mediaType }) => mediaType)).toEqual([
      "image/png",
      "image/png",
    ]);
    expect(upload.photos[1]?.data.equals(otherPng)).toBe(true);
  });
  it.each([
    ["no request", { photo: file(png) }, "The import request is invalid."],
    [
      "invalid JSON",
      { request: "{", photo: file(png) },
      "The import request is invalid.",
    ],
    ["no photos", { request: "{}" }, "Add at least one photo."],
    [
      "six photos",
      { request: "{}", photo: Array.from({ length: 6 }, () => file(png)) },
      "Add up to 5 photos.",
    ],
    [
      "a text field as a photo",
      { request: "{}", photo: "not a file" },
      "A photo is invalid.",
    ],
    [
      "an oversized photo",
      { request: "{}", photo: file(new Uint8Array(1_572_865)) },
      "Each photo must be 1.5 MB or smaller.",
    ],
    [
      "an SVG",
      { request: "{}", photo: file(Buffer.from("<svg/>"), "image/png") },
      "Photos must be JPEG, PNG or WebP images.",
    ],
  ])("rejects %s", async (_, fields, message) => {
    await expect(readPhotoUpload(form(fields))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message,
    });
  });
});

describe("photo imports with PostgreSQL", () => {
  beforeEach(async () => {
    await db
      .update(recipeImport)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(recipeImport.userId, owner));
  });
  beforeAll(async () => {
    await db.insert(user).values({
      id: owner,
      name: "Photo import test",
      email: `${owner}@example.test`,
    });
    await db.insert(billingAccount).values({
      userId: owner,
      status: "active",
      validUntil: new Date(Date.now() + 86400000),
    });
  });
  afterAll(async () => {
    await db
      .delete(aiSpend)
      .where(
        inArray(
          aiSpend.importId,
          db
            .select({ id: recipeImport.id })
            .from(recipeImport)
            .where(eq(recipeImport.userId, owner)),
        ),
      );
    await db.delete(recipe).where(eq(recipe.userId, owner));
    await db.delete(user).where(eq(user.id, owner));
    await db.$client.end();
  });

  it("sends re-encoded photos to the model and deletes them at checkpoint", async () => {
    const item = { ...request(), input: "https://example.test/recipe" };
    const status = await submitPhotoImport(owner, item, [
      photo(),
      photo(otherPng),
    ]);
    expect(status.kind).toBe("queued");
    expect(await storedPhotos(item.id)).toHaveLength(2);
    const generate = vi.fn().mockResolvedValue({
      ...generated,
      recipes: ["Page one", "Page two"].map((title) => ({
        content: { ...sampleRecipe, title },
        tagIds: [],
      })),
    });
    await processNextImport(generate);
    expect(generate).toHaveBeenCalledTimes(1);
    // The note is never fetched as a page.
    const [input, , sourceUrl, images, options] = generate.mock.calls[0] ?? [];
    expect([input, sourceUrl, images]).toEqual([item.input, undefined, []]);
    const sent = options.photos as { mediaType: string; data: Buffer }[];
    expect(sent.map(({ mediaType }) => mediaType)).toEqual([
      "image/jpeg",
      "image/jpeg",
    ]);
    const first = await sharp(sent[0]?.data).metadata();
    expect([first.format, first.width, first.height, first.exif]).toEqual([
      "jpeg",
      1600,
      800,
      undefined,
    ]);
    expect((await sharp(sent[1]?.data).metadata()).width).toBe(40);
    expect(await storedPhotos(item.id)).toHaveLength(0);
    const saved = await importStatus(owner, item.id);
    expect(saved).toMatchObject({ kind: "saved", recipes: [{}, {}] });
    const [job] = await db
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, item.id));
    expect(job).toMatchObject({ sourceKind: "photo", input: "" });
    const [cover] = await db
      .select({ photo: recipe.photo })
      .from(recipe)
      .where(eq(recipe.id, item.id));
    expect(cover?.photo).toBeNull();
  });
  it("accepts identical retries and rejects different photos for the same ID", async () => {
    const item = request();
    await submitPhotoImport(owner, item, [photo()]);
    expect((await submitPhotoImport(owner, item, [photo()])).kind).toBe(
      "queued",
    );
    await expect(
      submitPhotoImport(owner, item, [photo(otherPng)]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      submitPhotoImport(owner, item, [photo(), photo()]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await storedPhotos(item.id)).toHaveLength(1);
    await processNextImport(vi.fn().mockResolvedValue(generated));
  });
  it("deletes photos and keeps usage spent when generation fails", async () => {
    const item = request();
    await submitPhotoImport(owner, item, [photo()]);
    await processNextImport(vi.fn().mockRejectedValue(new Error("boom")));
    expect((await importStatus(owner, item.id)).kind).toBe("failed");
    expect(await storedPhotos(item.id)).toHaveLength(0);
    const [job] = await db
      .select({ usageReleased: recipeImport.usageReleased })
      .from(recipeImport)
      .where(eq(recipeImport.id, item.id));
    expect(job?.usageReleased).toBe(false);
  });
  it("fails an unreadable photo before generation and releases usage", async () => {
    const item = request();
    const broken = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(64),
    ]);
    await submitPhotoImport(owner, item, [photo(broken)]);
    const generate = vi.fn();
    await processNextImport(generate);
    expect(generate).not.toHaveBeenCalled();
    expect(await importStatus(owner, item.id)).toMatchObject({
      kind: "failed",
      message:
        "One of the photos couldn't be read. Try a JPEG, PNG or WebP photo.",
    });
    expect(await storedPhotos(item.id)).toHaveLength(0);
    const [job] = await db
      .select({ usageReleased: recipeImport.usageReleased })
      .from(recipeImport)
      .where(eq(recipeImport.id, item.id));
    expect(job?.usageReleased).toBe(true);
  });
  it("deletes photos of an interrupted AI call", async () => {
    const item = request();
    await submitPhotoImport(owner, item, [photo()]);
    await db
      .update(recipeImport)
      .set({ state: "processing", startedAt: new Date(Date.now() - 240_000) })
      .where(eq(recipeImport.id, item.id));
    const generate = vi.fn();
    await processNextImport(generate);
    expect(generate).not.toHaveBeenCalled();
    expect((await importStatus(owner, item.id)).kind).toBe("failed");
    expect(await storedPhotos(item.id)).toHaveLength(0);
  });
  it("sweeps photos left on a finished import", async () => {
    const item = request();
    await submitPhotoImport(owner, item, [photo()]);
    await db
      .update(recipeImport)
      .set({ state: "failed" })
      .where(eq(recipeImport.id, item.id));
    await processNextImport(vi.fn());
    expect(await storedPhotos(item.id)).toHaveLength(0);
  });
  it("discards by ID: tombstones unsent uploads and refuses active ones", async () => {
    const lost = request();
    await discardWebsiteImport(owner, { id: lost.id, kind: "photo" });
    await expect(
      submitPhotoImport(owner, lost, [photo()]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await storedPhotos(lost.id)).toHaveLength(0);
    const active = request();
    await submitPhotoImport(owner, active, [photo()]);
    await expect(
      discardWebsiteImport(owner, { id: active.id, kind: "photo" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await processNextImport(vi.fn().mockResolvedValue(generated));
    await discardWebsiteImport(owner, { id: active.id, kind: "photo" });
    await expect(
      discardWebsiteImport(randomUUID(), { id: active.id, kind: "photo" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("serves the upload route with origin, session and rate checks", async () => {
    const item = request();
    const upload = (headers: Record<string, string>, body: object = item) =>
      new Request("https://kitchen.test/api/recipes/imports/photos", {
        method: "POST",
        headers,
        body: form({ request: JSON.stringify(body), photo: file(png) }),
      });
    const signedIn = async () => ({ user: { id: owner } });
    const limit = new AccountRequestLimit(2);
    const json = async (response: Response) => ({
      status: response.status,
      body: await response.json(),
    });
    expect(
      await json(
        await handlePhotoUpload(
          upload({ origin: "https://evil.test" }),
          signedIn,
          limit,
        ),
      ),
    ).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
    expect(
      await json(await handlePhotoUpload(upload({}), signedIn, limit)),
    ).toMatchObject({ status: 403 });
    const origin = { origin: "https://kitchen.test" };
    expect(
      await json(
        await handlePhotoUpload(upload(origin), async () => null, limit),
      ),
    ).toMatchObject({ status: 401, body: { error: { code: "UNAUTHORIZED" } } });
    const accepted = await handlePhotoUpload(upload(origin), signedIn, limit);
    expect(accepted.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(accepted)).toMatchObject({
      status: 200,
      body: { kind: "queued", id: item.id },
    });
    expect(
      await json(
        await handlePhotoUpload(
          upload(origin, { ...item, id: "not-a-uuid" }),
          signedIn,
          limit,
        ),
      ),
    ).toMatchObject({ status: 400, body: { error: { code: "BAD_REQUEST" } } });
    const limited = await handlePhotoUpload(upload(origin), signedIn, limit);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    await processNextImport(vi.fn().mockResolvedValue(generated));
  });
});
