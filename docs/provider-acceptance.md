# Provider configuration and acceptance

Use this workflow before exposing a feature on the selected release. Local mocks,
synthetic sessions and CI prove application behaviour, not a provider round trip.
Copy the acceptance record at the end into private release evidence. Record the
commit and immutable image digest, actual HTTPS origin, UTC timestamps, operator,
expected/observed results and redacted evidence links. Keep account identifiers,
cookies, tokens, recipe text, webhook bodies and payment details out of Git/logs.

## Configuration policy

Both production entry points and the application validate the same policy.
Failures name the settings to fix without printing their values. Restart web and
worker together after configuration changes.

| Feature | Required configuration | Intentionally disabled behaviour |
| --- | --- | --- |
| Sign-in | HTTPS `BETTER_AUTH_URL` origin only, signing secret of at least 32 characters, at least one complete Google/Discord ID and secret pair | Provider-free development may view public pages. Production requires sign-in. Only configured providers appear on login, invitations, extension connection and linking. |
| AI | Explicit `AI_ENABLED=true`, nonempty `OPENAI_API_KEY`, reviewed `OPENAI_MODEL` | `AI_ENABLED=false`, no key. Manual entry, existing recipes and generated checkpoint saves remain usable. New AI imports fail before admission/spend. |
| Billing | Explicit `BILLING_MODE=sandbox` or `production`, exactly matching explicit `POLAR_SERVER`, token, product UUID and webhook secret | `BILLING_MODE=disabled`, no Polar credentials/product. Free usage and manual entry remain usable. Cached entitlements expire normally. This does not cancel subscriptions. |

Credential pairs and enabled billing must be complete in development too.
Development can infer enabled AI from its key and billing from Polar credentials
when mode settings are omitted. Production always requires explicit choices.
Sandbox is an intentional staging choice, never an implicit paid-launch default.
The code cannot infer whether a valid token/product belongs to the selected Polar
organisation or whether credentials work. Verify that in the provider dashboard.
Before disabling billing on an existing service, reconcile/cancel subscribers by
the agreed operating process, export the reconciliation evidence and warn users
through the approved channel. Do not use a configuration change as cancellation.

Run this read-only local check with the intended runtime environment injected:

```sh
pnpm providers:check
# Or load an explicitly selected secret file using Node 26:
node --env-file=/secure/path/to/runtime.env scripts/check-providers.mjs
```

The command loads `apps/web/.env` when present, applies production provider rules,
prints only provider IDs, feature modes and the public AI policy, and makes no
provider or database requests. An exit code of zero means configuration shape
passed. It does not approve release. Full startup also validates DB/environment
fields and migration history. Never commit the secret file or its contents.

`SKIP_ENV_VALIDATION` is forbidden in production. Synthetic release tests have one
exception: `PREP_SHEET_TEST_DATABASE=isolated`, PostgreSQL on `127.0.0.1` or Docker's
`host.docker.internal`, a nondefault explicit port, database `/prep_sheet_test`,
and origin exactly `http://localhost:3001`. In production mode all external
providers must be absent and AI/billing explicitly disabled. `CI=true` grants no
exception. `providers:check` rejects this topology entirely. Do not set this marker
in deployments. Database tests run only through `pnpm test`.

## HTTPS OAuth acceptance

Use controlled accounts with permission from their owners. Register exact
`https://<actual-origin>/api/auth/callback/google` and/or
`https://<actual-origin>/api/auth/callback/discord` callbacks. Configure the actual
origin/consent screen and authorised test users with each provider. Never register
wildcards or substitute a synthetic session for this check.

- [ ] Run the configuration check on web and worker settings for the exact image.
- [ ] In a clean browser, check login, `/join` with a controlled invitation, and
  `/connect-extension` when offered. Only enabled providers appear. In Settings,
  only enabled providers can be linked. Repeat with Google-only and Discord-only
  staging configurations if both deployment variants will be supported.
- [ ] Complete each enabled provider's real HTTPS login. Verify callback origin,
  final user and authorised redirect. Inspect session cookies for Secure,
  HttpOnly, appropriate SameSite and the expected host/path. Confirm an
  unauthorised cross-origin callback/sign-in fails and does not set a session.
- [ ] Cancel provider consent and retry. Verify useful recovery, retained intended
  destination and no unexpected account/session.
- [ ] Log out, reload a protected page and check session invalidation. Sign into
  account B after A. Check recipes, settings, drafts and groups contain only B's
  authorised data. Test two tabs and a delayed response from A.
