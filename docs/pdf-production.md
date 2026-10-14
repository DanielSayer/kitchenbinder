# PDF production packaging

The web SSR build keeps `@react-pdf/renderer` and its transitive dependencies external. The web app declares the renderer as a runtime dependency, so a production installation must retain it and its dependency tree alongside the server artifact. Copying only `dist` into an otherwise empty Node environment is insufficient.

PDFKit uses private package imports for its standard fonts. Bundling its runtime `createRequire` calls into another package changes their resolution context and can crash the process with `Cannot find module '#standard-fonts/Helvetica'`. The explicit SSR external avoids that relocation. See [Vite SSR external dependencies](https://vite.dev/config/ssr-options).

The API PDF module imports regular and bold Nunito fonts with `?inline`. Vite embeds their data URLs in the server's PDF chunk, alongside the logo, so rendering requires no font lookup in the source tree or HTTP font request. React PDF reads those data URLs directly. The PDF route loads this module after session validation and recipe access checks. Public pages and rejected requests do not initialise the renderer.

Run from the repository root:

```sh
pnpm test:production
```

The normal test wrapper creates and removes a disposable PostgreSQL database. The regression test seeds temporary users, a signed test session, short and long recipes, and an inaccessible recipe owned by another user. It makes a fresh Vite production build, then starts the production Node HTTP listener without Vite or tsx transforms. The child checks:

- The homepage, built static assets and health route respond successfully.
- Private API and PDF requests without a session return 401.
- A signed session can read its own recipe through the built API.
- Invalid recipe IDs and another account's PDF return 404.
- Short, long and repeated PDF requests return PDFs with embedded fonts and private no-store headers.
- The health route still responds after PDF rendering, streamed sign-out forwards auth cookies, and the listener drains on shutdown without delayed font errors.

External OAuth, AI and payment services are disabled for this check. It runs in the full `pnpm test` suite as well. A successful build or a source-level PDF render alone does not establish that the built server can resolve its runtime dependencies.

This test verifies the Node listener, static files and HTTP request handlers.
The Linux release image runs the same checks in CI. See the
[deployment runbook](deployment.md) for packaging, separate worker supervision,
migration/adoption, environment injection and rollback. Verify the chosen host's
TLS/proxy settings and real provider flows before launch.

Verification on 12 October 2026 used Node 26.7.0 on Windows. The full isolated suite passed 38 files and 292 tests, with seven live AI tests skipped. The web type check and focused Biome checks passed. Vite preview served the homepage and health route, rejected anonymous API/PDF requests and remained responsive afterward. The API asset declaration error was resolved; the standalone API check still reported the UUID fixture error in `shopping.integration.test.ts:213` at that point.

On 13 October 2026 the UUID fixture and remaining API/auth compiler errors were resolved. All package type checks now run in the root gate and CI. The full suite passed again, including this production-server regression. See [release checks](release-checks.md) for coverage and verification.
