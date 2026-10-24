import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

export function FavouriteButton({
  id,
  title,
  isFavourite,
  showLabel = false,
  className,
}: {
  id: string;
  title: string;
  isFavourite: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [interaction, setInteraction] = useState({ count: 0, starred: false });
  const mutation = useMutation(
    trpc.recipes.setFavourite.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.recipes.list.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.recipes.get.queryKey({ id }),
          }),
        ]);
      },
      onError: () => {
        setInteraction({ count: 0, starred: false });
        toast.error("Couldn't update your favourites. Please try again.");
      },
    }),
  );
  const selected = mutation.isPending
    ? mutation.variables.isFavourite
    : isFavourite;
  return (
    <button
      type="button"
      className={[
        showLabel ? "organise-action" : "icon-button",
        "favourite-button",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${selected ? "Remove" : "Add"} ${title} ${selected ? "from" : "to"} favourites`}
      title={selected ? "Remove from favourites" : "Add to favourites"}
      aria-pressed={selected}
      disabled={mutation.isPending}
      onClick={() => {
        setInteraction((previous) => ({
          count: previous.count + 1,
          starred: !isFavourite,
        }));
        mutation.mutate({ id, isFavourite: !isFavourite });
      }}
    >
      <span
        key={interaction.count}
        className="favourite-icon"
        data-motion={
          interaction.count
            ? interaction.starred
              ? "star"
              : "unstar"
            : undefined
        }
        aria-hidden="true"
      >
        <Heart size={20} fill={selected ? "currentColor" : "none"} />
        {interaction.count > 0 && interaction.starred && (
          <span className="favourite-confetti">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        )}
      </span>
      {showLabel && <span>{selected ? "Favourited" : "Favourite"}</span>}
    </button>
  );
}
