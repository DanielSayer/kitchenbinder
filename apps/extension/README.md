# Kitchenbinder extension

Chrome and Edge Manifest V3 app built with [WXT](https://wxt.dev/), React and TypeScript. WXT handles entrypoint bundling, development reloads, manifests and ZIP packaging. The workspace uses the repository's React and TypeScript catalog versions.

Parts 1 to 4 are implemented. The popup connects an account, captures recipes from the loaded tab, selects a personal or group collection, and saves through a durable server queue. See [TODO.md](./TODO.md) and [AUTH.md](./AUTH.md).

## Branding

The website owns the brand. The popup imports `apps/web/src/styles/brand.css` for its font, palette, spacing, focus styles and wordmark. WXT copies the website PNGs from `apps/web/public/branding` into each extension build and declares them as toolbar and extension icons. Change those website sources to update both apps; keep the compact popup layout in its own stylesheet. Turbo includes these shared sources in its cache inputs.

## Local development

Use the repository's pnpm version and Node 22 or newer. From the repository root:

```sh
pnpm install
pnpm dev:extension
```

In `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3-dev`. Pin Kitchenbinder to the toolbar and click it to open the popup. The browser is not launched automatically.

For Edge, run `pnpm --filter @prep-sheet/extension dev:edge` and load `apps/extension/.output/edge-mv3-dev` from `edge://extensions`.

Run the website separately with `pnpm dev:web` so **Open Kitchenbinder** can reach it. The default website origin is `http://localhost:3001`; WXT's reload server uses a separate port. To change the website origin, put `WXT_PREP_SHEET_ORIGIN` in this app's `.env.development.local` and restart WXT. Use an origin only, without a path or query string.

## Build and verify

For account connection, start PostgreSQL and apply the schema from `packages/db` with `docker compose up -d` and `pnpm exec drizzle-kit push`. Restart the website after dependency or server environment changes, then reload the unpacked extension. Choose **Connect to Kitchenbinder**, sign in if needed and approve access. Use website **Settings → Extensions** to revoke a connection.

From the repository root:

```sh
pnpm build:extension
pnpm --filter @prep-sheet/extension check-types
pnpm package:extension
```

The default build and package commands target the local website. Packaging builds both browsers and writes `*-chrome-dev.zip` and `*-edge-dev.zip` under `.output`. These are development packages, not store releases.

Stop the extension development server before building or packaging the same browser, since these commands write to the same output directory. After a static build, reload the unpacked extension in the browser. Generated `.output` and `.wxt` files are ignored by Git and Biome; Turbo caches build and package outputs.

## Stable identity and production configuration

The committed `config/development-identity.json` contains a public key, not a secret. Its fixed development ID is `kjmnecmcpdklkaaiklbfoialfdiamabj` in Chrome and Edge. Do not regenerate it during installs or builds. Its private key was not saved; this identity is for unpacked development only.

No production deployment is configured. When a store listing and deployed website are available, configure these public build settings in `.env.production.local` or CI:

```dotenv
WXT_PREP_SHEET_ORIGIN=https://kitchenbinder.app
WXT_EXTENSION_PUBLIC_KEY=<base64 DER RSA public key from the store listing>
```

Then use:

```sh
pnpm --filter @prep-sheet/extension build:production
pnpm --filter @prep-sheet/extension package:production
```

Production mode requires both settings and rejects HTTP, loopback and `.example` origins. If Chrome and Edge listings have different identities, provide their respective keys in `.env.production.chrome.local` and `.env.production.edge.local`. Configure the store-issued IDs in the website EXTENSION_IDS allowlist as described in AUTH.md. The manifest key stabilises unpacked identity; it does not register a store listing or authenticate the extension.

Never add server secrets, database credentials or OpenAI keys to extension settings. Browser bundles and manifest values are public.

Keep existing store listings, public keys and IDs when rebranding an installed
extension. A change to the website origin requires reconnection and does not move
pending requests between origins. Follow the
[domain cutover checklist](../../docs/kitchenbinder-rebrand.md) before updating an
existing installation.

## Capture a loaded recipe

Open a recipe, finish any browser challenge, then click **Capture recipe** in the extension. Capture works locally even when signed out. If several recipes are found, choose one and expand **Preview captured recipe** to inspect it. The latest capture and selected recipe stay in trusted extension local storage across popup closure and browser restart. Nothing is uploaded until you choose **Save recipe**.

The worker accepts capture commands only from the extension popup and injects a self-contained function into the active tab's top frame in the isolated world. It does not download the source page, access cookies, read form values, or pass extension credentials into the tab. JSON-LD capture allows only recipe names, ingredients, instructions, yield and times. When metadata is missing or invalid, capture reads visible recipe cards or a main/article region with ingredients and instructions, skipping forms, hidden content, account widgets, navigation and comments. Pages without a suitable region produce an error.

Capture limits are 1,000,000 characters of JSON-LD input, 32,000 characters per recipe, ten recipes and 128,000 characters for the response, with traversal limits for deeply nested or unusually large pages. Oversized captures return an error instead of silently truncating ingredients or instructions. Both the worker and popup validate the response. Source links use the loaded HTTP(S) URL with query strings and fragments removed to avoid carrying account tokens or tracking parameters; sites whose recipe identity exists only in a query string are not fully supported yet. Page text remains untrusted and must be treated as recipe data, never instructions, by the import API.

## Process and save

After applying the database schema, run the server worker in a separate terminal from the repository root:

```sh
pnpm worker:imports
```

This command reads server settings from `apps/web/.env`, including the database and OpenAI configuration. Keep the website running too. The worker needs the installed workspace dependencies, including the root `tsx` runner. A deployment must run this command under a process supervisor alongside the website, with the same database and server environment. A request-only or serverless website deployment is insufficient without a separately hosted worker. No deployment is configured by this change.

Choose a recipe, choose **My recipes** or a group, then **Save recipe**. All group members currently have recipe write access. Processing continues on the server if the popup closes or the browser worker suspends. Reopen the popup to recover its status and the saved recipe link. Starting another import is blocked until the current attempt finishes or the server records an unaccepted request as discarded. The discard record prevents a late network submission from creating a recipe after you move on. Discarded attempts count towards the daily allowance. If access to a group changes, start another import and choose an available collection.

The extension stores one pending request per account and website origin before sending it. Network retries reuse its UUID and exact content. The server rejects that UUID with different content, source or collection, and does not generate or save it again. A failed attempt keeps its ID terminal. **Start another import** explicitly creates a fresh attempt on the next save, which may use AI again.

Jobs move through queued, processing, ready and saved states. The worker commits a claim before calling AI, checkpoints the generated result, then saves the recipe and tags in one transaction with a final group-membership check. Workers claim queued jobs with PostgreSQL row locks and skip locked rows. Ready jobs resume saving without another AI call. If a worker dies during processing, the next running worker marks its unresolved claim failed after three minutes. It does not automatically repeat a call whose result may have been lost. Queued jobs remain queued while no worker is running.

The existing 50-per-24-hour allowance counts saved recipes plus pending and failed import attempts, without counting a saved import twice. Active jobs keep their reservation even after 24 hours. Admissions are serialised per account. New imports are also limited to five per minute, and authenticated collection/import/status requests to 60 per minute per account. Identical retries do not reserve another import attempt.

Captured text is limited to 32,000 characters and source URLs to 4,096. The server accepts bounded JSON bodies up to 200,000 bytes for imports and 4,096 bytes for collection/status calls. It validates HTTP(S) links and rejects credentials, query strings, fragments and nonstandard ports. It never downloads the source URL. The original captured source link and imported status are persisted; query-only recipe identities remain unsupported.

Server input text is cleared after processing or failure, and checkpointed output is cleared on save or permission failure. Job IDs, request fingerprints, source URLs, destinations and terminal status remain until account deletion so old retries cannot recreate a deleted recipe. Local captures remain until replaced or extension data is removed. Pending request text remains per account until replaced or **Start another import** clears it. Disconnect revokes credentials but preserves recoverable work for reconnection to that account. A previously accepted job continues after disconnect or credential revocation; future API calls require a valid credential.

## Code layout

- `wxt.config.ts` and `config/`: build settings, public identity and manifest permissions.
- `src/entrypoints/popup/`: React popup, recovery controls and local fonts/styles.
- `src/entrypoints/background.ts`: account connection, protected credential storage and authenticated account requests.
- `src/lib/extract-recipe.ts`: self-contained DOM extractor injected with `scripting.executeScript` only after a capture click. There is no persistent content script or page-message listener.
- `src/lib/capture-contract.ts`: validated capture responses, size limits and recovery messages.
- `src/entrypoints/popup/Capture.tsx`: capture action, recipe choices and local text preview.
- `src/lib/config.ts` and `origin.ts`: validated website origin used by the popup and background worker. Extension tokens are accepted only by dedicated extension endpoints, not website tRPC.

Static builds request `activeTab`, `scripting`, `identity`, `storage` and the configured Kitchenbinder host only. No content scripts are registered on all sites. WXT's live development server may add local reload permissions and content security policy entries; static packages do not need those additions.

## Verification so far

Type checking, local builds and Chrome/Edge ZIP packaging pass. Account authentication has automated server and worker tests. Capture tests cover metadata graphs, instruction sections, multiple recipes, visible-text fallback, privacy exclusions, challenge pages, size limits, unsupported pages, sender restrictions and invalid injection responses. The current extractor captured one Butter Chicken recipe from Kitchen Sanctuary's already-loaded DOM without refetching the page. Browser extension installation, real Chrome/Edge identity flows and the full installed-extension import flow still need end-to-end checks.

The popup was also checked in a browser preview with simulated worker responses at 360px and 320px, including capture progress, expanded preview, keyboard recipe selection, long titles and challenge recovery. A scrollbar-related horizontal overflow was fixed. These UI checks do not verify installed-extension injection or permissions.

Step 4 verification: the full automated suite passes 98 tests with seven opt-in live tests skipped. New PostgreSQL tests exercise authenticated admission, scopes, revocation, exact origins, body validation, account isolation, personal/group saves, membership removal during generation, concurrent requests/workers, valid tag persistence, usage reservations, rate limits, terminal failures and checkpoint recovery. Generation tests confirm no source-page fetch even when captured text starts with a URL. Worker tests cover storage-before-network, response loss, service-worker restart simulation, account-bound recovery and refusing reset while processing.

Website and extension type checks, the website production build, Biome checks and both browser packages pass. The dedicated worker command starts against the local database. Actual popup components were previewed with simulated worker responses, checking collection radio buttons by keyboard, processing, saved-result recovery after reload and group-access failure recovery. Layout widths of 360px and 320px were checked, with no horizontal overflow. These checks do not establish installed Chrome/Edge login, injection or a real AI import. Those end-to-end checks remain in part 6.

## Popup experience

The popup shows one primary Save recipe action after capture. Collection choices use keyboard-accessible radio buttons. It remembers the last valid choice per account and website origin in trusted local storage, validates it against the current collection list on reopen, and explains when a removed collection falls back to My recipes. A changed destination never rewrites a pending request.

Pending imports retain their recipe title and collection name as local display context, separate from the server request. While an attempt exists, the popup shows that attempt rather than another captured page. Processing can be recovered without loading collections first. Collection failures offer Reload collections; expired access offers Reconnect account; uncertain submissions offer Check import again. Failed attempts require Start another import before a new save. Reset still requires the server discard acknowledgement. A failed recapture preserves the previous usable recipe.

Step 5 verification: 106 automated tests pass, with seven opt-in live tests skipped. This includes PostgreSQL server tests, worker persistence/account-isolation checks and React recovery tests. The actual popup components were rendered in headless Edge with simulated worker responses at 360px and 320px. Checks covered long titles and collection names, signed-out, importing, saved, expired-access, group-access and collection-loading errors, expanded previews, keyboard selection, focus retention, Tab to Save recipe and no horizontal overflow. Website/extension type checks, Biome, the website build and Chrome/Edge ZIP builds pass. Installed-extension login, injection and a real AI import remain unverified and belong to step 6.
