# Import save retries

An import can fail while saving a recipe after AI output has been checkpointed. Workers claim eligible checkpoints and queued imports in one ordered PostgreSQL transaction. Ordering uses the checkpoint's next eligible save time or the queued import's creation time, then creation time and ID to break ties. A delayed retry rejoins behind work that was already eligible. `FOR UPDATE SKIP LOCKED` skips work another transaction holds. The existing advisory lock still enforces the global fetching/generation limit; checkpoint saves do not consume an AI slot.

Each retry save claim persists a fresh worker token, claim time and incremented attempt count before the recipe transaction starts. Newly generated output checkpoints and claims its first save atomically using the generating worker's token. A saver locks the checkpoint and checks its token before writing. Recipe persistence and the saved state commit together. Failed recipe transactions roll back, leaving generated output intact.

There are five automatic save attempts, including the initial save. After failures one through four, the job stays `ready` and waits 5, 10, 20 and 40 seconds respectively. A fifth failure makes the job `failed`, reports the failure through existing import status/recent-import views and keeps its generated checkpoint for diagnosis. Re-submitting the same request ID returns its existing result. It never restarts generation. Starting a new import is an explicit new AI attempt and consumes another credit.

Before selecting work, every worker recovers interrupted generation and abandoned fetch claims. Save claims older than three minutes are released with the same backoff, or become terminal if their fifth claim was abandoned. Recovery skips rows locked by a live saver. Abandoned claims count towards the five-attempt budget. A paused saver whose claim has been released cannot write with its old token. Missing or malformed generated checkpoints fail explicitly on their first save, retaining any stored checkpoint. Save retries and terminal save failures do not refund credits or reserve AI spend again.

`import_save_retry` diagnostics retain the import reference and safe failure code, and add attempt number and delay. `import_failed` identifies exhaustion or invalid checkpoints. If recording retry state itself fails, `import_save_retry_failed` records the import reference and safe save/retry failure details, then the worker uses its existing error delay. The durable claim remains recoverable. Diagnostics contain no recipe content, exception messages, account IDs or full URLs.

## Deploying the additive schema upgrade

Stop all old import workers. For an existing database, apply `packages/db/src/upgrades/reliable-imports.sql` if needed, then `packages/db/src/upgrades/import-save-retries.sql`, before deploying the updated web app and workers. The new SQL adds `save_attempts`, `next_save_attempt_at`, `save_claimed_at` and an eligibility index. It can be applied repeatedly and preserves existing checkpoints. New installations using the current Drizzle schema already include these fields.

The production-startup change owns the shared baseline migration/history. Integrate these additions into that deployment sequence after its baseline is established. This branch does not generate or change migration history. The worker and web app must use a database containing the new fields before starting.

## Verification

`packages/api/src/import-save-retries.test.ts` uses the isolated PostgreSQL test wrapper. Database triggers inject real recipe-save and retry-state failures. The tests cover healthy ready/queued work beside a persistent failure, two-worker races, exact backoff boundaries, eventual success, five-attempt exhaustion, preserved credits/spend, request deduplication, abandoned claims, live locked saves, malformed checkpoints, the global generation limit and repeatable upgrades of legacy ready rows. Generation is replaced with local fixtures; no paid AI calls are needed.

Verified on 14 October 2026 from base commit `792b312b7091cd6b55ecfec1ff9feb13b86e2aa3`:

- Locked dependency installation passed.
- The original-source regression failed as expected: three save failures left both healthy jobs untouched.
- Focused import, website-import and diagnostic suites passed, 4 files and 36 tests.
- `pnpm check` passed, 271 files checked without writes.
- `pnpm check-types` passed the root and all 7 package tasks without cached results.
- `pnpm test` passed 39 files and 301 tests, with 7 paid-AI tests skipped. This includes the fresh production-server/PDF regression. The wrapper removed its PostgreSQL container and volume.
- `pnpm build` passed the web production build and Chrome development-extension build, with the existing client chunk-size warning.

Fresh-checkout checks needed two local preparation steps: normalise Windows checkout CRLF text to LF without a content diff, and run the build to generate the ignored TanStack route tree before the web type check. The base CI workflow checks types before generating that tree, so its fresh-checkout ordering needs the separate CI fix. No workflow or general startup changes are included here. Deployment, live AI and production database changes were not exercised.
