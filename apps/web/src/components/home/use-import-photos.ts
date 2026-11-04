import { useEffect, useRef, useState } from "react";
import { downscalePhoto, maxPhotos } from "./import-photos";

type PickedPhoto = { id: string; blob: Blob; url: string };
/** Own thumbnail URLs for the composer's lifetime, including replacement and removal. */
export function useImportPhotos() {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const photosRef = useRef(photos);
  photosRef.current = photos;
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
    setPhotos(
      next.map((blob) => ({
        id: crypto.randomUUID(),
        blob,
        url: URL.createObjectURL(blob),
      })),
    );
  }

  async function addPhotos(files: File[]) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    const room = maxPhotos - photosRef.current.length;
    setPhotoError(
      files.length > room ? `Add up to ${maxPhotos} photos.` : undefined,
    );
    if (room <= 0) return;
    setPhotoBusy(true);
    const added: Blob[] = [];
    try {
      for (const file of files.slice(0, room)) {
        const blob = await downscalePhoto(file);
        if (signal.aborted) return;
        added.push(blob);
      }
    } catch (error) {
      if (!signal.aborted)
        setPhotoError(
          error instanceof Error ? error.message : "Couldn't add this photo.",
        );
    } finally {
      // A conversion already in progress can finish after cleanup. Do not
      // create new URLs or start another conversion for a closed composer.
      if (!signal.aborted) {
        showPhotos([...photosRef.current.map((photo) => photo.blob), ...added]);
        setPhotoBusy(false);
      }
    }
  }

  function removePhoto(id: string) {
    const photo = photosRef.current.find((item) => item.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    setPhotos((current) => current.filter((photo) => photo.id !== id));
    setPhotoError(undefined);
  }

  return {
    photos,
    photoBusy,
    photoError,
    showPhotos,
    addPhotos,
    removePhoto,
    getPhotoBlobs: () => photosRef.current.map((photo) => photo.blob),
    clearPhotoError: () => setPhotoError(undefined),
  };
}
