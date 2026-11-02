ALTER TABLE "user_preference" ADD COLUMN "unit_system" text DEFAULT 'metric' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "measure_standard" text DEFAULT 'au' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_unit_system_check" CHECK ("user_preference"."unit_system" in ('metric', 'imperial'));--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_measure_standard_check" CHECK ("user_preference"."measure_standard" in ('au', 'us'));