import type { RecipePhoto } from "@prep-sheet/db/recipe-photo";

export const recipePhotoPath = "/api/recipes/photo";

/** Upload an already downscaled photo as the recipe's cover. */
export async function uploadRecipePhoto(
  recipeId: string,
  photo: Blob,
  send: typeof fetch = fetch,
): Promise<RecipePhoto> {
  const form = new FormData();
  form.append("recipeId", recipeId);
  form.append("photo", photo, "photo.jpg");
  const response = await send(recipePhotoPath, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => null);
  if (response.ok && body?.photo) return body.photo as RecipePhoto;
  if (response.status === 413) throw new Error("This photo is too large.");
  throw new Error(
    body?.error?.message ?? "Couldn't save this photo. Try again.",
  );
}
