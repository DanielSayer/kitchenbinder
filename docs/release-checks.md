# Release checks

Run these from the repository root with Docker available:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check-types
pnpm test
pnpm --filter web build
pnpm package:extension
```

`pnpm check` runs Biome without changing files. `pnpm check:fix` is the separate, explicit fixing command. Biome respects Git ignores and excludes generated outputs and the throwaway `prototypes` directory. Application code, tests, scripts and root configuration remain checked.

## TypeScript coverage

The root command checks `vitest.config.ts`, then runs every applicable package's `check-types` task. Turbo caching is disabled for these tasks. API, auth and DB use source-only, non-emitting configurations without composite or incremental build state. Their shared strict settings remain enabled.

| Package | Compiler inputs |
| --- | --- |
| `web` | Application source, tests, development helpers and Vite configuration |
| `@prep-sheet/extension` | WXT configuration, build settings, application source and tests; `wxt prepare` generates browser types first |
| `@prep-sheet/api` | All source TS/TSX, asset declarations and tests, including the production-server regression |
| `@prep-sheet/auth` | All source and tests |
| `@prep-sheet/db` | All source and tests, plus `drizzle.config.ts` |
| `@prep-sheet/env` | Server and browser environment declarations |
| `@prep-sheet/ui` | All source TS/TSX and any tests under `src` |
| `@prep-sheet/config` | JSON-only package with shared compiler settings; consuming configurations validate it, so it has no TypeScript task |

Adding a TypeScript workspace requires its own `check-types` script and a configuration that includes its tests. A Turbo package-in-scope message alone does not prove that a package ran a compiler task. The current run must report seven successful package tasks, with zero cached tasks, after the root compiler succeeds. See [Turbo's TypeScript guidance](https://turborepo.dev/docs/guides/tools/typescript).

## CI behaviour

`.github/workflows/ci.yml` runs on pull requests, pushes and manual dispatch. Its `release-checks` job uses Ubuntu, Node 26.7.0 and the pnpm version pinned in `package.json`. Actions use commit pins. Installation requires the existing lockfile and cannot rewrite it. See [setup-node](https://github.com/actions/setup-node/blob/v7/README.md) and [pnpm/action-setup](https://github.com/pnpm/action-setup/tree/0977fd99725f1db4007ccb2928dbb4e90d06cc86).

The job runs the commands above in order and checks for tracked-file changes afterward. It supplies local placeholder auth/build settings without production secrets. The build database URL is only a configuration placeholder; builds do not provision or query it. `LIVE_AI_TEST=0` keeps paid AI tests disabled.

The full suite uses `scripts/test.mjs` through `pnpm test`. This wrapper starts one disposable PostgreSQL instance on a random port, applies the schema and recipe-list collation, and removes its container, volume and network in `finally`. Do not invoke Vitest directly or add a shared database service to bypass the wrapper.

The production-server regression runs in that suite. It creates a fresh production build and executes the built server handler in a separate Node process. It verifies authenticated APIs and PDFs, anonymous rejection, account isolation, embedded fonts, repeated PDF requests and subsequent health. It disables external OAuth, AI and payment services. See [PDF production packaging](pdf-production.md).

CI separately builds the web production artifact and packages development extensions for Chrome and Edge. Those ZIPs use the local development origin and identity. A store release still requires the real HTTPS origin, public key and matching website extension IDs, followed by installed-browser verification. Use `pnpm --filter @prep-sheet/extension package:production` with the release settings for that separate step.

Make the `release-checks` job required in repository branch protection before relying on it to prevent merges. This workflow performs validation; it does not deploy the website, migrate a production database or verify the eventual host.

## Verification on 13 October 2026

Local verification used Windows, Node 26.7.0, pnpm 11.21.0 and Docker 27.4.0:

- Frozen installation passed without lockfile changes.
- Biome checked 270 files without writes or diagnostics. The prior application check had 19 diagnostics; targeted formatting and the Discord SVG title resolved them.
- All seven package type checks and the root configuration passed without cached results. Compiler input inspection covered all 218 tracked TypeScript files, including all 38 test files.
- A temporary compiler error in an auth test made the root gate fail with TS2322. The probe was removed and the passing check repeated.
- The focused auth/shopping suites passed 12 tests. The full isolated suite passed 38 files and 292 tests, including the fresh-build authenticated server/PDF regression. Seven paid AI tests were skipped. Docker test resources were removed.
- The standalone web production build passed. The existing large client-chunk warning remains.
- Chrome and Edge development builds and ZIPs passed without cached package results.
- Actionlint 1.7.12 accepted the workflow. The hosted GitHub job has not run because these commits have not been pushed.

P08's compiler and repository-check gaps are resolved. Production host acceptance, store extension release and the other production-readiness audit findings remain separate launch work.
