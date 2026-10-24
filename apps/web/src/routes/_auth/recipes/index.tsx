import { recipeSorts } from "@prep-sheet/db/recipe-list";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Collection } from "@/components/recipes/collection";
import type { LibrarySort } from "@/components/recipes/library-sheets";

type CollectionSearch = {
  /** Selected collection tab; omitted = All. */
  collection?: string;
  q?: string;
  favourites?: boolean;
  unrated?: boolean;
  neverCooked?: boolean;
  cookedBefore?: string;
  tags?: string;
  sort?: LibrarySort;
  page?: number;
};

const flag = (value: unknown) =>
  value === true || value === "true" ? true : undefined;

export const Route = createFileRoute("/_auth/recipes/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): CollectionSearch => ({
    collection: z.uuid().safeParse(search.collection).data,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    favourites: flag(search.favourites),
    unrated: flag(search.unrated),
    neverCooked: flag(search.neverCooked),
    cookedBefore: z.iso.date().safeParse(search.cookedBefore).data,
    tags:
      typeof search.tags === "string" && search.tags ? search.tags : undefined,
    sort: z.enum([...recipeSorts, "position"]).safeParse(search.sort).data,
    page: z.coerce.number().int().min(0).max(1_000_000).safeParse(search.page)
      .data,
  }),
  component: Collection,
});
