import { expect, it, vi } from "vitest";
import { recipePhotoPath, uploadRecipePhoto } from "./recipe-photo";

const id = "00000000-0000-4000-8000-000000000001";
const photo = {
  key: `recipes/${id}/a`,
  url: `https://media.test/recipes/${id}/a`,
  width: 1200,
  height: 800,
  color: "#c0ffee",
};

it("uploads the recipe ID and one photo as multipart", async () => {
  const send = vi.fn().mockResolvedValue(Response.json({ photo }));
  const blob = new Blob(["jpeg"], { type: "image/jpeg" });
  await expect(uploadRecipePhoto(id, blob, send)).resolves.toEqual(photo);
  const [url, init] = send.mock.calls[0] ?? [];
  expect(url).toBe(recipePhotoPath);
  expect(init.credentials).toBe("same-origin");
  const form = init.body as FormData;
  expect(form.get("recipeId")).toBe(id);
  expect(form.getAll("photo")).toHaveLength(1);
});

it("shows the server's message, or a size message for edge rejections", async () => {
  const blob = new Blob(["jpeg"]);
  await expect(
    uploadRecipePhoto(id, blob, async () =>
      Response.json(
        { error: { code: "NOT_FOUND", message: "Recipe not found." } },
        { status: 404 },
      ),
    ),
  ).rejects.toThrow("Recipe not found.");
  await expect(
    uploadRecipePhoto(
      id,
      blob,
      async () => new Response("Request body too large.", { status: 413 }),
    ),
  ).rejects.toThrow("too large");
  await expect(
    uploadRecipePhoto(
      id,
      blob,
      async () => new Response("bad gateway", { status: 502 }),
    ),
  ).rejects.toThrow("Couldn't save this photo");
});
