# Dependency maintenance, 8 November 2026

Started from `origin/master` at `c315ee4` on `chore/update-dependencies`.

## Updates

Updated the shared pnpm catalog and workspace manifests to the current stable
releases reported by `pnpm outdated -r`, except for Polar. This includes Better
Auth 1.7.18, TypeScript 7.0.2, dotenv 18.0.9, jsdom 31.0.0, Vitest 5.1.0, Biome
2.6.6, tRPC 11.25.0, Vite 8.3.6, Tailwind 4.3.5, TanStack packages, the AI SDK,
the S3 SDK and shared UI dependencies. The lockfile records the resolved versions.

Biome's migration renamed `useSortedClasses` to `useTailwindSortedClasses` and
moved class helper configuration into `tailwind`. Markdown and YAML formatting
remain disabled to preserve the previous formatting scope. The new class sorter
reports warnings in existing components; these do not fail `pnpm check`.

## Better Auth account migration

The production-server regression reproduced an authentication failure after the
package update. The existing schema requires `account.issuer`, which Better Auth
stopped writing in 1.7.3. Migration `0016_better_auth_account_identity.sql` makes
that column nullable while preserving historical values, and replaces the issuer
index with a unique index on `provider_id` and `account_id`. This follows the
[upstream account migration guidance](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/guides/1-7-upgrade-guide.mdx#account-identity-keeps-the-provider-key).

The new index rejects ambiguous legacy provider identities and the migration
runner rolls back the transaction on failure. Before deployment, check for
duplicates with `SELECT provider_id, account_id, count(*) FROM account GROUP BY
1, 2 HAVING count(*) > 1;`. Resolve any returned rows without combining different
users. Apply the migration through the normal release process before starting the
updated application. Existing migration files and hashes are unchanged.

Migration tests cover preserved account data, issuer-free inserts, the same
external account ID at different providers, duplicate rejection and transactional
rollback. A real PostgreSQL auth test covers registration and subsequent sign-in.
After new accounts have been created without issuers, reverting only the package
version to 1.7.1 is not a safe rollback. No live database was changed here.

## Security overrides

The initial audit reported 33 advisories: one critical, 13 high, 14 moderate and
five low. After the updates and overrides, the audit reports one low advisory.
No advisories are suppressed.

Three targeted overrides remove vulnerable versions still selected by upstream
dependency ranges:

- `@esbuild-kit/core-utils>esbuild` uses 0.28.2 or a compatible patch, removing
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
- `cheerio>undici` uses 7.30.2 or a compatible update, removing the audited
  Undici request and response handling vulnerabilities without crossing to v8.
- `@ts-morph/common>minimatch` uses 11.0.5 or a compatible update, removing
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).

Revisit these overrides when their parent packages update their dependency ranges.

## Remaining items

- `@polar-sh/sdk` stays on 0.49.0. Version 1.0.2 replaces the client and removes
  the `Polar`, `HTTPClient`, model and webhook imports used by the billing
  integration and its tests. Installing it caused the package type check to fail.
  Updating Polar requires a separate billing integration migration. It is the
  only remaining entry in `pnpm outdated -r`.
- `shadcn` and `@shadcn/registry` still depend on `deepmerge` 4.3.1. The registry
  has no newer release, and the [low-severity prototype poisoning advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
  lists no published fix. The dependency is retained and the audit remains nonzero.
- The pnpm version remains pinned to 11.21.0, matching the Dockerfile and CI.
  Migrating the package manager is separate from updating application packages.

## Verification

- `pnpm install --frozen-lockfile` passes without changing the lockfile.
- `pnpm check-types` passes the root compiler and all six package tasks without
  cached results.
- `pnpm check` passes with 54 warnings from the updated rules.
- Drizzle's schema export and the shadcn CLI version command pass with the
  updated transitive dependencies.
- The focused migration, PostgreSQL account and social auth suites pass all 23
  tests.
- The full `LIVE_AI_TEST=0 pnpm test` run passes 84 files and 696 tests, with one
  file and eight tests skipped. This includes a fresh local production build,
  authenticated HTTP/PDF regression and backup/restore recovery. The wrapper
  removes its disposable PostgreSQL container, volume and network afterward.
- `docker build -t kitchenbinder-dependencies:local .` passes, including the
  Linux production web build and frozen dependency installation.
- The CI packaged regression command passes all 22 tests across five files with
  `PREP_SHEET_RELEASE_IMAGE=kitchenbinder-dependencies:local`. It covers migrations,
  authenticated HTTP/PDF, worker shutdown/restart, proxy identity and Compose
  readiness against isolated PostgreSQL.
- `node scripts/validate-deployment.mjs` passes its isolated Compose, nginx,
  request-limit, overload and recovery checks.
