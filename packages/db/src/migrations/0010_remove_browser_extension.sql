ALTER TABLE "extension_credential" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extension_grant" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extension_rate" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "extension_credential" CASCADE;--> statement-breakpoint
DROP TABLE "extension_grant" CASCADE;--> statement-breakpoint
DROP TABLE "extension_rate" CASCADE;--> statement-breakpoint
ALTER TABLE "recipe_import" ALTER COLUMN "source_kind" SET DEFAULT 'website';