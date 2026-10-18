# Kitchenbinder browser extension

Build a Chrome and Edge extension that captures a recipe from the page the user has opened, lets them choose a collection, and saves it directly to Kitchenbinder. The popup handles connection, collection selection, progress and the saved recipe link.

Parts 1 to 5 are implemented. Automated account and capture checks pass; real Chrome/Edge installation and login verification remain in part 6. Capture was checked against the loaded Kitchen Sanctuary butter chicken page. Imports use a PostgreSQL queue and a separate server worker. See [README.md](./README.md) for setup and [AUTH.md](./AUTH.md) for the credential design.

## 1. App setup

- [x] Create `apps/extension` as a TypeScript and React workspace app using Manifest V3. Use WXT with its React module and the repository's React/TypeScript versions.
- [x] Add development, build, type-check and packaging commands to the existing pnpm/Turbo workflow.
- [x] Separate the popup, background service worker, page extraction script and API client.
- [x] Configure local development and production Kitchenbinder origins, with stable extension IDs for auth configuration. Local defaults and a fixed development ID are ready; production builds require the future deployment origin and store public key, as no production deployment exists yet.
- [x] Declare temporary active-tab access and scripting permission, plus access to the configured Kitchenbinder origin. Page injection will be connected to a user click in part 3; there is no automatic access to every website.

## 2. Connect an account

- [x] Add a **Connect to Kitchenbinder** flow that opens the website and reuses its existing Better Auth and Discord login.
- [x] Implement an explicit extension authorisation handoff using a short-lived, single-use code bound to the initiating extension with state and PKCE. Validate the extension ID and callback destination.
- [x] Choose how extension credentials integrate with Better Auth. Prefer a revocable, narrowly scoped extension credential over copying the website's session cookie. Define expiry, renewal and server-side storage before implementation.
- [x] Keep credentials in extension-only storage, restrict content-script access and keep credentials out of page messages, URLs and logs. Include no server secrets or OpenAI keys in the extension bundle.
- [x] Show the connected account, handle expired or revoked access, and support disconnecting. Add website controls to revoke connected extensions.
- [x] Configure exact trusted origins and API access rules without weakening existing website auth checks.

## 3. Capture the loaded recipe

- [x] On user action, read recipe JSON-LD from the active page, falling back to relevant visible recipe text. Capture its title and source URL.
- [x] Handle multiple recipes, missing metadata and unsupported pages with a clear choice or error.
- [x] Treat all page content as untrusted. Validate messages, cap payload sizes and exclude unrelated forms, cookies and account data.
- [x] Detect pages still showing a browser challenge and ask the user to finish opening the recipe before retrying.
- [x] Test Kitchen Sanctuary's butter chicken page first. Capture the already-loaded recipe rather than fetching the blocked URL again. The extractor returned one Butter Chicken recipe from the live loaded DOM; installed-extension checks remain in part 6.

## 4. Process and save through the API

- [x] Add an authenticated import operation accepting captured content and its source URL separately. Reuse the existing recipe schema, generation rules, tags and persistence logic.
- [x] Preserve the original source link and mark the recipe as imported. Validate the source URL without requiring another page download.
- [x] Load the user's personal and group collections for the popup. Enforce membership and write permissions on the server, including immediately before saving.
- [x] Apply existing usage limits and add payload validation and appropriate rate limits for extension requests.
- [x] Make retries idempotent so closing the popup or repeating a request cannot create duplicate recipes or repeat AI work unnecessarily.
- [x] Decide how imports complete and expose status across popup closure and service-worker suspension. Keep long-running AI work on the server and let the extension recover the result.

## 5. Popup experience

- [x] Build signed-out, loading, ready, importing, success and error states using Kitchenbinder's visual style.
- [x] Show the detected recipe title, a collection picker and one primary **Save recipe** action.
- [x] Remember the last valid collection per account and recover if access changes.
- [x] Keep progress recoverable when the popup closes. On success, link to the saved recipe.
- [x] Provide specific recovery for unavailable recipes, expired login, changed group access and processing failures. Check keyboard access and compact popup layout.

## 6. Verify and release

- [ ] Test the full flow in Chrome and Edge, including login, reconnect, revocation, personal and group saves, and popup closure during import.
- [ ] Test auth handoff replay, invalid callbacks, cross-account access, oversized or malicious page content, duplicate submissions and interrupted requests.
- [ ] Verify extraction against Kitchen Sanctuary and a small set of other recipe sites, including pages without JSON-LD.
- [ ] Document unpacked local installation, environment setup and production builds.
- [ ] Prepare icons, store screenshots, permission explanations and a privacy policy covering user-triggered capture and AI processing. Submit store packages when authorised.

## Changes outside this folder

- `packages/auth`: extension authorisation, credential validation and revocation.
- `packages/api`: captured-content imports, collection access and recoverable import status.
- `packages/db`: credential and import-job persistence as required by the chosen design.
- `apps/web`: connection approval, login return flow and connected-extension management.
- Shared packages and root configuration: browser-safe contracts and workspace build integration. Keep server auth and database modules out of the extension bundle.

## First milestone

- [ ] Connect a real account, capture the loaded Kitchen Sanctuary butter chicken recipe, save it to a personal collection from the popup, and open the result with its source link intact. Then complete group support, failure recovery and release checks above.
