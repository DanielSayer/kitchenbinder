-- Tags applied by any member become recipe data. Personal definitions stay personal;
-- clone used custom definitions into each shared collection and merge names by lower(name).
ALTER TABLE "tag" ADD COLUMN "group_id" uuid;
ALTER TABLE "tag" ADD CONSTRAINT "tag_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "tag_group_name_idx" ON "tag" USING btree ("group_id",lower("name"));
ALTER TABLE "tag" ADD CONSTRAINT "tag_scope_check" CHECK ("tag"."user_id" is null or "tag"."group_id" is null);

CREATE TEMP TABLE collection_tag_map ON COMMIT DROP AS
WITH used AS (
  SELECT DISTINCT r.group_id, t.id, t.name, t.description
  FROM recipe_tag rt JOIN recipe r ON r.id = rt.recipe_id JOIN tag t ON t.id = rt.tag_id
  WHERE r.group_id IS NOT NULL AND t.user_id IS NOT NULL
  UNION
  SELECT DISTINCT i.group_id, t.id, t.name, t.description
  FROM recipe_import i
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(i.generated->'tagIds') = 'array' THEN i.generated->'tagIds' ELSE '[]'::jsonb END
  ) AS generated_tag(id)
  JOIN tag t ON t.id::text = generated_tag.id
  WHERE i.group_id IS NOT NULL AND t.user_id IS NOT NULL
), canonical AS (
  SELECT DISTINCT ON (group_id, lower(name)) group_id, id, name, description
  FROM used ORDER BY group_id, lower(name), id
)
SELECT u.group_id, u.id AS old_id, md5(c.group_id::text || ':' || c.id::text)::uuid AS new_id,
  c.name, c.description
FROM used u JOIN canonical c ON c.group_id = u.group_id AND lower(c.name) = lower(u.name);

INSERT INTO tag (id, group_id, name, description)
SELECT DISTINCT new_id, group_id, name, description FROM collection_tag_map;

-- Ready import checkpoints may still reference the old personal definition IDs.
UPDATE recipe_import i SET generated = jsonb_set(i.generated, '{tagIds}', (
  SELECT coalesce(jsonb_agg(DISTINCT coalesce(m.new_id::text, generated_tag.id)), '[]'::jsonb)
  FROM jsonb_array_elements_text(i.generated->'tagIds') AS generated_tag(id)
  LEFT JOIN collection_tag_map m ON m.group_id = i.group_id AND m.old_id::text = generated_tag.id
))
WHERE i.group_id IS NOT NULL AND jsonb_typeof(i.generated->'tagIds') = 'array';

CREATE TEMP TABLE collection_recipe_tags ON COMMIT DROP AS
SELECT DISTINCT rt.recipe_id, coalesce(m.new_id, rt.tag_id) AS tag_id
FROM recipe_tag rt JOIN recipe r ON r.id = rt.recipe_id
LEFT JOIN collection_tag_map m ON m.group_id = r.group_id AND m.old_id = rt.tag_id;

DELETE FROM recipe_tag;
ALTER TABLE "recipe_tag" DROP CONSTRAINT "recipe_tag_user_id_user_id_fk";
ALTER TABLE "recipe_tag" DROP CONSTRAINT "recipe_tag_user_id_recipe_id_tag_id_pk";
ALTER TABLE "recipe_tag" DROP COLUMN "user_id";
ALTER TABLE "recipe_tag" ADD CONSTRAINT "recipe_tag_recipe_id_tag_id_pk" PRIMARY KEY("recipe_id","tag_id");
INSERT INTO recipe_tag (recipe_id, tag_id) SELECT recipe_id, tag_id FROM collection_recipe_tags;
DROP TABLE collection_recipe_tags;
DROP TABLE collection_tag_map;
