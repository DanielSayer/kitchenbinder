import { ArrowUp, Camera, ImagePlus, Pencil, Sparkles, X } from "lucide-react";
import { type ChangeEvent, type Ref, type SubmitEvent, useRef } from "react";
import { ErrorNotice } from "../feedback";
import { maxPhotos } from "./import-photos";

export function ComposerForm({
  input,
  inputRef,
  disabled,
  onChange,
  onSubmit,
  onManual,
  manualDisabled,
  photos = [],
  photoBusy = false,
  photoError,
  onAddPhotos,
  onRemovePhoto,
}: {
  input: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onManual: () => void;
  manualDisabled: boolean;
  photos?: { id: string; url: string }[];
  photoBusy?: boolean;
  photoError?: string;
  onAddPhotos?: (files: File[]) => void;
  onRemovePhoto?: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    // Allow picking the same file again after removing it.
    event.target.value = "";
    if (files.length) onAddPhotos?.(files);
  };
  const full = photoBusy || photos.length >= maxPhotos;
  return (
    <>
      <form className="add-composer" onSubmit={onSubmit}>
        <label className="pantry-visually-hidden" htmlFor="recipe-input">
          Paste a link, recipe, or describe a dish
        </label>
        <textarea
          id="recipe-input"
          ref={inputRef}
          value={input}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Cmd/Ctrl+Enter sends; plain Enter keeps pasted recipes multi-line.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={20000}
          placeholder={
            photos.length
              ? "Add a note about these photos (optional)…"
              : "Paste a link, recipe, or describe a dish…"
          }
        />
        {photos.length > 0 && (
          <ul className="add-photos" aria-label="Photos to import">
            {photos.map((photo, index) => (
              <li key={photo.id}>
                <img src={photo.url} alt={`Recipe page ${index + 1}`} />
                <button
                  type="button"
                  className="add-photo-remove"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => onRemovePhoto?.(photo.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="add-composer-foot">
          <span>
            <Sparkles size={14} aria-hidden="true" />
            {photos.length
              ? `${photos.length} of ${maxPhotos} photos`
              : "We'll tidy it into a recipe"}
          </span>
          <div className="add-composer-actions">
            {onAddPhotos && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  multiple
                  hidden
                  aria-label="Add recipe photos"
                  onChange={picked}
                />
                {/* capture opens the camera on phones; desktops show a file picker. */}
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  aria-label="Take a recipe photo"
                  onChange={picked}
                />
                <button
                  type="button"
                  className="add-photo"
                  aria-label="Choose photos (up to 5)"
                  title="Choose photos"
                  disabled={full}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="add-photo"
                  aria-label="Take a photo"
                  title="Take a photo"
                  disabled={full}
                  onClick={() => cameraRef.current?.click()}
                >
                  <Camera size={20} aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="submit"
              className="add-send"
              aria-label="Make a recipe"
              title="Make a recipe"
              disabled={disabled}
            >
              <ArrowUp size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
        {photoBusy && (
          <p className="add-photo-hint" role="status">
            Preparing photos…
          </p>
        )}
        <ErrorNotice message={photoError} />
      </form>
      <button
        type="button"
        className="add-manual"
        disabled={manualDisabled}
        onClick={onManual}
      >
        <Pencil size={16} aria-hidden="true" /> Enter manually
      </button>
    </>
  );
}
