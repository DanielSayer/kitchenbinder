import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Collection } from "@/components/recipes/collection";
import { type RecipeSort, recipeSorts } from "@/components/recipes/recipe-list";

type CollectionSearch = {
  q?: string;
  favourites?: boolean;
  unrated?: boolean;
  neverCooked?: boolean;
  cookedBefore?: string;
  tags?: string;
  sort?: RecipeSort;
  page?: number;
};

export const Route = createFileRoute("/_auth/recipes/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): CollectionSearch => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    favourites:
      search.favourites === true || search.favourites === "true"
        ? true
        : undefined,
    unrated:
      search.unrated === true || search.unrated === "true" ? true : undefined,
    neverCooked:
      search.neverCooked === true || search.neverCooked === "true"
        ? true
        : undefined,
    cookedBefore: z.iso.date().safeParse(search.cookedBefore).data,
    tags:
      typeof search.tags === "string" && search.tags ? search.tags : undefined,
    sort: z.enum(recipeSorts).safeParse(search.sort).data,
    page: z.coerce.number().int().min(0).max(1_000_000).safeParse(search.page)
      .data,
  }),
  component: Collection,
});
