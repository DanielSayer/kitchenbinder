import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { AccountRequestLimit } from "./account-request-limit";
import {
  handleRecipePhotoUpload,
  type ReplacePhoto,
} from "./recipe-photo-upload";

const owner = randomUUID();
const recipeId = randomUUID();
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const stored = {
  key: `recipes/${recipeId}/photo`,
  url: `https://media.test/recipes/${recipeId}/photo`,
  width: 1200,
  height: 800,
  color: "#c0ffee",
};
const origin = { origin: "https://kitchen.test" };
const signedIn = async () => ({ user: { id: owner } });

function upload(
  fields: Record<string, string | Blob | (string | Blob)[]>,
  headers: Record<string, string> = origin,
) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const item of [value].flat()) body.append(name, item);
  return new Request("https://kitchen.test/api/recipes/photo", {
    method: "POST",
    headers,
    body,
  });
}
const photo = (data: Uint8Array = jpeg) =>
  new File([new Uint8Array(data)], "photo.jpg", { type: "image/jpeg" });
const json = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

describe("recipe photo upload route", () => {
  it("checks origin, session and rate before reading the photo", async () => {
    const replace = vi.fn<ReplacePhoto>();
    const limit = new AccountRequestLimit(1);
    const request = () => upload({ recipeId, photo: photo() });
    expect(
      await json(
        await handleRecipePhotoUpload(
          upload({ recipeId, photo: photo() }, { origin: "https://evil.test" }),
          signedIn,
          replace,
          limit,
        ),
      ),
    ).toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
    expect(
      (
        await handleRecipePhotoUpload(
          request(),
          async () => null,
          replace,
          limit,
        )
      ).status,
    ).toBe(401);
    replace.mockResolvedValue(stored);
    const accepted = await handleRecipePhotoUpload(
      request(),
      signedIn,
      replace,
      limit,
    );
    expect(accepted.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(accepted)).toEqual({
      status: 200,
      body: { photo: stored },
    });
    expect(replace).toHaveBeenCalledWith(recipeId, owner, Buffer.from(jpeg));
    const limited = await handleRecipePhotoUpload(
      request(),
      signedIn,
      replace,
      limit,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("rejects bad fields and unknown bytes without storing anything", async () => {
    const replace = vi.fn<ReplacePhoto>();
    const send = async (fields: Parameters<typeof upload>[0]) =>
      json(
        await handleRecipePhotoUpload(
          upload(fields),
          signedIn,
          replace,
          new AccountRequestLimit(10),
        ),
      );
    for (const fields of [
      { recipeId: "not-a-uuid", photo: photo() },
      { recipeId },
      { recipeId, photo: [photo(), photo()] },
      { recipeId, photo: "text" },
      { recipeId, photo: photo(new TextEncoder().encode("<svg></svg>")) },
      { recipeId, photo: photo(new Uint8Array(1_572_865).fill(0xff)) },
    ])
      expect(await send(fields)).toMatchObject({
        status: 400,
        body: { error: { code: "BAD_REQUEST" } },
      });
    expect(replace).not.toHaveBeenCalled();
  });

  it("maps a missing recipe, storage and processing failures", async () => {
    const send = async (replace: ReplacePhoto) =>
      json(
        await handleRecipePhotoUpload(
          upload({ recipeId, photo: photo() }),
          signedIn,
          replace,
          new AccountRequestLimit(10),
        ),
      );
    expect(await send(async () => null)).toMatchObject({
      status: 404,
      body: { error: { code: "NOT_FOUND" } },
    });
    expect(
      await send(async () => {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Off" });
      }),
    ).toMatchObject({
      status: 412,
      body: { error: { code: "PRECONDITION_FAILED", message: "Off" } },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await send(async () => {
        throw new Error("Unsupported photo format: svg");
      }),
    ).toMatchObject({
      status: 500,
      body: { error: { code: "INTERNAL_SERVER_ERROR" } },
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
