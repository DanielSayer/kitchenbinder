-- Append to the published 0006/0007 lineage. Existing planner households and
-- former recipe groups stay separate, retaining their IDs and memberships.
ALTER TABLE "household" ADD COLUMN "personal" boolean DEFAULT false NOT NULL;
ALTER TABLE "household" ADD COLUMN "color" text DEFAULT 'sage' NOT NULL;
ALTER TABLE "household" ADD CONSTRAINT "household_color_check" CHECK ("household"."color" in ('tomato', 'olive', 'butter', 'plum', 'sage'));
CREATE UNIQUE INDEX "household_personal_owner_idx" ON "household" USING btree ("owner_id") WHERE "household"."personal";

ALTER TABLE "household_member" DROP CONSTRAINT "household_member_pkey";
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_id_user_id_pk" PRIMARY KEY ("household_id", "user_id");
DROP INDEX "household_member_household_idx";
CREATE INDEX "household_member_user_idx" ON "household_member" USING btree ("user_id");

INSERT INTO "household" ("id", "name", "owner_id", "created_at")
SELECT "id", "name", "owner_id", "created_at" FROM "group";
INSERT INTO "household_member" ("household_id", "user_id", "joined_at")
SELECT "group_id", "user_id", "joined_at" FROM "group_member";
INSERT INTO "household_invite" ("id", "household_id", "token_hash", "created_at", "expires_at", "revoked_at", "accepted_at")
SELECT "id", "group_id", "token_hash", "created_at", "expires_at", "revoked_at", "accepted_at" FROM "group_invite";

-- Shared households get colours round-robin; personal households are sage.
UPDATE "household" h SET "color" = (ARRAY['tomato', 'olive', 'butter', 'plum', 'sage'])[((o.n - 1) % 5) + 1]
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "household") o
WHERE o."id" = h."id";

-- Deterministic ids with RFC 4122 version/variant bits so API uuid validation accepts them.
INSERT INTO "household" ("id", "name", "owner_id", "personal", "color", "created_at")
SELECT overlay(overlay(md5('personal:' || u."id") placing '4' from 13) placing '8' from 17)::uuid, 'Just me', u."id", true, 'sage', u."created_at" FROM "user" u;
INSERT INTO "household_member" ("household_id", "user_id", "joined_at")
SELECT h."id", h."owner_id", h."created_at" FROM "household" h WHERE h."personal";

-- Group recipes belong to their creator, else the group owner, and stay shared with it.
CREATE TABLE "recipe_share" (
	"recipe_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_share_recipe_id_household_id_pk" PRIMARY KEY("recipe_id","household_id")
);
ALTER TABLE "recipe_share" ADD CONSTRAINT "recipe_share_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recipe_share" ADD CONSTRAINT "recipe_share_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "recipe_share_household_idx" ON "recipe_share" USING btree ("household_id");

UPDATE "recipe" r SET "user_id" = h."owner_id"
FROM "household" h WHERE r."group_id" = h."id" AND r."user_id" IS NULL;
INSERT INTO "recipe_share" ("recipe_id", "household_id", "created_at")
SELECT "id", "group_id", "created_at" FROM "recipe" WHERE "group_id" IS NOT NULL;

-- Group tags merge into each recipe owner's personal tag with the same lower(name).
CREATE TEMP TABLE household_tag_used ON COMMIT DROP AS
SELECT DISTINCT r."user_id", t."id" AS old_id, t."name", t."description"
FROM "recipe_tag" rt JOIN "recipe" r ON r."id" = rt."recipe_id" JOIN "tag" t ON t."id" = rt."tag_id"
WHERE t."group_id" IS NOT NULL AND r."user_id" IS NOT NULL
UNION
SELECT DISTINCT i."user_id", t."id", t."name", t."description"
FROM "recipe_import" i
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(i."generated"->'tagIds') = 'array' THEN i."generated"->'tagIds' ELSE '[]'::jsonb END
) AS generated_tag(id)
JOIN "tag" t ON t."id"::text = generated_tag.id
WHERE t."group_id" IS NOT NULL;

CREATE TEMP TABLE household_tag_map ON COMMIT DROP AS
WITH canonical AS (
  SELECT DISTINCT ON (user_id, lower(name)) user_id, name, description
  FROM household_tag_used ORDER BY user_id, lower(name), old_id
)
SELECT u.user_id, u.old_id,
  coalesce(p."id", overlay(overlay(md5('household-tag:' || c.user_id || ':' || lower(c.name)) placing '4' from 13) placing '8' from 17)::uuid) AS new_id,
  p."id" IS NULL AS created, c.name, c.description
FROM household_tag_used u
JOIN canonical c ON c.user_id = u.user_id AND lower(c.name) = lower(u.name)
LEFT JOIN "tag" p ON p."user_id" = u.user_id AND lower(p."name") = lower(u.name);

INSERT INTO "tag" ("id", "user_id", "name", "description")
SELECT DISTINCT new_id, user_id, name, description FROM household_tag_map WHERE created;

INSERT INTO "recipe_tag" ("recipe_id", "tag_id")
SELECT DISTINCT rt."recipe_id", m.new_id
FROM "recipe_tag" rt JOIN "recipe" r ON r."id" = rt."recipe_id"
JOIN household_tag_map m ON m.user_id = r."user_id" AND m.old_id = rt."tag_id"
ON CONFLICT DO NOTHING;

