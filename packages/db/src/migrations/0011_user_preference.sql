CREATE TABLE "user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_preference_week_starts_on_check" CHECK ("user_preference"."week_starts_on" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;