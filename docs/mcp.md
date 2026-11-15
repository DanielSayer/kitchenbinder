# AI assistant connections

Kitchenbinder Pro users can connect an assistant at `/api/mcp`. The public `/mcp` page has the connection link and instructions. The assistant supplies recipe generation. Kitchenbinder saves recipes through `recipes.createManual`, parses ingredient text with the existing units pipeline and spends no recipe-import AI credits.

## Architecture

- `packages/mcp` defines the eleven tools, creates one SDK server per request, resolves bearer tokens to a real user/session and invokes `appRouter.createCaller(context)`.
- `apps/web/src/routes/api/mcp.ts` serves GET, POST and DELETE through `@modelcontextprotocol/server` 2.4.0 `createMcpHandler`. Legacy support stays enabled as `legacy: "stateless"`. Legacy GET/DELETE session operations return 405 because the server has no persistent MCP sessions. Modern and legacy Streamable HTTP tool calls are supported.
- `packages/auth/src/oauth.ts` configures Better Auth's jwt plugin and `@better-auth/oauth-provider` 1.7.18. Dynamic registration, PKCE, user consent and refresh tokens use the provider. Login reuses Google/Discord on `/login`; the client plugin preserves the provider-signed authorisation query through social sign-in.
- The provider issues tokens for the configured `BETTER_AUTH_URL` origin plus `/api/mcp`. Every HTTP request verifies the signature, issuer, expiry, client, real login session, audience, `kitchenbinder` scope and live consent. A signed access-token claim binds the token to its exact consent ID, so reconnecting cannot revive a revoked JWT. Cookies alone cannot authenticate an MCP request. DPoP-bound tokens are rejected, since this endpoint accepts bearer tokens only.
- Every tool invocation reads `billing_account` and applies the same `allowance()` policy used by billing status. Free and lapsed accounts can authorise a connection but receive a tool error with `/pricing`. Trial users have Pro entitlement while their trial is valid.
- Existing household permissions, recipe capacity, parsing, validation and planner revision checks remain in tRPC. Omitted household IDs mean the personal household. The app's current household is stored in the browser and is not inferred by a remote client. Recipe search covers all accessible recipes.
- Both HTTP admission and tool work use `AccountRequestLimit(120)` per user per minute. A shopping batch costs one tool-work unit per line. Limits are per process, as with tRPC; aggregate limits belong at the edge. MCP bodies have the same bounded 1.5 MiB budget as tRPC.

Discovery is available at `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` and `/.well-known/openid-configuration`. The issuer-path variants `/.well-known/oauth-authorization-server/api/auth`, `/api/auth/.well-known/openid-configuration` and resource-path variant `/.well-known/oauth-protected-resource/api/mcp` support standards-based discovery. Unauthenticated requests return 401 with a `WWW-Authenticate` metadata pointer.

Migration `0017_oauth_provider.sql` adds the provider tables and JWT signing keys. Apply it using the normal release migration command before serving the new code. No secret environment variables were added. Keep `BETTER_AUTH_URL` equal to the externally reachable origin, including HTTPS in production. Signing keys are persisted and private keys use Better Auth's existing secret protection.

Browser Origin checks allow the configured app origin, `https://claude.ai` and `https://chatgpt.com`. Development also allows Inspector's localhost port 6274. For another browser-based client, set `MCP_ALLOWED_ORIGINS` to a comma-separated list of exact additional origins without trailing slashes. Its safe default is empty. Server-to-server clients normally omit Origin. Cookie-authenticated consent/disconnect calls retain Better Auth's CSRF checks.

## Tools

Read tools: `get_account_overview`, `search_recipes`, `get_recipe`, `get_meal_plan`, `get_shopping_list`.

Write tools: `add_shopping_items`, `check_off_shopping_item`, `create_recipe`, `plan_meal`, `remove_planned_meal`, `add_recipe_to_shopping_list`.

Results contain concise text plus JSON in `structuredContent.data`. Tools have Zod inputs and read-only, destructive and idempotency annotations. Server instructions use Australian metric measures and request confirmation before destructive changes. Clients remain responsible for obtaining user approval. No recipe deletion or household administration tools are exposed.

Recipe creation accepts original ingredient lines, never model-supplied unit objects. Optional source URLs are retained in recipe notes because `createManual` deliberately has no structured source-URL field. This keeps its existing data contract. Notes plus source text must fit its existing 2,000-character limit.

For safe retries, reuse `recipeId` with an identical recipe submission. Changed content with the same ID returns a conflict. Shopping batches can use a stable `requestId`; an identical retry recovers existing items. Partial errors return added item IDs and a failed index. Retry the unchanged full batch with the same ID. Reusing a meal ID recovers an identical addition; changed meal details with that ID return a conflict. Meal removal requires the revision returned by `get_meal_plan`; stale revisions fail and must be reviewed before retrying. Default week dates use Australia/Brisbane and the user's saved week-start preference.

## Local checks

```sh
pnpm install
pnpm db:start
node --env-file=apps/web/.env packages/db/scripts/migrate.mjs
pnpm dev:web
pnpm test packages/auth/src/oauth.integration.test.ts packages/mcp/src packages/api/src/http-body.test.ts apps/web/src/components/connected-assistants.test.ts
pnpm check-types
pnpm check
```

The test wrapper starts a separate PostgreSQL container, applies migrations and removes it afterwards. The MCP integration test starts the real handler on a local HTTP port. It registers a client, authorises a real test session, exchanges a code using PKCE and connects using the official MCP client on both protocol eras. Password login exists only in its isolated test instance. Production login remains social-only. Tests exercise all eleven tools, free/lapsed entitlement, audience and authentication rejection, cross-household denial, recipe parsing, retries, zero import-credit use, planner conflicts and disconnect.

For a manual smoke test, connect MCP Inspector to `http://localhost:3001/api/mcp` and complete sign-in. Once you have an access token, the requested CLI check is:

```sh
npx @modelcontextprotocol/inspector --cli http://localhost:3001/api/mcp --method tools/list --header "Authorization: Bearer <access-token>"
```

Keep tokens out of saved commands, logs and committed files. For synthetic local testing, the integration fixture helpers can create a disposable account and complete DCR, consent and exchange. Seed only that disposable local user's `billing_account` with an active, future-dated entitlement, then remove its client, household and user afterwards. Never change real billing accounts to test this feature.

## Connecting and disconnecting

Copy the link from `/mcp`, paste it into the assistant's custom connections settings, then sign in and approve access. Settings links to the guide and lists connected assistants. Disconnect revokes that user's client token family and removes consent. MCP also checks consent on every request so an existing JWT stops working immediately. Removing a connection only in the assistant's settings depends on that client's revocation behaviour; disconnect in Kitchenbinder to guarantee the server denies further calls.

## Remaining review

- TODO(architect): verify the exact Claude and ChatGPT menu labels in `apps/web/src/lib/assistant-guides.ts` and test each hosted client's production connection. Their plan/workspace availability can vary.
- Review `/mcp`, consent and Settings at desktop and mobile widths when browser automation is available.
- The login-session lifetime also bounds an assistant connection. Expired or removed login sessions require reconnection even if the assistant still has a token.
- The provider's refresh/revocation operations use its adapter operations rather than an application-wide transaction. The live-consent check denies disconnected clients; simultaneous refresh/reconnect across multiple workers remains an upstream concurrency consideration.
- Date defaults use Brisbane because the account model has no saved timezone. Explicit date ranges are available for other timezones.
