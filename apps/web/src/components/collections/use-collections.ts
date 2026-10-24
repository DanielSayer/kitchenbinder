import type { AppRouter } from "@prep-sheet/api/routers/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { isPantryTone, type PantryTone } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
export type CollectionSummary = Outputs["collections"]["list"][number];
export type HouseholdSummary = Outputs["households"]["list"][number];

export function householdTone(color: string | null | undefined): PantryTone {
  return isPantryTone(color) ? color : "sage";
}

/** Tab/marker colour: the first household it is shared with, else tomato ("mine"). */
export function collectionTone(collection: CollectionSummary): PantryTone {
  const first = collection.sharedWith[0];
  return first ? householdTone(first.color) : "tomato";
}

export function useCollections() {
  const trpc = useTRPC();
  return useQuery(trpc.collections.list.queryOptions());
}

/** Shared households (never "Just me"), the only valid share targets. */
export function useShareableHouseholds() {
  const trpc = useTRPC();
  const households = useQuery(trpc.households.list.queryOptions());
  return {
    ...households,
    shareable: households.data?.filter((item) => !item.personal) ?? [],
  };
}

/** Refresh everything that shows collection membership or contents. */
export function useInvalidateCollections() {
  const trpc = useTRPC();
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: trpc.collections.pathKey() }),
      client.invalidateQueries({ queryKey: trpc.recipes.list.queryKey() }),
      client.invalidateQueries({ queryKey: trpc.recipes.get.queryKey() }),
    ]);
}