-- Ready import checkpoints may still reference group tag IDs.
UPDATE "recipe_import" i SET "generated" = jsonb_set(i."generated", '{tagIds}', (
  SELECT coalesce(jsonb_agg(DISTINCT coalesce(m.new_id::text, generated_tag.id)), '[]'::jsonb)
  FROM jsonb_array_elements_text(i."generated"->'tagIds') AS generated_tag(id)
  LEFT JOIN household_tag_map m ON m.user_id = i."user_id" AND m.old_id::text = generated_tag.id
))
WHERE jsonb_typeof(i."generated"->'tagIds') = 'array' AND EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(i."generated"->'tagIds') AS generated_tag(id)
  JOIN household_tag_map m ON m.user_id = i."user_id" AND m.old_id::text = generated_tag.id
);

DROP TABLE household_tag_map;
DROP TABLE household_tag_used;
DELETE FROM "tag" WHERE "group_id" IS NOT NULL;
DROP INDEX "tag_group_name_idx";
ALTER TABLE "tag" DROP CONSTRAINT "tag_scope_check";
ALTER TABLE "tag" DROP CONSTRAINT "tag_group_id_group_id_fk";
ALTER TABLE "tag" DROP COLUMN "group_id";

DROP INDEX "recipe_group_created_idx";
ALTER TABLE "recipe" DROP CONSTRAINT "recipe_group_id_group_id_fk";
ALTER TABLE "recipe" DROP COLUMN "group_id";

-- Collections are personal, ordered and shared with households.
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "collection_recipe" (
	"collection_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_recipe_collection_id_recipe_id_pk" PRIMARY KEY("collection_id","recipe_id")
);
CREATE TABLE "collection_share" (
	"collection_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_share_collection_id_household_id_pk" PRIMARY KEY("collection_id","household_id")
);
ALTER TABLE "collection" ADD CONSTRAINT "collection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "collection_recipe" ADD CONSTRAINT "collection_recipe_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "collection_recipe" ADD CONSTRAINT "collection_recipe_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "collection_share" ADD CONSTRAINT "collection_share_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "collection_share" ADD CONSTRAINT "collection_share_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "collection_user_position_idx" ON "collection" USING btree ("user_id","position");
CREATE UNIQUE INDEX "collection_user_name_idx" ON "collection" USING btree ("user_id",lower("name"));
CREATE INDEX "collection_recipe_recipe_idx" ON "collection_recipe" USING btree ("recipe_id");
CREATE INDEX "collection_recipe_position_idx" ON "collection_recipe" USING btree ("collection_id","position");
CREATE INDEX "collection_share_household_idx" ON "collection_share" USING btree ("household_id");

-- Personal plans/lists move to "Just me"; shared plans/lists stay in their
-- original household, preserving snapshots, revisions, trips and sources.
ALTER TABLE "meal_planner" DROP CONSTRAINT "meal_planner_scope_check";
UPDATE "meal_planner" m SET "household_id" = h."id"
FROM "household" h WHERE h."owner_id" = m."user_id" AND h."personal" AND m."household_id" IS NULL;
ALTER TABLE "meal_planner" DROP CONSTRAINT "meal_planner_pkey";
ALTER TABLE "meal_planner" DROP CONSTRAINT "meal_planner_user_id_user_id_fk";
ALTER TABLE "meal_planner" DROP COLUMN "user_id";
ALTER TABLE "meal_planner" DROP COLUMN "id";
ALTER TABLE "meal_planner" DROP CONSTRAINT "meal_planner_household_id_unique";
ALTER TABLE "meal_planner" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "meal_planner" ADD CONSTRAINT "meal_planner_pkey" PRIMARY KEY ("household_id");

ALTER TABLE "shopping_plan" DROP CONSTRAINT "shopping_plan_scope_check";
UPDATE "shopping_plan" p SET "household_id" = h."id"
FROM "household" h WHERE h."owner_id" = p."user_id" AND h."personal" AND p."household_id" IS NULL;
ALTER TABLE "shopping_plan" DROP CONSTRAINT "shopping_plan_pkey";
ALTER TABLE "shopping_plan" DROP CONSTRAINT "shopping_plan_user_id_user_id_fk";
ALTER TABLE "shopping_plan" DROP COLUMN "user_id";
ALTER TABLE "shopping_plan" DROP CONSTRAINT "shopping_plan_household_id_unique";
ALTER TABLE "shopping_plan" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "shopping_plan" ADD CONSTRAINT "shopping_plan_pkey" PRIMARY KEY ("household_id");

ALTER TABLE "shopping_item" DROP CONSTRAINT "shopping_item_scope_check";
UPDATE "shopping_item" s SET "household_id" = h."id"
FROM "household" h WHERE h."owner_id" = s."user_id" AND h."personal" AND s."household_id" IS NULL;
ALTER TABLE "shopping_item" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "shopping_item" RENAME COLUMN "user_id" TO "added_by";
ALTER TABLE "shopping_item" ALTER COLUMN "added_by" DROP NOT NULL;
ALTER TABLE "shopping_item" DROP CONSTRAINT "shopping_item_user_id_user_id_fk";
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
DROP INDEX "shopping_item_user_idx";

-- Imports share with the household and/or add to the collection on save.
ALTER TABLE "recipe_import" RENAME COLUMN "group_id" TO "household_id";
ALTER TABLE "recipe_import" ADD COLUMN "collection_id" uuid;

-- Dependent data is now represented by household shares and memberships.
DROP TABLE "group_invite";
DROP TABLE "group_member";
DROP TABLE "group";
