import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/utils/trpc";

const ratings = [1, 2, 3, 4, 5] as const;

export function RatingControl({
  id,
  title,
  rating,
  compact = false,
}: {
  id: string;
  title: string;
  rating: number | null;
  compact?: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState<number | null>(null);
  const [pulse, setPulse] = useState({ count: 0, value: 0 });
  const mutation = useMutation(
    trpc.recipes.setRating.mutationOptions({
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
        toast.error("Couldn't save your rating. Please try again.");
      },
    }),
  );
  const selected = mutation.isPending ? mutation.variables.rating : rating;
  const preview = hovered ?? selected ?? 0;

  return (
    <fieldset
      className={["rating-control", compact && "rating-control-compact"]
        .filter(Boolean)
        .join(" ")}
      onMouseLeave={() => setHovered(null)}
    >
      <legend className="sr-only">Rate {title}</legend>
      {!compact && (
        <span className="rating-value" aria-live="polite">
          {selected ? `${selected} out of 5` : "Not rated"}
        </span>
      )}
      <span className="rating-stars">
        {ratings.map((value) => {
          const isSelected = selected === value;
          const willClear = isSelected && hovered === null;
          return (
            <button
              key={value}
              type="button"
              className="rating-star"
              aria-label={
                willClear
                  ? `Clear your rating for ${title}`
                  : `Rate ${title} ${value} out of 5`
              }
              aria-pressed={isSelected}
              disabled={mutation.isPending}
              onMouseEnter={() => setHovered(value)}
              onFocus={(event) => {
                // Sheets auto-focus the first star on open; only preview for keyboard focus.
                if (event.currentTarget.matches(":focus-visible")) {
                  setHovered(value);
                }
              }}
              onBlur={() => setHovered(null)}
              onClick={() => {
                setPulse((previous) => ({
                  count: previous.count + 1,
                  value,
                }));
                mutation.mutate({ id, rating: isSelected ? null : value });
              }}
            >
              <Star
                key={`${pulse.count}-${value}`}
                size={compact ? 17 : 21}
                fill={value <= preview ? "currentColor" : "none"}
                data-pulse={pulse.value === value ? "true" : undefined}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </span>
    </fieldset>
  );
}
