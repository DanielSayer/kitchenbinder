CREATE TABLE "recipe_import_photo" (
	"import_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "recipe_import_photo_import_id_position_pk" PRIMARY KEY("import_id","position")
);
--> statement-breakpoint
ALTER TABLE "recipe_import_photo" ADD CONSTRAINT "recipe_import_photo_import_id_recipe_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."recipe_import"("id") ON DELETE cascade ON UPDATE no action;