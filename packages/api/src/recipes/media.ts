import { randomUUID } from "node:crypto";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { db } from "@prep-sheet/db";
import {
  type RecipePhoto,
  recipePhotoWidths,
} from "@prep-sheet/db/recipe-photo";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { env } from "@prep-sheet/env/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { fetchImage } from "./fetch-page";

// The worker is memory capped; process one image at a time without caching.
sharp.cache(false);
sharp.concurrency(1);

const prefix = "recipes/";
// Objects younger than this may belong to a photo not yet attached.
const sweepGraceMs = 24 * 60 * 60 * 1000;
const photoFormats = new Set(["jpeg", "png", "webp", "gif", "heif"]);

type Media = { client: S3Client; bucket: string; publicUrl: string };
let media: Media | null | undefined;

export function mediaStorage(): Media | null {
  if (media !== undefined) return media;
  const {
    MEDIA_BUCKET: bucket,
    MEDIA_REGION: region,
    MEDIA_ACCESS_KEY_ID: accessKeyId,
    MEDIA_SECRET_ACCESS_KEY: secretAccessKey,
    MEDIA_PUBLIC_URL: publicUrl,
    MEDIA_ENDPOINT: endpoint,
  } = env;
  media =
    bucket && region && accessKeyId && secretAccessKey && publicUrl
      ? {
          client: new S3Client({
            region,
            endpoint,
            forcePathStyle: Boolean(endpoint),
            credentials: { accessKeyId, secretAccessKey },
          }),
          bucket,
          publicUrl: publicUrl.replace(/\/+$/, ""),
        }
      : null;
  return media;
}

// Re-encode untrusted bytes: first frame only, EXIF orientation applied,
// metadata (including GPS) dropped, never enlarged.
export async function processPhoto(input: Buffer) {
  const image = sharp(input, { limitInputPixels: 40_000_000 }).rotate();
  // Raster photos only: no SVG, PDF or other formats libvips can decode.
  const { format } = await image.metadata();
  if (!format || !photoFormats.has(format))
    throw new Error(`Unsupported photo format: ${format}`);
  const { dominant } = await image.clone().stats();
  const color = `#${[dominant.r, dominant.g, dominant.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
  const variants = [];
  for (const width of recipePhotoWidths) {
    const { data, info } = await image
      .clone()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });
    variants.push({ width, body: data, info });
  }
  const largest = variants.at(-1)?.info;
  if (!largest) throw new Error("No photo variants");
  return { variants, width: largest.width, height: largest.height, color };
}

async function storePhoto(
  storage: Media,
  recipeId: string,
  imageUrl: string,
  referer?: string,
): Promise<RecipePhoto> {
  const { body } = await fetchImage(imageUrl, referer);
  const photo = await processPhoto(body);
  const key = `${prefix}${recipeId}/${randomUUID()}`;
  for (const variant of photo.variants)
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: `${key}-${variant.width}.webp`,
        Body: variant.body,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  return {
    key,
    url: `${storage.publicUrl}/${key}`,
    width: photo.width,
    height: photo.height,
    color: photo.color,
  };
}

/** Copy a source image to the bucket and set it as the recipe's cover. */
export async function attachRecipePhoto(
  recipeId: string,
  imageUrl: string,
  referer?: string,
) {
  const storage = mediaStorage();
  if (!storage) return false;
  const photo = await storePhoto(storage, recipeId, imageUrl, referer);
  const updated = await db
    .update(recipe)
    .set({ photo })
    .where(and(eq(recipe.id, recipeId), isNull(recipe.photo)))
    .returning({ id: recipe.id });
  if (!updated.length) await deleteKeys(storage, photoObjects(photo.key));
  return updated.length > 0;
}

function photoObjects(key: string) {
  return recipePhotoWidths.map((width) => `${key}-${width}.webp`);
}

async function deleteKeys(storage: Media, keys: string[]) {
  for (let start = 0; start < keys.length; start += 1000)
    await storage.client.send(
      new DeleteObjectsCommand({
        Bucket: storage.bucket,
        Delete: {
          Objects: keys.slice(start, start + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
}

/**
 * Delete photo objects no recipe references. Covers every deletion path
 * (expiry, account and household removal) without per-path hooks. Soft-deleted
 * recipes keep their photo until the row itself is gone.
 */
export async function sweepRecipeMedia(now = Date.now()) {
  const storage = mediaStorage();
  if (!storage) return { scanned: 0, deleted: 0 };
  let scanned = 0;
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await storage.client.send(
      new ListObjectsV2Command({
        Bucket: storage.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    const objects = (page.Contents ?? []).flatMap(({ Key, LastModified }) =>
      Key && LastModified && now - LastModified.getTime() > sweepGraceMs
        ? [{ object: Key, key: Key.replace(/-\d+\.webp$/, "") }]
        : [],
    );
    scanned += objects.length;
    const keys = [...new Set(objects.map(({ key }) => key))];
    if (!keys.length) continue;
    const photoKey = sql<string>`${recipe.photo}->>'key'`;
    const referenced = new Set(
      (
        await db
          .select({ key: photoKey })
          .from(recipe)
          .where(inArray(photoKey, keys))
      ).map(({ key }) => key),
    );
    const orphaned = objects
      .filter(({ key }) => !referenced.has(key))
      .map(({ object }) => object);
    await deleteKeys(storage, orphaned);
    deleted += orphaned.length;
  } while (token);
  return { scanned, deleted };
}
