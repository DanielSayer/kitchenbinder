# Kitchenbinder rebrand and domain cutover

The public product name is Kitchenbinder and the production origin is
`https://kitchenbinder.app`. The code and artwork use the new name. This checklist
records the deployment and provider work needed before launch. It does not imply
that DNS, mailboxes, provider consoles or a live deployment have been configured.

## Production configuration

| Setting | Production value |
| --- | --- |
| Web and worker `BETTER_AUTH_URL` | `https://kitchenbinder.app` |
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

After recovery, redirect old public page URLs to their equivalent Kitchenbinder
URLs while preserving the path and query string. Plan authentication callbacks
separately. No old hostname is hardcoded because none has been supplied for this
release.

## Identifiers retained for compatibility

The `@prep-sheet/*` packages, package filters, environment-variable
names, database names/roles/volumes, migration ledger and applied migration files
stay unchanged. The same applies to systemd paths, image variables, monitoring
labels, browser-storage keys and `X-Prep-Sheet-*` proxy headers.
These identifiers preserve existing data and installations. The repository,
root package metadata and container package use Kitchenbinder.

Branding assets and the image-generation prompts are documented in
[the branding notes](../output/branding/kitchenbinder-v1/README.md). Historical
reports, prototypes and original Prep Sheet artwork remain historical.

## Repository and package cutover

The canonical names are `DanielSayer/kitchenbinder`
and `ghcr.io/danielsayer/kitchenbinder`. Internal workspace package names and
installed host paths remain compatible with existing installations.

1. Set the repository description, About website `https://kitchenbinder.app` and
   recipe/meal-planning topics. Keep the repository's existing visibility.
2. Before the rename, apply `deploy/github-oidc-trust.json` to the existing
   `KitchenbinderGitHubDeploy` role. It accepts only the old and new exact
   repository subjects, with the same immutable owner/repository IDs, audience
   and `production` environment. It does not grant additional AWS actions.
   Record the actual GitHub subject using
   `gh api repos/DanielSayer/prep-sheet/actions/oidc/customization/sub`.
3. Merge the branding change and let the existing release checks publish the
   tested image under the new package name and the old compatibility name. Both
   references must have the same digest. The existing installed helper can
   continue pulling the old alias while its replacement is installed.
4. Install the reviewed `deploy/release.sh` root-owned, mode 0755, at
   `/usr/local/sbin/prep-sheet-release`. Keep its filename, forced-command SSH
   account, sudoers rule and configuration paths unchanged. Run the deployment
   workflow with `dry_run=true` to verify the new package and helper without
   restarting services or running migrations.
5. Rename the existing repository to `kitchenbinder` rather than creating a new
   repository. Update local remotes to
   `https://github.com/DanielSayer/kitchenbinder.git`. Re-read the OIDC subject
   prefix at the renamed repository and confirm that the installed IAM trust
   policy matches it. Check the next deployment's authentication and image pull.
6. Once every deployed helper uses the new package, set the repository Actions
   variable `PUBLISH_LEGACY_IMAGE=false` to retire the compatibility publisher.
   In the new container package settings, confirm its repository connection and
   intended visibility. After accepting the new package and helper, remove the
   old package's repository connection if it should no longer appear in the
   repository sidebar. Retain its versions for rollback; do not delete the
   package as part of the rename. The GitHub CLI token may need package scopes
   for package settings, independently of repository administrator access.

The repository rename redirects old GitHub repository links, but package image
names do not follow that redirect. The compatibility publisher stays enabled
unless `PUBLISH_LEGACY_IMAGE` is explicitly `false`. Keep it enabled until all
deployed helpers use the canonical Kitchenbinder package.

## Acceptance before public launch

- [ ] Verify the website title, social previews, installed-app name, privacy and
  support pages show Kitchenbinder. Check desktop and narrow phone layouts.
- [ ] Open a recipe PDF and verify its logo, readability and Kitchenbinder author.
- [ ] Complete Google and any enabled Discord login, logout and account linking
  on the real HTTPS origin, preserving the same account and saved data.
- [ ] Verify support delivery and any enabled Polar checkout, portal return and
  webhook flow. Follow [provider-acceptance.md](provider-acceptance.md).
- [ ] Check old-domain redirects only after browser work is saved.
