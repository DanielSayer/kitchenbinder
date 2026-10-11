# Recipe collection pages

Collection, shopping, meal and tag pickers request 24 recipes at a time. The API accepts page sizes from 1 to 48 and returns `{ items, total }`. Page numbers start at zero. Filtering and sorting happen in PostgreSQL before the page is selected. Count and page queries share a read-only repeatable-read snapshot.

Collection summaries contain ID, title, description, ingredient count, durations, creation date and the current user's favourites, rating, tags and cooking summary. They omit ingredients, steps and notes. Detail/edit requests retain full content. Ingredient search examines each ingredient line on the server; names and ingredients use literal case-insensitive substring matching. Notes and method are not searched. All selected tags must match. Undated cooks count as cooked, but do not satisfy a last-cooked date filter. Date boundaries are strict.

Newest sorts by creation date descending, then UUID ascending. Name uses natural numeric ordering, ignoring case and accents. Rating and last-cooked sorts put higher/newer values first and unknown values last. Cooking time prefers a valid elapsed duration, falls back to complete prep plus cook time, and puts incomplete durations last. These sorts then use name and UUID to break ties. ICU's language-neutral collation makes this order consistent across clients.

Pages use offsets. Concurrent inserts, deletes or sort changes can move recipes between separate page requests; a single page and its count remain consistent. Exact counts, substring/ingredient search and non-indexed sorts still examine matching recipes in the database. Response size and browser work are bounded; database work does not become constant. No browser consumer loads every page in the background. Select page acts on the displayed page, and selections remain when paging or filtering. Changing collections clears the collection's bulk selection. Selected IDs are rechecked by the existing mutations when applied.

Shopping and meal pickers select only ID, title, collection ID and servings from JSON. The meal editor looks up a selected recipe through `shopping.recipe`, which returns the same small projection even when that recipe is outside the current page. The tag picker requests ID, title and collection ID, with the already-applied tag excluded on the server. All queries preserve membership/account permission checks and exclude deleted recipes.

## Database setup

Before starting this version against a new or existing database, apply `packages/db/src/upgrades/recipe-list.sql` with your normal PostgreSQL deployment tool. It idempotently creates `recipe_name`, an ICU collation with numeric ordering and primary strength. The PostgreSQL build must support ICU. Drizzle push does not create collations. The isolated test wrapper applies this SQL after its schema setup.

For the repository's local Docker database, from the repository root in PowerShell:

```powershell
Get-Content packages/db/src/upgrades/recipe-list.sql -Raw | docker exec -i prep-sheet-postgres psql -U postgres -d prep-sheet -v ON_ERROR_STOP=1
```

## Regression and measurement

`pnpm test packages/api/src/recipes/list.integration.test.ts --disableConsoleIntercept` uses a disposable PostgreSQL container and prints the large-fixture measurements. It covers boundaries, tie ordering, search, every collection filter/sort, permission isolation, deletion and picker projections. It inserts and removes 2,000 local recipes with 20 ingredient lines, 12 method lines and batch notes. There are no live AI requests or timing assertions.

On 11 October 2026, the full recipe projection was 14,090,891 JSON bytes. A 24-recipe collection page, including its count, was 8,760 bytes; the shopping picker page was 2,462 bytes. These are JSON sizes before transport framing or compression. The legacy measurement includes only ID, title and content, so it understates the old complete list payload. One local run measured 61.81 ms for that full query and 21.79 ms for the paginated endpoint, including its count and transaction. These observations are not latency guarantees. `EXPLAIN ANALYZE` of the actual paginated collection query returned a Limit node with 24 rows and 13.91 ms execution time.
