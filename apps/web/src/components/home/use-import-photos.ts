import { useEffect, useReducer, useRef } from "react";
import { downscalePhoto, maxPhotos } from "./import-photos";

type PickedPhoto = { id: string; blob: Blob; url: string };
type PhotoState = {
  photos: PickedPhoto[];
  busy: boolean;
  error: string | undefined;
};
type Action =
  | { type: "replace"; photos: PickedPhoto[] }
  | { type: "remove"; id: string }
  | { type: "busy"; busy: boolean }
  | { type: "error"; error: string | undefined };

function photoReducer(state: PhotoState, action: Action): PhotoState {
  switch (action.type) {
    case "replace":
      return { ...state, photos: action.photos };
    case "remove":
      return {
        ...state,
        photos: state.photos.filter((photo) => photo.id !== action.id),
        error: undefined,
      };
    case "busy":
      return { ...state, busy: action.busy };
    case "error":
      return { ...state, error: action.error };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/** Own thumbnail URLs for the composer's lifetime, including replacement and removal. */
export function useImportPhotos() {
  const [state, dispatch] = useReducer(photoReducer, {
    photos: [],
    busy: false,
    error: undefined,
  });
  const photosRef = useRef(state.photos);
  photosRef.current = state.photos;
  const lifetime = useRef<AbortController | null>(null);
  // Thumbnails hold object URLs; release them when the composer goes.
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    };
  }, []);

  function showPhotos(next: Blob[]) {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    dispatch({
      type: "replace",
      photos: next.map((blob) => ({
        id: crypto.randomUUID(),
        blob,
        url: URL.createObjectURL(blob),
      })),
    });
  }

  async function addPhotos(files: File[]) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    const room = maxPhotos - photosRef.current.length;
    dispatch({
      type: "error",
      error: files.length > room ? `Add up to ${maxPhotos} photos.` : undefined,
    });
    if (room <= 0) return;
    dispatch({ type: "busy", busy: true });
    const added: Blob[] = [];
    try {
      for (const file of files.slice(0, room)) {
        const blob = await downscalePhoto(file);
        if (signal.aborted) return;
        added.push(blob);
      }
    } catch (error) {
      if (!signal.aborted)
        dispatch({
          type: "error",
          error:
            error instanceof Error ? error.message : "Couldn't add this photo.",
        });
    } finally {
      // A conversion already in progress can finish after cleanup. Do not
      // create new URLs or start another conversion for a closed composer.
      if (!signal.aborted) {
        showPhotos([...photosRef.current.map((photo) => photo.blob), ...added]);
        dispatch({ type: "busy", busy: false });
      }
    }
  }

  function removePhoto(id: string) {
    const photo = photosRef.current.find((item) => item.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    dispatch({ type: "remove", id });
  }

  return {
    photos: state.photos,
    photoBusy: state.busy,
    photoError: state.error,
    showPhotos,
    addPhotos,
    removePhoto,
    getPhotoBlobs: () => photosRef.current.map((photo) => photo.blob),
    clearPhotoError: () => dispatch({ type: "error", error: undefined }),
  };
}
