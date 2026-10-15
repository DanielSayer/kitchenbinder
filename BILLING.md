# Polar billing

## Configure plans

Edit `packages/api/src/billing/policy.ts` for recipe limits, AI credits, household permissions, trial duration, queue limits and the service AI cutoff. Restart both the web app and import worker after changing it. Free and Pro are the only tiers. A trial uses Pro features with a separate, lifetime trial credit allowance.

Defaults are 10 recipes and 3 lifetime AI credits for Free, unlimited recipes and 50 monthly AI credits for Pro, and a 7-day trial with 3 total credits. Pro credits reset on the first of each calendar month at 00:00 UTC, independently of the payment date. Unused credits do not roll over. Coupons, including 100% discounts, never bypass these limits.

The public pricing page advertises A$4.99/month with a 7-day trial. Configure the Polar monthly product to match before enabling checkout. Updating the UI does not change the Polar product.

Polar owns the recurring price, currency, taxes and coupons. Create one monthly recurring Pro product. Do not use a one-time or metered product for this integration. The checkout displays the authoritative price before purchase. Future paid features from PRICING.md are not gated yet.

## Setup

1. Apply `packages/db/src/upgrades/billing.sql` to an existing database before deploying the web app and worker. New databases can use the current Drizzle schema. The upgrade was applied to the local development database during implementation.
2. In Polar sandbox, create the monthly Pro product. Set `BILLING_MODE=sandbox`, `POLAR_SERVER=sandbox`, `POLAR_PRO_PRODUCT_ID`, `POLAR_ACCESS_TOKEN` and `POLAR_WEBHOOK_SECRET` in `apps/web/.env`. The token needs customer read, subscription read, checkout write and customer session write permissions.
3. Add a Polar webhook endpoint at `https://YOUR_HOST/api/polar/webhooks` subscribed to `customer.state_changed`. Use a tunnel for localhost. Copy its signing secret into the environment variable. Set `BETTER_AUTH_URL` to the app's actual origin.
4. Restart the web app and worker. Settings > Plan & billing opens checkout, reports usage and opens the customer portal. Checkout and portal return to the billing tab. Refresh plan fetches current Polar state, including after returning from checkout.
5. Create friends-and-family discount codes in Polar. Checkout allows codes. A recurring 100% coupon grants Pro while its subscription is active, with the same AI caps.
6. Complete [provider acceptance](docs/provider-acceptance.md), then repeat configuration checks with separate production credentials, a production product and both `BILLING_MODE=production` and `POLAR_SERVER=production`. Use `BILLING_MODE=disabled` with no Polar credentials or product ID to keep Free/manual features available. Disabling billing does not cancel existing subscriptions or clear cached entitlements. Reconcile existing subscribers before disabling it.

The app keeps Better Auth for sign-in. Polar's external customer ID is the authenticated Better Auth user ID. Clients cannot choose customer IDs, product IDs, prices or return URLs. Webhooks verify the raw request signature with Standard Webhooks for current and legacy Polar keys, validate the payload with Polar's SDK, then fetch current customer state under an account lock. This makes retries and out-of-order delivery safe. API or database errors return 503 so Polar retries. Other products never grant Pro.

Checkout is reused until it expires to avoid duplicate purchases. The first issued checkout reserves that account's trial eligibility, even if abandoned. Later checkouts do not offer another trial. The trial AI allowance is also lifetime per account, so repeated provider trials cannot reset it. Direct dashboard subscriptions should use the same external customer ID.

## Usage and downgrades

Recipe capacity counts active recipes contributed by the account, including shared recipes, plus pending imports. It does not count recipes contributed by other household members. Concurrent manual saves, copies, restores and import submissions share an account lock. Imports admitted before a downgrade keep their reserved recipe slot. Existing recipes remain readable, editable and exportable. Removing a recipe frees storage, never AI credits.

Credits are reserved at admission and released only when preparation fails before the AI call. Failed or interrupted AI calls consume a credit. Saved/import attempt records retain the original Free, trial or Pro bucket. Cancellation returns the account to its remaining Free allowance. Legacy import attempts count towards Free usage after migration. Existing accounts above 10 recipes retain their recipes and cannot add more on Free.

Pro is required to create households, issue invitations and receive ownership. Free accounts can join, read and contribute to existing households within their own recipe and AI caps. Downgrades do not strand existing shared recipes or prevent housekeeping actions.

Paid access expires at the verified period end even if a webhook is missed. Cancellation at period end retains access until then; revocation removes it after sync. Before admitting a new import, accounts with billing history automatically reconcile expired paid access or stale Free state with Polar. Confirmed Free state is cached for one minute. Reconciliation commits before quota checks, and a provider outage asks the user to retry without admitting an import or consuming credits. Existing imports remain recoverable during an outage. Settings also refreshes the plan on opening. Account deletion is blocked until Polar confirms no active, trial, past-due, paused or other unfinished subscription. Operators must also handle Polar's retained customer and tax records according to the applicable retention policy.

## AI spending cutoff

The default cutoff is 2,500 US cents of reserved cost per UTC day, at 25 cents per provider attempt. `aiSpend` persists reservations before calls under a global PostgreSQL lock across workers. Failed calls still count and account deletion does not erase reservations. Set `AI_ENABLED=false` and remove `OPENAI_API_KEY` on the web and worker, then restart both, to stop new AI calls while keeping manual entry and checkpoint saves available.

This is reservation accounting, not measured provider invoicing. `packages/env/src/ai-policy.ts` binds the approved model, UTF-8 input/system bounds, output limit and reservation amounts. Startup rejects an enabled model outside that policy. Generation disables automatic retries and caps output at 7,000 tokens. Review the [cost calculation and provider controls](docs/provider-acceptance.md#ai-reservations-and-provider-controls) whenever prices, model, schema or bounds change. Provider-side controls remain necessary.

## Launch verification

Use Polar sandbox to check checkout, trial conversion, monthly renewal, 100% coupon, cancellation, immediate revocation, portal return, invalid signatures, event redelivery and a lost webhook followed by Refresh plan. Confirm the price and tax treatment in checkout. Local tests validate database enforcement and SDK webhook signatures; they cannot prove your live Polar configuration or payment flow.
