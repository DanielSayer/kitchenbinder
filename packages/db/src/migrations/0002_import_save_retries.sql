ALTER TABLE "recipe_import" ADD COLUMN "save_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import" ADD COLUMN "next_save_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import" ADD COLUMN "save_claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recipe_import_save_retry_idx" ON "recipe_import" USING btree ("state","next_save_attempt_at");