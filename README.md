# Prep Sheet

A recipe keeper with private personal collections and shared group collections. Paste a recipe, import a public recipe link, or describe a dish. The app saves a structured recipe and opens a printable PDF when you select it from your collection.

## Run locally

```sh
pnpm install
pnpm db:start
```

Copy `apps/web/.env.example` to `apps/web/.env` and fill in the credentials. Keep this file ignored.

- `DATABASE_URL`: local Docker PostgreSQL connection.
- `BETTER_AUTH_SECRET`: a random secret of at least 32 characters.
- `BETTER_AUTH_URL`: `http://localhost:3001`.
- `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`: from your Discord application.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: from a Google Cloud OAuth client of type Web application.
- `OPENAI_API_KEY`: an API key with available API credits.
- `OPENAI_MODEL`: defaults to `gpt-5.6-luna`.

Register `http://localhost:3001/api/auth/callback/discord` in the Discord Developer Portal under OAuth2 redirects. Use the same hostname for the app and callback.

For Google, configure the OAuth consent screen and create a Web application client in Google Cloud Console. Register `http://localhost:3001/api/auth/callback/google` as an authorized redirect URI. Add the equivalent HTTPS URI for your production domain. While the consent screen is in testing mode, add your test accounts; make the app available to your intended audience before public launch. Set both Google environment variables and restart the server. Only basic profile and email access is used.

Existing users should sign in with Discord and choose **Settings > Account > Link Google** to keep their recipes and groups. Linking requires a session created within the last ten minutes and matching email addresses. Users with older sessions must sign out and sign in again. Matching emails never silently merge accounts. An identity already attached to another Prep Sheet account cannot be linked or merged through this flow. Email/password sign-in is not enabled.

```sh
pnpm db:push
pnpm dev
```

Open http://localhost:3001. This MVP uses Drizzle push; no migrations are generated yet.

Recipe collections and pickers use bounded summary pages with server-side search and sorting. Apply `packages/db/src/upgrades/recipe-list.sql` before running this version, including on new databases. See [recipe collection pages](docs/recipe-collections.md) for setup, ordering and measurement details.

Recipe edits require a revision token. Before deploying this update to an existing database, apply `packages/db/src/upgrades/recipe-revisions.sql`. The local database was upgraded during implementation. Saves atomically check and increment the revision. Drafts retain the original fields and revision in tab storage, including after refresh. Saving combines changes to separate fields automatically. Only fields changed differently in both versions require a Mine or Saved choice, followed by one Save recipe action. Ingredients and method are compared as whole sections. Older drafts without an original snapshot require choices for differing fields. Users can view the saved recipe without losing their draft, or save their draft as a personal copy. Every save still checks the revision, including after review. Full version history is not stored.

Recipe favourites and 1–5 star ratings are personal to each user, including in shared collections. Use favourites as a shortlist, sort by highest rated, or filter for recipes you have not rated yet. Run `pnpm db:push` for existing databases to add the `recipe_favourite` and `recipe_rating` tables before running the updated app. Apply the schema separately in other environments.

## Implementation

- TanStack Start, React, tRPC and TanStack Query.
- Better Auth with Google and Discord. Recipe operations and PDF downloads check personal ownership or current group membership on the server.
- PostgreSQL JSONB stores the recipe, with separate creator/group/title/source/timestamp columns. Zod validates generation and edits.
- Vercel AI SDK and OpenAI structured output. One submission creates one recipe, without a chat transcript. Missing credentials, inaccessible pages and provider failures leave the input available to retry.
- Link imports fetch HTML, prefer Recipe JSON-LD, then fall back to article text. Private network addresses and unsafe redirects are rejected. Requests are bounded by time and response size. No browser automation or paywall support.
- React PDF Renderer generates A4 PDFs on demand. React PDF/PDF.js previews them with a locally bundled worker. No PDF files are stored in the database or object storage.
- Small feature components and shared loading/error wrappers. Styles are grouped by screen, with Nunito fonts served locally. The preset's shared UI primitives remain available for future controls.

The collection supports title search, editing and deletion. Saves use a request ID to avoid duplicate records on retries. There is a simple limit of 50 saved recipes per account in a rolling 24-hour window; this is an MVP limit, not full abuse protection.

## Personal and group collections

Choose **Manage groups** beside the collection picker to create a group for friends, family or flatmates. An account can belong to multiple groups. Use the picker on Collections to browse a collection, or **Save to** on the home page to choose where a new recipe goes. Opening a recipe also lets you copy it to another collection you can access. Copies can be edited independently.

