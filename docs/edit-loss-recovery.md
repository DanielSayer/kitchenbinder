# Recipe and meal draft recovery

## Manual recipes

Before sending a manual save, the browser stores its UUID, original destination and parsed content in session storage beside the raw form draft. Identical retries, including after a reload, reuse that submission. The server binds the UUID to a SHA-256 fingerprint of the validated content and destination. It stores that fingerprint once and retains it when the recipe is edited or moved.

If a response is lost, saving unchanged input recovers the recipe with the same ID. Changing the input or destination does not issue a fresh create or silently accept the older content. The form keeps the draft and offers **Recover earlier save**. This retries the original submission, which may create it if the first request never arrived. After recovery, **Review draft in saved recipe** transfers the raw draft into the existing recipe editor with the original submitted content and revision 1 as its base. That editor merges independent changes and reviews conflicting fields against the latest recipe. A pre-existing edit draft at the destination is never overwritten.

The original submission stays separate from Clear form and Cancel, since those actions cannot prove whether an uncertain request committed. The browser must retain a submission identity before the first network request. If storage is blocked or the identity cannot be read, saving stops with a visible explanation. Session storage recovery is scoped to that browser tab; clearing browser storage removes this protection.

### Additive schema integration

Apply `packages/db/src/upgrades/edit-loss-manual-request.sql` before deploying this change, or incorporate its nullable `recipe.manual_request_hash` column into the production-startup migration work. This task does not regenerate migration history or the shared baseline. Existing rows remain null. Retrying a legacy UUID without a stored original fingerprint returns an explicit conflict; current recipe content is never used to invent an original identity.

### Regression checks

`pnpm test apps/web/src/components/home/manual-recipe.test.ts packages/api/src/recipes/recipes.integration.test.ts` runs the real manual form, persistence and query/mutation hooks against the real API router and isolated PostgreSQL. It covers commit followed by lost response, reload recovery without duplicates, edits after uncertainty, recovery after another editor changes the recipe, transfer with the correct original base, a request that never arrived, blocked submission storage, concurrent different payloads and legacy UUID conflicts. Server tests also prove that retries remain bound to the original submission after later recipe edits.
