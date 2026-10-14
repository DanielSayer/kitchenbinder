# Recipe and meal draft recovery

## Manual recipes

Before sending a manual save, the browser stores its UUID, original destination and parsed content in session storage beside the raw form draft. Identical retries, including after a reload, reuse that submission. The server binds the UUID to a SHA-256 fingerprint of the validated content and destination. It stores that fingerprint once and retains it when the recipe is edited or moved.

If a response is lost, saving unchanged input recovers the recipe with the same ID. Changing the input or destination does not issue a fresh create or silently accept the older content. The form keeps the draft and offers **Recover earlier save**. This retries the original submission, which may create it if the first request never arrived. After recovery, **Review draft in saved recipe** transfers the raw draft into the existing recipe editor with the original submitted content and revision 1 as its base. That editor merges independent changes and reviews conflicting fields against the latest recipe. A pre-existing edit draft at the destination is never overwritten.

The original submission stays separate from Clear form and Cancel, since those actions cannot prove whether an uncertain request committed. The browser must retain a submission identity before the first network request. If storage is blocked or the identity cannot be read, saving stops with a visible explanation. Session storage recovery is scoped to that browser tab; clearing browser storage removes this protection.

### Additive schema integration

The combined release adds nullable `recipe.manual_request_hash` through versioned migration `0003_manual_request_identity.sql`, after the unchanged baseline, collation and retry migrations. Use `pnpm db:migrate`, or explicit `pnpm db:adopt` for a supported unversioned installation, while writers are stopped. Adoption uses the repeatable `edit-loss-manual-request.sql` upgrade and verifies the complete schema before recording history. Existing rows remain null. Retrying a legacy UUID without a stored original fingerprint returns an explicit conflict; current recipe content is never used to invent an original identity. See [deployment](deployment.md).

### Regression checks

`pnpm test apps/web/src/components/home/manual-recipe.test.ts packages/api/src/recipes/recipes.integration.test.ts` runs the real manual form, persistence and query/mutation hooks against the real API router and isolated PostgreSQL. It covers commit followed by lost response, reload recovery without duplicates, edits after uncertainty, recovery after another editor changes the recipe, transfer with the correct original base, a request that never arrived, blocked submission storage, concurrent different payloads and legacy UUID conflicts. Server tests also prove that retries remain bound to the original submission after later recipe edits.


## Meal planner

Active meal drafts live in session storage so each browser tab owns its unfinished work. They survive dialog closure, navigation and reloads in that tab. They use a version 2 envelope containing the raw fields, the original planner revision and the original meal input snapshot. Closing the dialog preserves that envelope. Restoring an older draft never adopts the revision of a newer query result as permission to overwrite its fields.

Every save fetches the current plan and compares each relevant field against the original meal. Independent changes merge automatically, such as a draft date change alongside another tab's new description, or a cooking quantity change alongside a new eating quantity. Conflicting values open **Review changed meal**. Each conflict requires a choice between **My draft** and **Saved meal** before **Save reviewed meal** is enabled. Changes between different meal types are reviewed together, so portions from one type cannot silently apply to another. Recipes and leftover sources are shown by name.

Saving a review fetches the plan again. A further change can require new choices; it does not reuse approval for an older saved value. A server revision conflict retains the agreed draft and its matching base. The next attempt fetches and merges again. There is no action that simply replaces the revision while keeping stale fields. If the meal was deleted, recreating it requires an explicit review choice.

Legacy drafts in local storage, including drafts containing only raw fields, remain readable and migrate into the current tab. Their original local value is retained until save or discard, and is removed only if it has not changed since migration. Their base is unknown, so differences from the saved meal require review. The browser never invents a base by pairing legacy input with a current revision. Failed requests preserve raw input; successful saves retire the draft. When storage fails, the dialog keeps the in-memory fields, shows a warning, warns before closing or unloading, and continues to use revision checks.

### Regression checks

`pnpm test apps/web/src/components/planner/meal-editor.test.ts` renders the real dialog and query/mutation hooks, with requests sent to the real planner router and isolated PostgreSQL. It covers two real editor instances in separate simulated tab storage sessions, another tab changing a meal, closing and remounting an older draft, independent edits in both eating-out and recipe meals, legacy recovery, conflicting meal types, deletion/recreation, failed requests, changes during review and two consecutive server conflicts. The browser/transport boundary is adapted in tests; the component, draft storage, merge, request construction, router and database writes are real.

`pnpm test packages/db/src/upgrades/edit-loss.test.ts` applies the additive manual-request SQL twice to a connection-local legacy recipe table and checks that existing content is unchanged and the original fingerprint stays unknown. All database tests must use the wrapper, which provisions and removes its own PostgreSQL container.

Both audit regressions were also run against the original source at `792b312`. The changed manual retry incorrectly resolved, and the rendered legacy meal editor wrote its old description over the newer database value. Both regressions reject that behaviour with this change.

The recovery UI was inspected at desktop and 375 px widths using the real components and styles in a temporary local preview with synthetic transport data. That visual check does not claim deployed authentication or live multi-tab network verification. The integration tests exercise those editing sequences against isolated PostgreSQL.