- Existing recipes stay in their owners' personal collections. Creating or joining a group never shares them automatically.
- All group members can read, add, edit, delete and print group recipes.
- The owner can rename the group, create or revoke invitation links and remove members. Other members can leave. Under **Ownership and deletion**, the owner can transfer ownership to another member before leaving, or permanently delete the group by entering its name. Deleting a group removes its shared recipes; personal recipes and independent copies remain.
- Send invitation links yourself. There is no email delivery service. A link admits one signed-in account, expires after seven days and can be revoked before use. Anyone holding an unused link can accept it, so share it privately. Existing members opening a link do not consume it.
- The invitation token is random, stored as a SHA-256 hash and placed in the URL fragment. The join screen preserves it through Discord sign-in and asks the recipient to explicitly join.
- Leaving or being removed ends server access, including PDF downloads. Contributions stay in the group. Deleting a contributor's account also preserves shared recipes. The database prevents deleting a group owner's account while they own a group.

For an existing local database, run `pnpm db:push` before starting the updated app. This adds `group`, `group_member`, `group_invite`, and nullable `recipe.group_id` tables/columns and changes the creator reference to allow deleted contributors. No recipe backfill is needed: a null group ID denotes a personal collection. The local database was upgraded during implementation. Apply the schema separately to other environments using your deployment process.

## Tags and account settings

Open the profile menu for Settings or Sign out. Settings has a Tags page where each user can create up to 100 custom tags with optional descriptions. Five built-in tags are available to everyone: High protein, Under 30 minutes, Under an hour, Vegetarian and Freezer friendly.

Recipe creation passes the user's available tags to the AI and saves only recognised tag IDs. Existing recipes are not retagged automatically. Tags are personal, including on shared recipes, and copies preserve the copying user's tags. Deleting a custom tag removes its recipe assignments.

Collections has an expandable Filters panel. Selected tags must all match and combine with search and favourites. Recipe details keeps tags, favourites and copying under Organise; Edit and Delete are in the recipe actions menu.

Run `pnpm db:push` to add `tag` and `recipe_tag` before running this version against an existing database. The local schema has been updated; other environments need the same schema update. Built-in tags initialise on first use through one shared promise per process. Their fixed IDs make initialisation idempotent across processes, and a failed initialisation can be retried.

Custom tag creation, renaming and deletion use a transaction under the account lock. The 100-tag limit counts custom tags only. Names are checked against the account's custom tags and global tags using PostgreSQL's case folding, with the same conflict message for creates and renames. Existing accounts above the limit keep their tags but cannot create more until their count falls below 100.

## Checks

```sh
pnpm test
pnpm check-types
pnpm build
pnpm check
```

`pnpm test` starts one fresh PostgreSQL 18 container for the whole Vitest run. It assigns a free loopback port, creates a separate Docker volume, pushes the current Drizzle schema, and passes the test `DATABASE_URL` to every Vitest worker. The wrapper removes the container and volume after success or failure. Docker Desktop must be running. The development container and its data are not part of this Compose project.

Use `pnpm test path/to/file.test.ts` to run selected files with the same lifecycle. Run tests through this command rather than invoking Vitest directly; Vitest rejects runs without the wrapper's isolated database marker. Ordinary integration tests use a local placeholder OpenAI key because generation is mocked. `pnpm test:live` uses a real key from `apps/web/.env` or the process environment when `LIVE_AI_TEST=1`.

`pnpm test:production` builds the website, then executes its server entry in a plain Node subprocess against the disposable test database. It checks public and authenticated routes, PDF access isolation, repeated short/long PDF rendering with embedded fonts, and server health after rendering. It also runs as part of `pnpm test`. See [PDF production packaging](docs/pdf-production.md) for runtime dependency requirements.

Integration tests create unique test users, exercise real database operations and remove those users afterwards. PDF fixtures are written under ignored `tmp/pdfs` for visual inspection. If the process is forcibly killed before cleanup, remove the orphaned `prep-sheet-test-*` Compose project and its volume after checking its name with `docker ps -a`.

Group integration coverage includes private/group isolation, shared editing, unauthorised imports and copies, owner permissions, removal and leaving, expired/revoked invites, concurrent invite acceptance, membership changes during recipe generation and preserving contributions after account deletion.

If the build or Vitest reports missing files inside `node_modules`, repair the installed dependencies without changing their locked versions:

```sh
pnpm install --frozen-lockfile --force --no-optimistic-repeat-install
```

