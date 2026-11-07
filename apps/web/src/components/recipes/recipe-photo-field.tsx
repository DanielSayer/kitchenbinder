import type { RecipePhoto } from "@prep-sheet/db/recipe-photo";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { downscalePhoto } from "@/components/home/import-photos";
import { type PantryTone, RecipeCover } from "@/components/pantry";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import { uploadRecipePhoto } from "./recipe-photo";

/** Cover photo controls. Changes save immediately, separate from the draft. */
export function RecipePhotoField({
  id,
  title,
  photo,
  tone,
}: {
  id: string;
  title: string;
  photo: RecipePhoto | null;
  tone?: PantryTone;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);

  async function apply(next: RecipePhoto | null) {
    queryClient.setQueryData(trpc.recipes.get.queryKey({ id }), (old) =>
      old ? { ...old, photo: next } : old,
    );
    await queryClient.invalidateQueries({ queryKey: trpc.recipes.pathKey() });
  }

  const upload = useMutation({
    mutationFn: async (file: File) =>
      uploadRecipePhoto(id, await downscalePhoto(file)),
    onSuccess: async (next) => {
      await apply(next);
      toast.success("Photo saved.");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => client.recipes.removePhoto.mutate({ id }),
    onSuccess: async () => {
      await apply(null);
      toast.success("Photo removed.");
    },
    onError: (error) => toast.error(error.message),
  });
  const busy = upload.isPending || remove.isPending;

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
        <input
          ref={input}
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
        <button
          type="button"
          className="button button-outline button-small"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={18} aria-hidden="true" />
          {upload.isPending
            ? "Uploading..."
            : photo
              ? "Change photo"
              : "Add photo"}
        </button>
        {photo ? (
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Remove this recipe's photo?"))
                remove.mutate();
            }}
          >
            <Trash2 size={18} aria-hidden="true" />
            {remove.isPending ? "Removing..." : "Remove"}
          </button>
        ) : null}
        <small>Photo changes save straight away.</small>
      </div>
    </section>
  );
}
