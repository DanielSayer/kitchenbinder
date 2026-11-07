import type { RecipePhoto } from "@prep-sheet/db/recipe-photo";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AccountRequestLimit } from "./account-request-limit";
import { photoImportLimits } from "./import-contract";
import { failure, sniffPhotoType, statusCodes } from "./photo-upload";

type Session = { user: { id: string } } | null;
export type ReplacePhoto = (
  recipeId: string,
  userId: string,
  body: Buffer,
) => Promise<RecipePhoto | null>;

const accounts = new AccountRequestLimit(10);
const privateHeaders = { "Cache-Control": "private, no-store" };

// sharp loads lazily so the web server only pays for it on upload.
const replaceRecipePhoto: ReplacePhoto = async (...args) =>
  (await import("./recipes/media")).replaceRecipePhoto(...args);

/** POST /api/recipes/photo: a "recipeId" field and one "photo" file. */
export async function handleRecipePhotoUpload(
  request: Request,
  getSession: (headers: Headers) => Promise<Session>,
  replace: ReplacePhoto = replaceRecipePhoto,
  limit = accounts,
) {
  // Multipart forms are a "simple" cross-site request; require our own origin.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return failure("FORBIDDEN", "This request came from another site.");
  const session = await getSession(request.headers);
  if (!session) return failure("UNAUTHORIZED", "Sign in to upload photos.");
  const retryAfter = limit.take(session.user.id);
  if (retryAfter !== null)
    return failure(
      "TOO_MANY_REQUESTS",
      "Too many requests. Try again shortly.",
      { "Retry-After": String(retryAfter) },
    );
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure("BAD_REQUEST", "The photo upload is invalid.");
  }
  const recipeId = z.uuid().safeParse(form.get("recipeId"));
  if (!recipeId.success) return failure("BAD_REQUEST", "Recipe not found.");
  const files = form.getAll("photo");
  const [file] = files;
  if (files.length !== 1 || !file || typeof file === "string")
    return failure("BAD_REQUEST", "Add one photo.");
  if (file.size > photoImportLimits.bytes)
    return failure("BAD_REQUEST", "The photo must be 1.5 MB or smaller.");
  const data = Buffer.from(await file.arrayBuffer());
  if (!sniffPhotoType(data))
    return failure("BAD_REQUEST", "Photos must be JPEG, PNG or WebP images.");
  try {
    const photo = await replace(recipeId.data, session.user.id, data);
    if (!photo) return failure("NOT_FOUND", "Recipe not found.");
    return Response.json({ photo }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof TRPCError && statusCodes[error.code])
      return failure(error.code, error.message);
    console.error(
      JSON.stringify({
        event: "recipe_photo_upload_failed",
        failure: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return failure(
      "INTERNAL_SERVER_ERROR",
      "Couldn't save this photo. Try another one.",
    );
  }
}
