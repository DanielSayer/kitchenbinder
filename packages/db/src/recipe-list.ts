export const recipePageSize = 24;
export const maxRecipePageSize = 48;
export const recipeSorts = [
  "newest",
  "last-cooked",
  "highest-rated",
  "name",
  "cooking-time",
] as const;
export type RecipeSort = (typeof recipeSorts)[number];
