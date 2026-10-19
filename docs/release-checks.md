# Release checks

Run these from the repository root with Docker available:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter web build
pnpm check-types
pnpm test
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

`.github/workflows/ci.yml` runs on pull requests, pushes to `master` and manual dispatch. Feature-branch pushes are checked through their pull request, avoiding duplicate push and PR runs and failure notifications. A new PR update cancels the previous run for that PR. Different PRs, `master` pushes and manual runs remain independent. A branch without a PR can be checked with manual dispatch. See [GitHub's workflow trigger and concurrency rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

Its `release-checks` job uses Ubuntu, Node 26.7.0 and the pnpm version pinned in `package.json`. Actions use commit pins. Installation requires the existing lockfile and cannot rewrite it. See [setup-node](https://github.com/actions/setup-node/blob/v7/README.md) and [pnpm/action-setup](https://github.com/pnpm/action-setup/tree/0977fd99725f1db4007ccb2928dbb4e90d06cc86).

The job runs the commands above in order and checks for tracked-file changes afterward. The initial web build generates the ignored route tree before TypeScript checks run. It supplies local placeholder auth/build settings without production secrets. The build database URL is only a configuration placeholder; builds do not provision or query it. `LIVE_AI_TEST=0` keeps paid AI tests disabled.

The full suite uses `scripts/test.mjs` through `pnpm test`. This wrapper starts one disposable PostgreSQL instance on a random port, applies the versioned migrations including the recipe-list collation, and removes its container, volume and network in `finally`. Do not invoke Vitest directly or add a shared database service to bypass the wrapper.

The production-server regression runs in that suite. It creates a fresh production
build and starts the Node HTTP listener in a separate process. It verifies static
assets, authenticated APIs and PDFs, anonymous rejection, account isolation,
embedded fonts, repeated PDF requests, streamed auth requests and shutdown.
The worker release regression drains an active checkpoint save and resumes
pending work after restart without AI. Migration tests cover provisioning,
legacy adoption, data preservation and schema-drift rejection.
CI builds the Docker release and reruns migration, HTTP/PDF and worker tests against it using
the same isolated test wrapper. It disables external OAuth, AI and payment
services. See [deployment](deployment.md) and [PDF packaging](pdf-production.md).

CI separately builds the web production artifact and packages development extensions for Chrome and Edge. Those ZIPs use the local development origin and identity. A store release still requires the real HTTPS origin, public key and matching website extension IDs, followed by installed-browser verification. Use `pnpm --filter @prep-sheet/extension package:production` with the release settings for that separate step.

Make the `release-checks` job required in repository branch protection before relying on it to prevent merges. Trusted `master` runs publish the exact tested Docker image to GitHub Container Registry after all checks pass. Pull requests never publish. The image carries its full commit revision and is consumed by digest.

After a successful `master` push build, a separate `deploy` job in the same workflow deploys that exact image digest to production. Pull requests and ordinary manual check runs do not deploy. The separate **Deploy production** manual workflow calls this same pipeline with deployment explicitly enabled, including its optional dry run. Superseded commits are skipped before deployment access is requested. See [GitHub deployment](github-deployment.md) for concurrency, migration and recovery behaviour. Passing build checks alone does not prove that deployment or production health succeeded; inspect the deployment job too.

## Historical verification on 13 October 2026

Local verification used Windows, Node 26.7.0, pnpm 11.21.0 and Docker 27.4.0:

- Frozen installation passed without lockfile changes.
- Biome checked 270 files without writes or diagnostics. The prior application check had 19 diagnostics; targeted formatting and the Discord SVG title resolved them.
- All seven package type checks and the root configuration passed without cached results. Compiler input inspection covered all 218 tracked TypeScript files, including all 38 test files.
- A temporary compiler error in an auth test made the root gate fail with TS2322. The probe was removed and the passing check repeated.
- The focused auth/shopping suites passed 12 tests. The full isolated suite passed 38 files and 292 tests, including the fresh-build authenticated server/PDF regression. Seven paid AI tests were skipped. Docker test resources were removed.
- The standalone web production build passed. The existing large client-chunk warning remains.
- Chrome and Edge development builds and ZIPs passed without cached package results.
- Actionlint 1.7.12 accepted the workflow. At that point the hosted GitHub job had not run because those commits had not been pushed. This dated record does not describe the current candidate's hosted status; inspect the exact commit's release-checks run.

P08's compiler and repository-check gaps are resolved. Production host acceptance, store extension release and the other production-readiness audit findings remain separate launch work.
