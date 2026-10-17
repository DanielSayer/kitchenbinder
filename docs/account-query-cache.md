# Account query cache boundary

`AccountQueryBoundary` wraps the header, collection provider and route outlet in
`apps/web/src/routes/__root.tsx`. It follows the shared Better Auth session, so
account changes discovered through storage broadcasts or session refreshes use
the same boundary as this tab's sign-out action.

When the user ID changes, the boundary withholds its children, cancels and clears
the previous QueryClient, and creates a new client before mounting the next
account's content. Both React Query and tRPC use the new client. The router's
query context also receives the replacement client and tRPC options proxy.
Each transition gets a new client, including returning to an earlier account.
Late responses and callbacks holding a retired client cannot write into the
active account's cache.

Same-account session refreshes and route navigation keep the client and its
normal cache lifetime. The remount resets component state on identity changes.
It does not remove session storage, so existing account-scoped recipe, import
and planner drafts remain available to their owners.

The router's original request-scoped client still supports SSR hydration. The
boundary initially uses that client, then replaces it when the client session
identity changes. Current private routes disable SSR and do not fetch private
data in route loaders. Keep private consumers below this boundary; adding
server-rendered private queries would also require binding hydration to the
server's authenticated identity. API procedures continue to authenticate each
request.

## Regression coverage

`apps/web/src/components/account-query-boundary.test.ts` mounts the production
boundary with a real QueryClient, tRPC providers, router and SSR-query integration
wrapper. Only the session source and query responses are controlled. It records
every consumer render, rather than checking only the final screen.

The eight cases cover direct A-to-B and A-to-guest-to-B transitions with fresh
and stale planner, shopping, groups and recipe query keys; initial session
loading; same-account refresh and actual route navigation; a delayed A response
whose transport ignores abort; a callback writing to A's retired client; and
restoring account-scoped saved recipe drafts after remounting.

Run them through the isolated PostgreSQL wrapper:

```sh
pnpm test apps/web/src/components/account-query-boundary.test.ts apps/web/src/components/auth-gate.test.ts apps/web/src/utils/query-client.test.ts
```

## Historical verification on 11 October 2026

- Full `pnpm test`: 35 files passed, 278 tests passed, seven live AI tests skipped.
  The wrapper removed its PostgreSQL container, volume and network. No paid AI
  calls were made.
- After strengthening the router harness, the focused suite passed all 13 tests.
- Web TypeScript, production client/server build, scoped Biome checks and
  `git diff --check` passed.
- A temporary two-tab browser harness used the production boundary and real
  Better Auth client with synthetic local HTTP sessions and private responses.
  Signing out in one tab cleared the other through Better Auth's actual storage
  broadcast. Guest-to-B after a session refresh and direct identity broadcasts
  showed no previous-account data. B remained isolated after delayed A refetch
  responses completed. The render history recorded zero cross-account renders;
  A's saved browser draft returned when switching back. The temporary server and
  harness were removed after verification.
- Live Discord/Google sign-in, production cookies, and a native window-focus
  session refresh were not exercised. The browser harness's sign-in and identity
  switch endpoints were synthetic; the storage listener and session refresh
  client were real.
- The standalone API type check at that time reported the inline PNG module
  declaration error in `packages/api/src/recipes/pdf.tsx:14` and UUID fixture
  type error in `packages/api/src/shopping.integration.test.ts:213`. These are
  dated observations, not current failures. The current [release gate](release-checks.md)
  includes the API compiler; verify the selected commit through that gate.
