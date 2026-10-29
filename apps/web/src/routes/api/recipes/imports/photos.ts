import { handlePhotoUpload } from "@prep-sheet/api/photo-upload";
import { auth } from "@prep-sheet/auth";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/recipes/imports/photos")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handlePhotoUpload(request, (headers) =>
          auth.api.getSession({ headers }),
        ),
    },
  },
});
