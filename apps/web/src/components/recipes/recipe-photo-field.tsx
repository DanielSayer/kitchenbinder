import type { RecipePhoto } from "@prep-sheet/db/recipe-photo";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { downscalePhoto } from "@/components/home/import-photos";
import { type PantryTone, RecipeCover } from "@/components/pantry";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import { uploadRecipePhoto } from "./recipe-photo";

export type RecipePhotoControls = ReturnType<typeof useRecipePhoto>;

/**
 * Upload, replace or remove a recipe's cover. Render `input` once; `choose`
 * opens the picker and must run inside a click. Changes save immediately.
 */
export function useRecipePhoto(id: string) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const toastId = `recipe-photo-${id}`;

  async function apply(next: RecipePhoto | null) {
    queryClient.setQueryData(trpc.recipes.get.queryKey({ id }), (old) =>
      old ? { ...old, photo: next } : old,
    );
    await queryClient.invalidateQueries({ queryKey: trpc.recipes.pathKey() });
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      toast.loading("Uploading photo...", { id: toastId });
      return uploadRecipePhoto(id, await downscalePhoto(file));
    },
    onSuccess: async (next) => {
      await apply(next);
      toast.success("Photo saved.", { id: toastId });
    },
    onError: (error) => toast.error(error.message, { id: toastId }),
  });
  const remove = useMutation({
    mutationFn: () => client.recipes.removePhoto.mutate({ id }),
    onSuccess: async () => {
      await apply(null);
      toast.success("Photo removed.", { id: toastId });
    },
    onError: (error) => toast.error(error.message, { id: toastId }),
  });
  const busy = upload.isPending || remove.isPending;

  return {
    busy,
    uploading: upload.isPending,
    removing: remove.isPending,
    choose: () => {
      if (!busy) picker.current?.click();
    },
    remove: () => {
      if (!busy && window.confirm("Remove this recipe's photo?"))
        remove.mutate();
    },
    input: (
      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="pantry-visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) upload.mutate(file);
        }}
      />
    ),
  };
}

/** Cover photo preview and controls on the edit screen. */
export function RecipePhotoField({
  id,
  title,
  photo,
  tone,
  controls,
}: {
  id: string;
  title: string;
  photo: RecipePhoto | null;
  tone?: PantryTone;
  controls: RecipePhotoControls;
}) {
  return (
    <section className="recipe-photo-field" aria-label="Recipe photo">
      <RecipeCover
        key={photo?.key ?? "none"}
        id={id}
        title={title}
        photo={photo}
        tone={tone}
        size="hero"
      />
      <div className="recipe-photo-actions">
        <button
          type="button"
          className="button button-outline button-small"
          disabled={controls.busy}
          onClick={controls.choose}
        >
          <ImagePlus size={18} aria-hidden="true" />
          {controls.uploading
            ? "Uploading..."
            : photo
              ? "Change photo"
              : "Add photo"}
        </button>
        {photo ? (
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={controls.busy}
            onClick={controls.remove}
          >
            <Trash2 size={18} aria-hidden="true" />
            {controls.removing ? "Removing..." : "Remove"}
          </button>
        ) : null}
        <small>Photo changes save straight away.</small>
      </div>
    </section>
  );
}
