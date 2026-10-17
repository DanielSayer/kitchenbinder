# Personal shopping list

Each signed-in account has one persistent list at `/shopping`. Ingredients can be added from the recipe picker, collection selection, or recipe detail. Shared-collection recipes may be copied into a personal list; the list itself is never shared.

Ingredients retain their original text, recipe title and yield. List edits do not change recipes, and recipe updates or deletion do not change copied ingredients. Duplicate ingredient lines are kept separately. A recipe cannot be added again while any of its items remain on the list. Clearing or removing all of its items makes it available again.

Items have three states: needed, bought and owned. The checkbox marks an item bought; Already have marks it owned. Both can return to needed. Clear bought items removes only bought items. Reset list asks for confirmation before removing everything.

Writes are account-scoped. Recipe additions check current access and run transactionally; simultaneous additions of the same recipe do not duplicate its ingredients. A list holds up to 1,000 items, with up to 100 recipes per addition. Miscellaneous groceries use a request ID so retrying a save does not duplicate them. Unfinished text is stored locally by account and item, while saved items persist in PostgreSQL.

## Database setup

The versioned schema includes `shopping_item` and `shopping_plan`. From the repository root, with the direct migration credential injected as `DATABASE_URL`, run these before starting the candidate web and worker image:

```sh
pnpm db:migrate
pnpm db:verify
```

Stop web and worker before migration and restore runtime credentials before startup. An unversioned installation requires a backup, restored-copy rehearsal and explicitly reviewed `pnpm db:adopt`, followed by verification. Follow the [deployment runbook](deployment.md); do not push the schema of a deployed database.

## Verification

```sh
pnpm build:release
pnpm check-types
pnpm test packages/api/src/shopping.integration.test.ts
```

The build generates web routes before type checking on a clean checkout. The `pnpm test` wrapper provisions and removes a disposable PostgreSQL 18 database; never invoke Vitest directly or use the development/production database. The integration tests create isolated fixture accounts and clean them up afterwards. They cover authentication, personal versus shared recipe access, list privacy, concurrent duplicate additions, ingredient snapshots, item edits, owned/bought restoration, clear and reset.

## Generated shopping trip

Generate shopping list opens `/shopping/generated` and saves one generated view per account. It includes only items still needed, groups them by supermarket category, and preserves every original item and its recipe attribution. Ticking a combined item marks all of its source ingredients bought; unticking restores them to needed.

Grouping runs entirely in code. Clear ingredient matches with compatible units are combined, including grams/kilograms and millilitres/litres. Cups, tablespoons and teaspoons remain separate because measurement standards vary. Different ingredient types, pack sizes, ranges, alternatives and ambiguous amounts remain separate. Unrecognised products go into Other. Category rules and quantity parsing live in `packages/db/src/shopping-plan.ts` and are covered by its unit tests.

Adding, removing or editing ingredients, or marking a generated ingredient owned, makes the generated view stale. Checking off a stale list is rejected by the API until it is regenerated. Bought status changes stay synchronised without making the list stale. Resetting the preparation list also removes the generated view.

Sharing, multiple named lists, serving adjustment and offline synchronisation are outside this version.