The workspace uses the ignored `.pnpm-store/repair` cache. This replaced a damaged cache that restored incomplete packages even during a forced reinstall. If a repair still restores missing files, use a new empty directory with `--store-dir` and update `storeDir` in `pnpm-workspace.yaml` to match. The `--no-optimistic-repeat-install` flag prevents pnpm from skipping the repair as already up to date.

To opt into live OpenAI generation/extraction checks in PowerShell:

```powershell
$env:LIVE_AI_TEST = '1'
pnpm test:live
Remove-Item Env:LIVE_AI_TEST
```

Live checks use API credits. The regular test suite never makes paid AI requests.

## Before deployment

Use a Supabase PostgreSQL connection, check the PostgreSQL version and pooling settings, and create the initial migration. Add the deployed Discord callback URL and update `BETTER_AUTH_URL`. Review sign-up and generation limits before making the app publicly reachable. Local Docker data does not automatically sync to Supabase.

Local development automatically retires service workers left by other projects on the same origin, including the old Korex worker on port 3001. The dev server serves a replacement when the browser updates that worker; it unregisters itself, clears Workbox caches and reloads its controlled tabs. Prep Sheet also removes leftover registrations when its development page loads. Cookies, local storage and session storage are preserved. HTML responses use `Cache-Control: no-store`, and Vite fails if port 3001 is occupied instead of silently switching ports. These recovery handlers are development-only. Restart the dev server after upgrading, then open `http://localhost:3001/` normally; a stale tab may reload once as its worker updates.

## Durable imports and AI allowance

`pnpm dev` and `pnpm dev:web` start the import worker alongside the website. The worker watches its source and restarts after changes. For a separately hosted website, run `pnpm worker:imports` alongside it. Website creation and extension imports both enqueue jobs; HTTP requests never generate recipes. Supervise the worker in production and restart it on failure. Deploy the website and worker together. Stop old workers before upgrading.

The worker writes JSON diagnostics to its terminal. `import_worker_started` confirms startup; a heartbeat every 30 seconds reports queued/active counts and the oldest queue wait. Each import logs its reference ID, queue wait, stage starts and durations, page response hosts/statuses/redirect counts, and its saved or failed outcome. Failure diagnostics include only error type, safe error code and HTTP status, never exception messages, recipe text, full URLs, credentials or account IDs. Use the import reference shown below the composer or on Recent imports to find its events. A request stuck at `queued` has not reached the page fetch or AI provider. Check for a worker startup/heartbeat first.

To retain diagnostics locally in PowerShell when running a separate worker, use `pnpm worker:imports | Tee-Object -FilePath import-worker.log`. Log files are ignored by Git.

For an existing database, apply `packages/db/src/upgrades/reliable-imports.sql` before deploying. It only adds columns and makes the source URL nullable. New databases can use the normal `pnpm db:push` setup.

Server settings, shared by every web and worker instance:

- `AI_DAILY_ATTEMPTS=50`: reserved or spent attempts per account in a rolling 24-hour window. Manual saves do not spend AI allowance. Deleting a recipe does not refund an attempt.
- `AI_PENDING_PER_ACCOUNT=5`: maximum queued, fetching, generating or saving jobs per account. New admissions also have a five-per-minute limit.
- `AI_CONCURRENT_ATTEMPTS=2`: maximum claimed fetching/generation jobs across worker processes. A worker runs one job at a time; run multiple supervised workers to use multiple slots.

The website stores each request ID, input and destination in an account-scoped queue in session storage before submission. The composer clears immediately for another recipe; every request has its own card showing the submitted input, destination and progress. View input opens the full text and import reference. Refreshing or returning within the same tab recovers all cards, including lost submission responses, without changing their request IDs. An older single-request record migrates into the queue. Closing the tab can remove these browser recovery records, but server jobs continue and remain visible in Recent imports. Dismissing a saved card keeps its recipe. Failed or rejected requests can be returned to an empty composer for editing; uncertain requests are tombstoned before their IDs are forgotten.

Reservations are created atomically with admission. Failures before generation release the reservation. Once generation starts, failures and uncertain outcomes remain spent. SDK retries are disabled. Successful AI output is checkpointed before saving, so save retries do not call AI again. Claims abandoned before generation can be recovered after three minutes; interrupted generation becomes terminal instead of running twice. AI calls have a 90-second timeout, and claim tokens prevent an obsolete fetch worker from overwriting a newer claim.

Keep job records for usage accounting and request deduplication. Do not purge saved or failed jobs when deleting recipes. Existing extension jobs remain compatible; historical website attempts made before this upgrade have no job record.

Vitest runs files sequentially because the integration suites share the isolated PostgreSQL import queue. Development workers can continue using the development database during tests.