- [ ] With both providers enabled, use the same email on two controlled provider
  identities. Signed-out sign-in must not silently merge an existing account.
  Sign in by the original method, explicitly link from Settings within ten
  minutes, then sign out and sign in through the linked method. Confirm the same
  account and recipes. A different-email link must fail without changing either
  identity. An old session must require reauthentication before linking.
- [ ] If a provider is removed, prove the remaining method can access affected
  accounts before rollout. Record the recovery decision for accounts with only
  the removed method. Do not disable implicit-linking or fresh-session checks.

## AI reservations and provider controls

`packages/env/src/ai-policy.ts` is the reviewed envelope, not an invoice model.
It currently approves `gpt-5.6-luna`, 160,000 UTF-8 bytes of content, 160,000 bytes
of complete system prompt including tags, and 7,000 output tokens. Both source
paths and direct generation use the same byte check. Worker validation runs
before reservation; an oversized input releases usage and makes no provider call.
Fetched text is additionally truncated to 40,000 characters; captured content is
limited to 32,000 characters and typed input to 20,000. Byte limits still apply to
multibyte text. SDK automatic retries are zero and service tier is `default`.

The [official model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
checked 15 October 2026 lists standard pricing of US$0.20 per million input tokens
and US$1.20 output. For a conservative review, count up to one token per UTF-8 byte,
allow 16,384 further tokens for schema/protocol overhead, and price the entire
336,384-token input at twice the input rate plus a 25% cache-write allowance.
Price all 7,000 output tokens at 1.5 times the output rate. This deliberately
includes the documented long-context multipliers even for smaller requests.
The resulting estimate is US$0.180792 per attempt, below the US$0.25 reservation.
Startup rejects enabled AI if this reviewed estimate exceeds the reservation.
This is an estimate under those assumptions, not a guaranteed invoice ceiling.
Review schema/protocol growth against that overhead allowance, and recheck
[current pricing](https://developers.openai.com/api/docs/pricing) before acceptance.
The output limit includes reasoning tokens according to the
[reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).

The US$25 daily budget admits at most 100 reservations at US$0.25 each across
workers in the shared database, reset at 00:00 UTC. Failed/interrupted provider
calls retain their reservation. Saved checkpoints retry without another call.
This does not include other applications using the key, provider pricing changes,
taxes or currency conversion. It does not reconcile measured usage with invoices.

- [ ] Check the current model price, tokenisation/overhead assumptions, service
  tier and output semantics. Record calculation, date, reviewer and evidence.
  Any model, prompt/schema bound, tier or reservation change needs a coordinated
  code/policy review and new acceptance. Changing only `OPENAI_MODEL` is rejected.
- [ ] Use a dedicated OpenAI project/service account restricted to this workload
  and model. Set provider rate/spend controls and budget alerts, with an actual
  recipient/owner, then prove notification delivery. Check the account's actual
  limits. A project budget alert is not necessarily a hard spending cutoff.
  Record the applicable enforcement and billing delay; follow the
  [production guidance](https://developers.openai.com/api/docs/guides/production-best-practices).
- [ ] After explicit authorisation for paid AI, run one representative website
  import and one captured import through the supervised worker. Record source
  classification, saved recipe accuracy, units/times/tags, durable job stages,
  one credit and one 25-cent reservation per call. Inspect actual provider usage.
- [ ] Exercise a preparation failure without a provider call and a controlled
  provider failure. Preparation must release usage/spend; a started provider call
  retains usage/reservation. Retry a saved checkpoint without another AI call.
- [ ] Verify disabling AI on both processes preserves manual saves and checkpoint
  recovery. Existing in-flight provider calls may finish; drain them first.

Do not run `pnpm test:live` casually for acceptance. It can make multiple paid
requests and calls generation directly rather than proving queue accounting.

## Polar sandbox acceptance

Use a separate sandbox organisation/product/token/webhook. Set both mode and
server to `sandbox`. Follow Polar's
[sandbox instructions](https://polar.sh/docs/integrate/sandbox) for its current
test-payment method. Use operator-controlled sandbox accounts and email addresses;
provider flows may send their own emails. Obtain authorisation before initiating
those flows. Never enter a real card, alter a live product or create production
checkout as part of this checklist without separate explicit authorisation.

| Check | Action and required result |
| --- | --- |
| Product and checkout | Inspect the configured product/organisation in sandbox. Compare advertised A$4.99/month, recurrence, tax presentation and seven-day trial terms with checkout. Complete authorised sandbox checkout and return to Settings. The signed-in user's external ID must match the customer; another product cannot grant Pro. |
| Trial | Verify eligible trialing access, three lifetime trial credits and displayed end date. Abandoned issued checkout reserves trial eligibility. A later checkout/account refresh must not offer a second trial. Use the provider's supported sandbox lifecycle controls or wait for expiry. |
| Conversion and renewal | Complete trial conversion and monthly renewal in sandbox. Check active status, verified period end, 50 credits per UTC calendar month and no duplicate subscription on repeated checkout. Record actual events/state; a mocked timestamp is not provider evidence. |
| Coupon | Use a sandbox recurring 100% coupon. Confirm price and active Pro access with unchanged AI caps. Check finite/expired/invalid coupon handling as applicable. |
| Cancellation | Cancel at period end. Pro remains until verified expiry and then returns to remaining Free usage without deleting recipes. No new trial. |
| Revocation | Immediately revoke a sandbox subscription. Deliver state change and refresh. Pro must disappear after authoritative sync, with existing content retained. |
| Portal | Open Manage subscription as the correct customer. Check cancellation/change flow, return origin and current plan after return. An account without a Polar customer must not reach another customer's portal. |
| Signature | Use a captured sandbox delivery held privately. Missing/altered signature or raw bytes must yield 403/400 with no entitlement change. Check a genuine dashboard-signed delivery too, using the actual endpoint signing secret. |
| Redelivery and ordering | Redeliver an authentic event and an older authentic event after a newer change. No duplicate entitlements/trial reset; authoritative current customer state wins. Use Polar's dashboard delivery log as evidence. |
| Retry and recovery | On staging, temporarily make webhook reconciliation fail. It must return 503, then recover on delivery retry. Withhold one event, restore the endpoint, and use Settings > Refresh plan to recover current state. Also test expired entitlement reconciliation at import admission. Never acknowledge a failed sync as success. |

Configure `https://<actual-origin>/api/polar/webhooks` for
`customer.state_changed`. Keep raw bytes through the proxy and use the SDK's
signature validation. Polar documents delivery retries and dashboard redelivery
in [webhook delivery](https://polar.sh/docs/integrate/webhooks/delivery).
Confirm genuine signatures against this locked SDK and the actual secret format;
a locally generated signature alone cannot establish provider compatibility.
Use [Polar's trial guidance](https://polar.sh/docs/features/subscriptions/trials)
for current lifecycle behaviour. If no sandbox time-advance mechanism is available,
record renewal/conversion as pending until the real sandbox lifecycle completes.

## Production configuration acceptance

- [ ] All applicable sandbox rows passed for the selected image. Keep billing
  disabled on public production until production configuration is separately accepted.
- [ ] Verify actual production organisation, product ID, A$4.99 monthly price,
  trial/tax terms, coupons, token permissions and webhook endpoint/event/secret in
  the dashboard, read-only. Sandbox and production credentials/products must be
  distinct. Set both `BILLING_MODE` and `POLAR_SERVER` to `production` together.
- [ ] Re-run `providers:check` against the real web and worker settings. Check the
  registered OAuth callback origin, HTTPS/session-cookie settings, dedicated AI
  project controls and current reservation calculation. Do not publish secrets.
- [ ] Deploy privately, then run authorised HTTPS OAuth and import acceptance.
  Record the actual production result separately from staging. Any production
  payment/delivery test needs its own authorisation; otherwise leave it pending.
- [ ] Record owner, rollback/disable procedure and release decision for each
  enabled feature. Readiness, proxy/throttling, backups and support acceptance are
  separate requirements in the deployment runbook and other audit findings.

## Acceptance record

| Field | Evidence |
| --- | --- |
| Commit and image digest | Pending |
| Origin, environment, operator, UTC date | Pending |
| Config check for web and worker | Pending |
| OAuth enabled providers and each scenario | Pending |
| AI cost review and provider control delivery proof | Pending |
| Website and captured import job/usage evidence | Pending |
| Each Polar sandbox row, including renewal | Pending |
| Separate production configuration review | Pending |
| Remaining authorisations/configuration/access | Pending |
| Feature release decisions and owner | Pending |

Use Passed, Failed, Pending or Disabled with a reason for every scenario. Do not
mark a disabled feature as accepted or replace external evidence with a green CI run.
