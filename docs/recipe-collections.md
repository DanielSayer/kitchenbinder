# Recipe collection pages

Collection, shopping, meal and tag pickers request 24 recipes at a time. The API accepts page sizes from 1 to 48 and returns `{ items, total }`. Page numbers start at zero. Filtering and sorting happen in PostgreSQL before the page is selected. Count and page queries share a read-only repeatable-read snapshot.

Collection summaries contain ID, title, description, ingredient count, durations, creation date and recipe tags and the current user's favourites, rating and cooking summary. They omit ingredients, steps and notes. Detail/edit requests retain full content. Ingredient search examines each ingredient line on the server; names and ingredients use literal case-insensitive substring matching. Notes and method are not searched. All selected tags must match. Undated cooks count as cooked, but do not satisfy a last-cooked date filter. Date boundaries are strict.

Newest sorts by creation date descending, then UUID ascending. Name uses natural numeric ordering, ignoring case and accents. Rating and last-cooked sorts put higher/newer values first and unknown values last. Cooking time prefers a valid elapsed duration, falls back to complete prep plus cook time, and puts incomplete durations last. These sorts then use name and UUID to break ties. ICU's language-neutral collation makes this order consistent across clients.

Pages use offsets. Concurrent inserts, deletes or sort changes can move recipes between separate page requests; a single page and its count remain consistent. Exact counts, substring/ingredient search and non-indexed sorts still examine matching recipes in the database. Response size and browser work are bounded; database work does not become constant. No browser consumer loads every page in the background. Select page acts on the displayed page, and selections remain when paging or filtering. Changing collections clears the collection's bulk selection. Selected IDs are rechecked by the existing mutations when applied. The collection page is retained in the URL so opening a detail and going Back restores that page. Search/filter/sort and collection changes reset to the first page. Removing the last page recovers to the new final page.

The UI tests in `apps/web/src/components/recipes/pagination.test.ts` exercise page resets, navigation restoration, deletion recovery and shopping selections retained across page/search changes and submitted together.

Shopping and meal pickers select only ID, title, collection ID and servings from JSON. The meal editor looks up a selected recipe through `shopping.recipe`, which returns the same small projection even when that recipe is outside the current page. The tag picker requests ID, title and collection ID, with the already-applied tag excluded on the server. All queries preserve membership/account permission checks and exclude deleted recipes.

## Database setup

Use PostgreSQL 18 with ICU. Versioned migration `0001_recipe_name.sql` creates `recipe_name`, the nondeterministic ICU collation with numeric ordering and primary strength. With the direct migration credential injected as `DATABASE_URL`, run these from the repository root while web and worker are stopped:

```sh
pnpm db:migrate
pnpm db:verify
```

Verification checks migration hashes, the complete schema, collation locale/version and comparison behaviour. An unversioned installation requires a backup, restored-copy rehearsal and explicitly reviewed `pnpm db:adopt`, followed by verification. Follow the [deployment runbook](deployment.md). Do not apply `recipe-list.sql` separately or use schema push as release setup. The test wrapper applies the complete versioned migrations to its disposable database.

## Historical verification on 11 October 2026

That feature run passed 37 files and 291 tests through `pnpm test`, with seven live AI tests skipped. The wrapper removed its PostgreSQL container and volume. The then-current `pnpm check-types`, explicit web/database TypeScript checks and web production build passed. A separate API TypeScript check reported two errors at that time: a missing PDF logo `?inline` declaration and a shopping test string/UUID comparison. These are dated observations, not current failures. The current release gate includes the API compiler; use [release checks](release-checks.md) to verify a candidate. The feature build also reported a large client chunk warning.

## Regression and measurement

`pnpm test packages/api/src/recipes/list.integration.test.ts --disableConsoleIntercept` uses a disposable PostgreSQL container and prints the large-fixture measurements. It covers boundaries, tie ordering, search, every collection filter/sort, permission isolation, deletion and picker projections. It inserts and removes 2,000 local recipes with 20 ingredient lines, 12 method lines and batch notes. There are no live AI requests or timing assertions.

On 11 October 2026, the full recipe projection was 14,090,891 JSON bytes. A 24-recipe collection page, including its count, was 8,760 bytes; the shopping picker page was 2,462 bytes. These are JSON sizes before transport framing or compression. The legacy measurement includes only ID, title and content, so it understates the old complete list payload. One local run measured 61.81 ms for that full query and 21.79 ms for the paginated endpoint, including its count and transaction. These observations are not latency guarantees. `EXPLAIN ANALYZE` of the actual paginated collection query returned a Limit node with 24 rows and 13.91 ms execution time.

## Historical browser verification on 11 October 2026

The running local app was inspected in the in-app Chromium browser with an authenticated development session and a temporary 30-recipe group. Desktop checks used 1280 × 900; mobile layouts used 390 × 844 and 320 × 760. The collection displayed 24 then 6 recipes, sorted names naturally, found the 15 tomato recipes through ingredient search, retained bulk selections across pages/search, and returned from detail to page two. The shopping picker retained selections across pages and displayed original servings. Collection and picker layouts had no horizontal overflow; the mobile picker has an explicit full-width Add ingredients action below the selection summary.

Picker selections were exercised at desktop width. Automation clicks in the mobile viewport did not reliably hit dropdown options, so mobile evidence is layout inspection of those selected states, rather than a verified touchscreen interaction. Meal and tag pickers were integrated and covered by API/type checks, but their complete rendered flows were not exercised. No production deployment, real mobile device or paid AI call was used. The temporary group and all 30 fixture recipes were removed, and the original personal collection was restored. The local development database's collation was applied during that feature work. Current environments use the versioned migration and verification procedure above.
