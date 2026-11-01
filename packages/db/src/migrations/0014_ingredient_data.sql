ALTER TABLE "recipe" ADD COLUMN "ingredient_data" jsonb;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "ingredients_pending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopping_item" ADD COLUMN "ingredient" jsonb;--> statement-breakpoint
CREATE INDEX "recipe_ingredients_pending_idx" ON "recipe" USING btree ("ingredients_pending_at") WHERE "recipe"."ingredients_pending_at" is not null;--> statement-breakpoint
-- Existing recipes are parsed by the worker's AI backfill.
UPDATE "recipe" SET "ingredients_pending_at" = now();