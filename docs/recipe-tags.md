# Recipe tags

Tags are personal (see [households](households.md)). Only a recipe's owner adds or removes its tags, using built-in tags or their own custom tags. Everyone with access sees the owner's tags read-only: list items and details include `tags: { id, name }[]` alongside `tagIds`. Favourites, ratings and cooking history remain account-specific.

Custom tag definitions belong to one account; `tags.list` returns built-ins plus the caller's own tags. Built-in tags are available everywhere and cannot be edited. Import and generation jobs offer the importer's tags to AI and validate returned IDs against them before saving.

An account supports up to 100 custom tags. The account lock serializes writes, name checks and tag admission. Names are case-insensitive per account and cannot conflict with built-in names. Deleting an account deletes its tags, including on recipes that survive in a household.

Copying a recipe copies its applied tags into the copier's tags. Built-ins keep their IDs. Other people's tags reuse a matching name or are created with the same name and description. Existing definitions keep their description. Copying fails atomically if new definitions would exceed the limit.

Migration `0008_pantry_households.sql` merges each former group tag into the recipe owner's personal tag with the same `lower(name)` (creating it when missing) and remaps ready import checkpoints; unused group tags are dropped.

## Existing installations

Stop web and import workers, back up the database, rehearse on a restored copy, then run `pnpm db:migrate` and `pnpm db:verify` with the release migration credential. Follow [the deployment runbook](deployment.md). This change requires migration `0005_collection_recipe_tags.sql` before running the updated application.

The migration unions existing assignments from all members and removes duplicate recipe/tag pairs. Existing personal tag definitions remain intact. Custom tags used on group recipes are copied into that group; case-insensitive matching names merge into one definition, retaining the name and description from the lowest source tag UUID. Original personal definitions keep their own descriptions. Ready import checkpoints are remapped to the collection definitions too. This also preserves tags on recoverable deleted recipes and permits existing collections over the cap to retain their tags; they must remove tags before creating more. Unused personal definitions are not published to groups.

The PostgreSQL integration suites cover shared automatic tags, manual and bulk changes, filtering, collection permissions, concurrent admission, copies and migration preservation. Tests mock generation and make no paid AI calls.
