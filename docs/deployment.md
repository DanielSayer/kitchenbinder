# Portable Node release and database runbook

This release supports Node 26.7.0, pnpm 11.21.0 and PostgreSQL 18 built with ICU.
It runs the website and import worker as separate supervised processes from the
same immutable release. No hosting provider is required to build or test it.
Production credentials and a deployment destination remain operator decisions.

## Build and package

From a clean checkout of the selected commit:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check-types
pnpm test
pnpm build:release
docker build -t prep-sheet:RELEASE_COMMIT .
```

Use an immutable image digest in `PREP_SHEET_IMAGE`. Record the commit, image
digest, previous image and database backup identifier in the deployment record.
The Dockerfile installs the locked workspace, builds the web SSR and client
artifacts, excludes local environment files and runs as the unprivileged Node
user. Both process types use the same image. The runtime retains the full
workspace installation, including `tsx`, because the worker loads the TypeScript
source with that loader. This is a deliberate packaging contract, not a
production-only dependency install. Do not prune it with `--prod`.

Without Docker, retain the checkout, its complete locked `node_modules` trees,
workspace symlinks, `apps/web/dist`, migration SQL and startup scripts together.
Install for the destination platform. Copying a Windows dependency tree to Linux
is unsupported. Copying only the web `dist` folder also omits the external PDF
renderer and its transitive dependencies. Fonts and logo remain embedded in the
server PDF chunk. See [PDF packaging](pdf-production.md).

The release commands run directly outside Turbo and read injected process
environment. No local `.env` file is required. The development
`pnpm worker:imports` command loads `apps/web/.env` only if it exists.
Turbo also forwards the declared server variables for development and builds.
Never provide real secrets to image builds or commit them to source.

## Configuration and database connections

The web and worker require `NODE_ENV=production`, `DATABASE_URL`,
`BETTER_AUTH_SECRET` with at least 32 characters and `BETTER_AUTH_URL` set to
the public origin, normally HTTPS. Startup refuses skipped validation, missing
migration history, a different migration history or incompatible recipe collation.
It does not mutate the database.

Production also requires `SUPPORT_EMAIL` and `SUPPORT_OPERATOR`. Select a monitored
mailbox and a responsible queue owner, then complete the manual acceptance in
[account and support operations](account-support.md#launch-configuration-and-acceptance).

Inject Google/Discord credential pairs for the selected sign-in providers,
`OPENAI_API_KEY` and optional `OPENAI_MODEL` for imports, and Polar settings
only when enabling billing. `EXTENSION_IDS` must match released extensions.
`deploy/compose.yml` forwards these values explicitly. Its defaults leave paid
services disabled. The present login UI still needs the configured providers.

Configure encrypted PostgreSQL transport using the provider's trusted certificate
and node-postgres connection options. Do not disable certificate verification.
The tested configuration uses direct PostgreSQL connections. Migrations require
a direct connection with ownership of application tables and permission to
create/drop a temporary verification schema. Use a separate migration credential,
then restore the runtime credential in `DATABASE_URL`.

The runtime role needs application table DML and read access to
`public.prep_sheet_migration` and PostgreSQL catalogues. It does not need DDL.
Use a dedicated application database with the `public` schema; adoption rejects
extra or incompatible application tables rather than guessing their purpose.
The migration role must be able to create the ICU collation.

Each application pool defaults to at most 10 connections, a 10-second connection
timeout and a 30-second idle timeout. Set `DATABASE_POOL_MAX`,
`DATABASE_CONNECT_TIMEOUT_MS` and `DATABASE_IDLE_TIMEOUT_MS` to suit the host.
The web owns an API pool and a separate auth pool. The worker owns its API pool.
Budget at least `2 × web replicas × pool max + worker replicas × pool max`,
plus migration, monitoring and operator connections. Pools open connections lazily.
Allow room for old and new processes during deployment. Transaction locks are
used for admission and queue claiming. Statement pooling is unsupported.
Transaction/session pooling has not been exercised; verify its transaction,
TLS and shutdown behaviour before substituting a pooler.

## Initial provisioning

Create an empty, dedicated PostgreSQL 18 database with UTF-8 encoding and ICU
support using the database provider's normal provisioning process. With its
direct migration credential injected:

```sh
pnpm db:migrate
pnpm db:verify
```

For the container, use the same image that will run the application:

```sh
docker run --rm -e DATABASE_URL "$PREP_SHEET_IMAGE" node packages/db/scripts/migrate.mjs
docker run --rm -e DATABASE_URL "$PREP_SHEET_IMAGE" node packages/db/scripts/migrate.mjs --verify
```

The runner applies numbered SQL files in one transaction, uses an advisory lock
to serialise concurrent runners, sets a 10-second lock timeout and a 60-second
statement timeout, and records SHA-256 hashes in `prep_sheet_migration`.
Hashes normalise Git's LF/CRLF line endings. Repeat runs verify history and schema.
Failed migrations roll back the transaction, including ledger changes.
Long migrations need a separately reviewed timeout/transaction strategy.

`0000_production_baseline.sql` represents shared base commit
`792b312b7091cd6b55ecfec1ff9feb13b86e2aa3`.
`0001_recipe_name.sql` installs the required nondeterministic ICU collation.
`0002_import_save_retries.sql` adds checkpoint retry attempts, eligibility,
leases and their index. `0003_manual_request_identity.sql` adds the nullable
immutable manual submission hash. Existing recipe hashes remain unknown;
recovery refuses to infer an original submission from mutable recipe content.
Verification checks its provider, locale, stored/actual ICU version and numeric,
case and accent comparison. PostgreSQL normalises the equivalent locale string.
This release deliberately rejects PostgreSQL majors other than 18 until their
catalogue checks and application suite have been exercised.

## Adopt an existing installation

Schedule a maintenance window. Stop admissions by taking web traffic offline and
drain/stop all workers. Take a consistent database backup and restore it into an
isolated PostgreSQL 18 instance. Verify restoration before running adoption on
the original database. Keep this backup until the release has been accepted.

With PostgreSQL 18 client tools and the intended URLs injected, the rehearsal is:

```sh
pg_dump --dbname "$DATABASE_URL" --format=custom --file pre-release.dump
createdb --maintenance-db "$RESTORE_ADMIN_URL" prep_sheet_restore
pg_restore --dbname "$RESTORE_DATABASE_URL" --exit-on-error --no-owner --no-acl pre-release.dump
```

`RESTORE_ADMIN_URL` and `RESTORE_DATABASE_URL` must address the isolated restore
server, with the latter pointing at the new `prep_sheet_restore` database.
Set `DATABASE_URL` to that restored database before adoption.

Against the restored copy first:

```sh
pnpm db:adopt
pnpm db:verify
```

Ordinary `db:migrate` refuses unversioned databases containing tables.
Explicit adoption runs only the recorded recipe-revision, reliable-import,
billing, recipe-list, import-save-retry and manual-request-identity upgrades,
then compares all columns, SQL types,
nullability, defaults, constraints and indexes with a fresh schema made from the
versioned history. Equivalent historical constraint/index names are accepted and
renamed to their versioned names after validation, so later generated migrations
can address them.
Only a compatible result is recorded as current. A mismatch rolls back all
adoption changes. Review the reported differences; never manually insert ledger
rows to bypass the check. Schemas older than these recorded upgrades may need a
separate reviewed forward repair, especially missing group/planner/shopping tables.

After restoring and accepting the rehearsal, repeat with the production migration
credential during the maintenance window. Compare row counts and selected records
for users, recipes, billing, import checkpoints, groups, planner and shopping data.
This repository's disposable regression preserves representative recipe, user,
billing, AI-spend, checkpoint, planner and shopping records through adoption and
repeat runs. It is evidence for the supported legacy shape, not evidence for an
unknown production database or a completed production backup recovery exercise.

## Start, supervise and verify

After migration verification, inject runtime credentials and start both processes:

```sh
pnpm start
pnpm start:worker
```

Or use the provided supervision configuration:

```sh
docker compose -f deploy/compose.yml up -d
docker compose -f deploy/compose.yml logs --tail=50 web worker
```

The Node listener serves SSR/API routes and built files from `dist/client`.
Hashed assets receive immutable caching; public branding files revalidate.
PDF responses retain private/no-store headers. Put a TLS reverse proxy before
the loopback Compose web binding. Configure request limits, timeouts and private
response caching at the chosen proxy. The listener uses the configured public
origin and does not trust incoming Host/forwarded headers for SSR/auth URLs.
It preserves the actual Origin header for auth checks.

Web startup emits `web_started`; the worker emits `import_worker_started` and
30-second queue heartbeats. Supervise both with restart policies. HTTP handlers
only admit durable jobs: a running website alone does not process imports.
Check the homepage, one static asset, authenticated recipe API and PDF, anonymous
rejection, and subsequent health. Verify real OAuth and one real import separately
when authorised. The health API remains a liveness check, not a worker or database
readiness/alerting system. Host alert delivery and backup recovery remain launch
gates.

On SIGTERM/SIGINT the listener stops accepting connections and drains requests,
then exits, closing its idle internal pools. Its default 30-second deadline exits
with failure if requests cannot drain. The worker stops taking new jobs, interrupts
idle waits, finishes the active attempt, closes its pool and exits. Its default
180-second deadline exits with failure if the attempt cannot drain. Set supervisor
grace periods longer than those deadlines; Compose uses 40 and 200 seconds.
Windows supervisors/tests can send the same shutdown request over Node IPC.

Forced interruption leaves durable queue state. Workers recover stale
fetching claims after three minutes and fails interrupted AI processing without
replaying the paid call. Ready checkpoints can be saved without generation.
Abandoned save leases recover after three minutes and count towards the five
save attempts. Failures back off without reserving spend or calling AI again.
Monitor these outcomes; shutdown does not promise success for interrupted AI.

## Deployment order and rollback

1. Record the backup, current image and candidate image. Rehearse migration and
   acceptance against a restored copy. Verify web/worker payload contracts.
2. Drain old web and worker processes before migration. Apply/verify migration
   once with the candidate image and direct migration credential.
3. Start the candidate worker and web from that same image/history. Run acceptance
   checks before restoring traffic. Watch queue age and failure events.
4. Keep the previous release and backup available until acceptance completes.

The default procedure uses maintenance downtime. Mixed releases are unsupported
unless each change has an explicit compatibility review. Both process types
require the exact local migration ledger, so an old image refuses a newer
database rather than consuming an incompatible queue payload.

Application rollback and schema rollback are different operations. If migration
history is unchanged, stop/drain both services, select the previous image and
restart both. If an additive migration has already committed, build a rollback
release that reverts application changes while retaining the current migration
files and compatible schema types. Verify it against the migrated database first.
Do not delete columns/tables or erase ledger rows to make an old image start.
Prefer a reviewed forward repair for migration defects.

For a compatible previous image with unchanged migration history:

```sh
docker compose -f deploy/compose.yml stop
export PREP_SHEET_IMAGE="$PREVIOUS_IMAGE"
docker compose -f deploy/compose.yml up -d --force-recreate
```

Restoring a backup replaces data and loses writes after the backup point. Treat it
as incident recovery with an agreed cut-off, stopped writers and a restore
rehearsal. This project provides no automatic destructive down migrations.
After ICU/PostgreSQL upgrades, investigate any collation-version mismatch,
rebuild dependent indexes as required, then refresh the collation version. A
version refresh alone does not repair index ordering.
See [PostgreSQL collation guidance](https://www.postgresql.org/docs/18/collation.html).

## Later schema changes and CI

The combined release includes the manual-save and import-retry migrations
after the unchanged baseline and collation migrations. Later schema changes
must become new, uniquely numbered migrations with the Drizzle snapshot/journal
updated by `pnpm db:generate`. Do not edit published migrations.
Include clean provisioning, existing-version
upgrade, data preservation and web/worker compatibility checks with each change.
Keep SQL unqualified or use Drizzle's quoted `"public".` references so the
transactional comparison can replay it in an isolated verification schema.
Data backfills and nontransactional operations need a reviewed runner extension;
the present schema replay is intended for additive DDL.

The combined image can adopt the supported unversioned installation directly
while writers are stopped. Adoption applies the recorded additive upgrades and
verifies the entire combined schema before recording history. Compatible
already-applied feature upgrades retain retry counters, leases and manual hashes;
incompatible defaults or column definitions roll back without recording history.
An installation already carrying the two published baseline migrations uses
ordinary `db:migrate` to apply migrations 0002 and 0003. Both paths preserve
existing recipes, checkpoints, planner records and billing data.

`pnpm test` still owns one disposable PostgreSQL container and removes it in
`finally`. It now provisions with versioned migrations instead of Drizzle push.
Migration tests create additional databases only inside that disposable server.
Never run database tests against the development database or invoke Vitest directly.

The full suite tests clean/legacy migration, repeatability and incompatible-schema
rejection, a fresh HTTP/static/API/PDF release, and worker shutdown during a
blocked checkpoint save followed by restart, with no AI or payment calls.
CI also builds the Linux image and reruns migration, listener/PDF and worker tests against
that image by injecting `PREP_SHEET_RELEASE_IMAGE` into the isolated wrapper.
The image tests use the wrapper's random host port through Linux host networking
or Docker Desktop's `host.docker.internal`;
they do not create a second shared database service.
See [Docker host networking](https://docs.docker.com/engine/network/drivers/host/)
for the Linux network behaviour used by these tests.

## Local verification on 14 October 2026

Verification used Windows, Node 26.7.0, pnpm 11.21.0 and Docker 27.4.0:

- Locked installation passed with no lockfile change.
- `pnpm check` passed, checking 279 files without writes.
- `pnpm check-types` passed the root check and seven package tasks, all uncached.
- The full `pnpm test` suite passed 40 files and 297 tests; seven paid AI tests
  were skipped. Its disposable PostgreSQL container, volume and network were removed.
- The focused packaged-image run passed three files and six tests, including
  initial/legacy migration, rejection without stamping or collation repair,
  HTTP/static/authenticated API/PDF checks and SIGTERM worker drain/restart.
  It ran the unprivileged Linux/amd64 release image through Docker Desktop against
  another disposable PostgreSQL server. Its database and worker containers were removed.
- `pnpm build:release`, the Docker image build, Chrome/Edge development ZIP
  packaging, Compose configuration validation with placeholders, Actionlint
  1.7.12 and `git diff --check` passed. The existing large client-chunk warning remains.

Hosted GitHub CI and an actual deployment host were not verified in this local
run. No production database, paid AI or payment flow was used. Real sign-in,
provider imports, billing, host TLS/proxy behaviour, pooler compatibility,
backup restoration and operational alert delivery remain acceptance work.
