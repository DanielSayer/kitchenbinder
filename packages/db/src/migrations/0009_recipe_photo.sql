-- Cover photos copied from the import source. Copies of a recipe share objects.
ALTER TABLE "recipe" ADD COLUMN "photo" jsonb;
ALTER TABLE "recipe_import" ADD COLUMN "image_candidates" jsonb;
