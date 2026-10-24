# Account and support operations

## Launch configuration and acceptance

Inject `SUPPORT_EMAIL` as a single monitored public mailbox and `SUPPORT_OPERATOR`
as the responsible person or rota identifier. The mailbox is public. The operator
value stays on the server and in private CLI output. Do not put credentials in
either field. Both are required by production web and worker startup, even when
billing is disabled. Compose forwards them explicitly. Changing the mailbox
requires a process restart, not a rebuild. The runtime validator rejects malformed
addresses and mailto query/header injection; it cannot prove anyone reads mail.

Development and test may leave both empty. The support page then says the contact
is not configured in that environment and renders no email link. A configured
mailbox appears on the public `/support` page without requiring sign-in and in
Settings > Report a problem. In-app reports stay in PostgreSQL. There are no
external notifications, automatic replies or response-time promises.

Before opening public access, record these decisions in the private deployment
record. An unset value is a launch blocker, not permission to publish a placeholder:

- The actual mailbox, its monitoring owner, backup cover and access instructions.
- The `SUPPORT_OPERATOR` value, queue review cadence, escalation contact and cover
  for absence. Review both queues at least each working day; choose and document
  any tighter operating commitment before advertising it.
- Evidence that the chosen mailbox receives an authorised external test and that
  the owner can read and reply. This task does not send mail. A successful startup
  or a rendered link is not evidence of delivery or a response.
- The deployed signed-out support link and the signed-in report/reference flow.
- Support-record, provider and backup retention decisions. The privacy page only
  describes live-database removal. Do not publish an erasure deadline until those
  arrangements are known.

Apply and verify versioned migrations with the selected release. Follow
[initial provisioning](deployment.md#initial-provisioning) for a new database or
[adoption of an existing installation](deployment.md#adopt-an-existing-installation)
for a reviewed unversioned database. Use `pnpm db:migrate` and `pnpm db:verify` as
that runbook directs. Never use `db:push` on a deployed installation.

## Review and assign the queues

Run from the repository root with the correct runtime database and operator
configuration injected. Local commands below load `apps/web/.env`; on a host with
injected environment, omit `--env-file`. Use a restricted operator session. Never
paste queue output into public logs or PRs; it contains emails and report text.

```sh
node --env-file=apps/web/.env --import tsx packages/api/src/support-admin.ts list
node --env-file=apps/web/.env --import tsx packages/api/src/support-admin.ts list --offset 100
```

Each response identifies the configured owner, total report/deletion counts and
up to 100 of each queue, oldest first with stable reference ordering. Inspect
`createdAt` to identify overdue work. Increase the offset by 100 to read later
pages. These are live pages, not a snapshot: list again from offset zero after
resolving items so removals cannot hide work. If the command fails, ownership
includes fixing database/configuration access and escalating the missed review.

`SUPPORT_OPERATOR` owns both queues by default. Record individual handoffs by exact
request reference in the team's private support register, with assignee, review
date, next action and next review date. The register and cover rota are operator
choices, not an automated dispatch system. Changing this value does not establish
an identity or grant database access. CLI access still requires the host/database
credentials. Keep the private register under the chosen retention policy.

For a report, read the message, reproduce the issue when possible and reply through
the selected mailbox only when authorised. Reports are limited to five per account
per hour and users see their most recent 20. When handling is complete and the
support retention policy permits removing the original message, resolve the exact
report:

```sh
node --env-file=apps/web/.env --import tsx packages/api/src/support-admin.ts resolve-report <report-id> --confirm
```

Resolution deletes that report row and removes it from user history. Record any
necessary outcome in the private register first, without copying unnecessary
personal content. A missing reference fails rather than resolving another item.
The command emits only the reference and configured operator on success. There is
no automatic retention job and no per-report status or assignment table.

## Complete a deletion request

1. Inspect the pending reference and account email. An in-app request is already
   tied to the signed-in account. For signed-out mailbox requests, establish account
   ownership through the approved support process before taking account action.
   Never ask for a provider password or sign-in code.
2. Explain what happens to households they own: each shared household passes to
   its longest-standing other member; a household with no other members is
   deleted. The app's deletion panel lists both. Owners may transfer or delete
   households themselves first.
3. Explain that recipes shared with a household (other than "Just me") remain
   there without an owner, and other people's copies remain. Resolve specific
   requests about personal details in shared recipe text before completion.
4. Ask the user to cancel Pro and wait for paid/trial access to end. Wait for any
   pending checkout to expire too. Restore Polar configuration/connectivity if it
   is unavailable. Never clear billing rows, shorten checkout expiry or mark a
   subscription free to bypass a failure. A cancellation scheduled for period end
   is still unresolved until it ends. Check the provider when diagnosing a block.
5. Record the reviewed reference and execute the operator-only command:

```sh
node --env-file=apps/web/.env --import tsx packages/api/src/support-admin.ts complete-deletion <request-id> --confirm
```

The transaction locks the exact pending request and account. It refuses
unresolved billing and a checkout whose expiry is future or unknown. A
billing history or attempted checkout triggers authoritative Polar state and
subscription checks even if the local customer ID is missing. Configuration or
provider failure rolls back all deletion work and leaves the request pending for
retry. The command never cancels a subscription or checkout on the user's behalf.

Cancellation and completion serialise on the request row. If cancellation takes
the lock first, completion fails with no pending request and preserves the account.
Once completion has taken the lock, cancellation waits and cannot reverse the
committed deletion. Re-list the queue after any failure; retry only the same still
pending reference after the underlying block is resolved. A recreated request has
a new reference. A completed or cancelled reference cannot be processed again.

Successful completion transfers or deletes owned households (above), deletes
"Just me" with its plan and shopping list, removes every recipe not shared with a
household, including Recently deleted, and the account. Foreign keys remove
sessions, provider tokens, imports, collections, tags,
activity, memberships and support requests. Shared recipes keep their content and
shares with the owner link removed; nobody can edit them, and they are removed if
their last household is deleted. Shopping items they added remain without
attribution. Independent copies remain. Keep only the minimal operational
record permitted by the retention policy; the CLI success record contains the
reference and operator, not a copy of the deleted account's email or content.

Deletion does not remove the Google/Discord account, erase device browser storage,
recall prior provider processing or erase backups. Signing in again creates a new
Kitchenbinder account. Follow the production backup/provider retention arrangements
separately.

## Disposable rehearsal and verification

Review existing coverage before adding tests. Run all database tests only through
`pnpm test`, which provisions versioned migrations on a disposable PostgreSQL 18
container and removes it in `finally`. Never use the development database.

```sh
pnpm test packages/env/src/support.test.ts packages/api/src/support.integration.test.ts packages/api/src/support-deletion.integration.test.ts
```

The rehearsal exercises report privacy/rate limits, exact-reference CLI resolution,
household transfer and deletion, personal-data deletion with
shared-recipe retention, both request-cancellation lock orderings, missing billing
configuration, outages during both provider state and subscription reads,
unresolved subscription states without a local customer ID, and expired-checkout
recovery. Polar responses are simulated at SDK boundaries. Test addresses use the
reserved `.test` domain; no real mailbox, user, payment or notification is contacted.
The production-server smoke check also checks the runtime mailbox in signed-out
HTML and confirms the private operator value is absent.

These checks do not establish a monitored production mailbox, delivery, operator
response or live Polar acceptance. Record that external evidence for the selected
immutable release before public launch. The original September support validation
is historical; use the current release checks rather than its obsolete failure list.
