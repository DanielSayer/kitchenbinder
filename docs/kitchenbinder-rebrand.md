# Kitchenbinder rebrand and domain cutover

The public product name is Kitchenbinder and the production origin is
`https://kitchenbinder.app`. The code and artwork use the new name. This checklist
records the deployment and provider work needed before launch. It does not imply
that DNS, mailboxes, provider consoles or a live deployment have been configured.

## Production configuration

| Setting | Production value |
| --- | --- |
| Web and worker `BETTER_AUTH_URL` | `https://kitchenbinder.app` |
| Extension `WXT_PREP_SHEET_ORIGIN` | `https://kitchenbinder.app` |
| nginx template `PUBLIC_HOST` | `kitchenbinder.app` |
| Google callback | `https://kitchenbinder.app/api/auth/callback/google` |
| Discord callback, if enabled | `https://kitchenbinder.app/api/auth/callback/discord` |
| Polar webhook, if billing is enabled | `https://kitchenbinder.app/api/polar/webhooks` |
| Public privacy page | `https://kitchenbinder.app/privacy` |
| Public support page | `https://kitchenbinder.app/support` |

Keep localhost settings in local development. Use separate exact origins and
callbacks for staging. Follow [lightsail-neon.md](lightsail-neon.md) for DNS,
certificates and rendering the nginx templates. The templates retain `PUBLIC_HOST`
so the same checked configuration can serve staging and production.

- [ ] Point the domain to the selected host and issue its HTTPS certificate.
  Publish IPv6 only when the host and routing are ready. If serving `www`, configure
  its DNS, certificate and redirect to `https://kitchenbinder.app` too.
- [ ] Set the production origin on web and worker, install the rendered nginx
  configuration and verify redirects retain public page paths and query strings.
- [ ] Update the existing Google and any enabled Discord application's display
  name, homepage, authorised origins, privacy links and exact callback URLs.
- [ ] Create or select a monitored support mailbox, set `SUPPORT_EMAIL` and retain
  an assigned `SUPPORT_OPERATOR`. Buying the domain does not create a mailbox.
  If using this domain for email, configure the mail provider's DNS records and
  test delivery and replies before advertising the address.
- [ ] If billing is enabled, update the existing Polar organisation/product's
  public name, logo, website/support links and webhook destination. Keep existing
  customer, subscription and product IDs. Checkout and portal return URLs already
  derive from `BETTER_AUTH_URL`; complete the provider acceptance checks.
- [ ] Update existing Chrome/Edge store listings with the new name, description,
  screenshots and website/privacy/support links. Build with the store's existing
  public key and retain its ID in `EXTENSION_IDS`. Publish an update to the existing
  listing rather than creating a replacement identity for a name change.

## Preserve existing work during a domain move

Skip this section for a first deployment with no users on an older origin.

Use the existing database and authentication identities. Keep the same session
secret and provider applications unless rotating them for a separate reason.
Users must sign in at the new domain because cookies are scoped to their host.
Their server-saved recipes, groups, planner data and billing records remain.

Website recipe drafts, import request recovery, collection preference and cooking
progress use browser storage. The new origin cannot read the old origin's data,
even when the storage key names stay the same. Ask users to save or copy unsaved
work in their existing tabs before switching. Keep the old installation available
until this recovery is complete; a blanket redirect would hide those drafts.

Extension credentials explicitly include the configured origin. A build pointed
at Kitchenbinder will require reconnection. Pending extension requests and cached
collections are also keyed by origin and account. Reconnection alone does not
move them. Before the extension update, let accepted imports finish and recover
their results through the old build. Save or copy unsent captures and pending
inputs while they are still accessible. Do not rewrite pending request IDs or
move them silently to another origin, which can repeat an import or AI charge.

After recovery, redirect old public page URLs to their equivalent Kitchenbinder
URLs while preserving the path and query string. Plan authentication callbacks
and extension API traffic separately; extension fetches reject redirects and
should use the updated build. No old hostname is hardcoded because none has been
supplied for this release.

## Identifiers retained for compatibility

The repository and `@prep-sheet/*` packages, package filters, environment-variable
names, database names/roles/volumes, migration ledger and applied migration files
stay unchanged. The same applies to systemd paths, image variables, monitoring
labels, browser-storage keys, `pse_` tokens and `X-Prep-Sheet-*` proxy headers.
These identifiers do not appear as the public product name.

The extension's `https://<id>.chromiumapp.org/prep-sheet` callback suffix is also
unchanged. Client and server validate it exactly. Keep existing extension keys,
IDs and allowlists. Routes, API contracts, pricing and data models are unchanged.

Branding assets and the image-generation prompts are documented in
[the branding notes](../output/branding/kitchenbinder-v1/README.md). Historical
reports, prototypes and original Prep Sheet artwork remain historical.

## Acceptance before public launch

- [ ] Verify the website title, social previews, installed-app name, privacy and
  support pages show Kitchenbinder. Check desktop and narrow phone layouts.
- [ ] Open a recipe PDF and verify its logo, readability and Kitchenbinder author.
- [ ] Complete Google and any enabled Discord login, logout and account linking
  on the real HTTPS origin, preserving the same account and saved data.
- [ ] Install each store extension update, reconnect, capture a recipe, save it
  and open the result on Kitchenbinder. Check any retained old-origin work first.
- [ ] Verify support delivery and any enabled Polar checkout, portal return and
  webhook flow. Follow [provider-acceptance.md](provider-acceptance.md).
- [ ] Check old-domain redirects only after browser and extension work is saved.
