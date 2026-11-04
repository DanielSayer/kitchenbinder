// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as importPhotos from "./import-photos";
import { useImportPhotos } from "./use-import-photos";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["resolve", "reject"])(
  "stops preparing thumbnails when conversion %s after unmount",
  async (outcome) => {
    let finish = (_blob: Blob) => {};
    let fail = (_error: Error) => {};
    const conversion = new Promise<Blob>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const prepare = vi
      .spyOn(importPhotos, "downscalePhoto")
      .mockReturnValue(conversion);
    const create = vi.fn(() => "blob:existing");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const { result, unmount } = renderHook(useImportPhotos);
    act(() => result.current.showPhotos([new Blob(["existing"])]));
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.addPhotos([
        new File(["a"], "a.jpg", { type: "image/jpeg" }),
        new File(["b"], "b.jpg", { type: "image/jpeg" }),
      ]);
    });
    unmount();
    await act(async () => {
      if (outcome === "resolve") finish(new Blob(["prepared"]));
      else fail(new Error("Conversion failed"));
      await pending;
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:existing");
  },
);

it("releases removed, replaced, and unmounted thumbnail URLs", () => {
  const create = vi
    .fn()
    .mockReturnValueOnce("blob:a")
    .mockReturnValueOnce("blob:b")
    .mockReturnValueOnce("blob:c");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const { result, unmount } = renderHook(useImportPhotos);
  const first = new Blob(["a"]);
  const second = new Blob(["b"]);
  act(() => result.current.showPhotos([first, second]));
  expect(result.current.getPhotoBlobs()).toEqual([first, second]);
  const id = result.current.photos[1]?.id;
  if (!id) throw new Error("Missing second thumbnail");
  act(() => result.current.removePhoto(id));
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:b");
  act(() => result.current.showPhotos([second]));
  expect(revoke).toHaveBeenCalledWith("blob:a");
  expect(result.current.getPhotoBlobs()).toEqual([second]);
  unmount();
  expect(revoke.mock.calls).toEqual([["blob:b"], ["blob:a"], ["blob:c"]]);
});

it("keeps picked photos when another file cannot be prepared", async () => {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
  const { result } = renderHook(useImportPhotos);
  const picked = new Blob(["photo"], { type: "image/jpeg" });
  act(() => result.current.showPhotos([picked]));
  await act(() =>
    result.current.addPhotos([
      new File(["text"], "notes.txt", { type: "text/plain" }),
    ]),
  );
  expect(result.current.getPhotoBlobs()).toEqual([picked]);
  expect(result.current.photoBusy).toBe(false);
  expect(result.current.photoError).toBeTruthy();
});
