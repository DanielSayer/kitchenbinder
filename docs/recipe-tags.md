# Recipe tags

Applied tags belong to a recipe. Every member of its collection sees the same tags and can add or remove them. Detail views, collection filters, bulk edits and tag pickers use the same assignments. Favourites, ratings and cooking history remain account-specific.

Custom tag definitions belong to a collection. Personal collections use their owner's definitions; shared collections have definitions that any current member can create, rename or delete. Built-in tags are available everywhere and cannot be edited. Import and generation jobs offer the destination collection's tags to AI and validate returned IDs against that collection before saving.

Settings > Tags includes a collection selector. A collection supports up to 100 custom tags. The collection lock serializes member writes, name checks and tag admission. Names are case-insensitive within a collection and cannot conflict with built-in names. Leaving a group or deleting a member's account does not remove shared definitions or recipe assignments.

Copying a recipe copies its applied tags. Built-ins keep their IDs. Custom tags reuse a name in the destination or copy the name and description into a new destination definition. Existing destination definitions keep their description. Copying fails atomically if new definitions would exceed the destination's limit.

## Existing installations

Stop web and import workers, back up the database, rehearse on a restored copy, then run `pnpm db:migrate` and `pnpm db:verify` with the release migration credential. Follow [the deployment runbook](deployment.md). This change requires migration `0005_collection_recipe_tags.sql` before running the updated application.

The migration unions existing assignments from all members and removes duplicate recipe/tag pairs. Existing personal tag definitions remain intact. Custom tags used on group recipes are copied into that group; case-insensitive matching names merge into one definition, retaining the name and description from the lowest source tag UUID. Original personal definitions keep their own descriptions. Ready import checkpoints are remapped to the collection definitions too. This also preserves tags on recoverable deleted recipes and permits existing collections over the cap to retain their tags; they must remove tags before creating more. Unused personal definitions are not published to groups.

The PostgreSQL integration suites cover shared automatic tags, manual and bulk changes, filtering, collection permissions, concurrent admission, copies and migration preservation. Tests mock generation and make no paid AI calls.
