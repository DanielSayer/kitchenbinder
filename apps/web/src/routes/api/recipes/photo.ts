import { handleRecipePhotoUpload } from "@prep-sheet/api/recipe-photo-upload";
import { auth } from "@prep-sheet/auth";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/recipes/photo")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleRecipePhotoUpload(request, (headers) =>
          auth.api.getSession({ headers }),
        ),
    },
  },
});
