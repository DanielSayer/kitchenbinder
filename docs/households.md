# Households

Households share meal planning and shopping. Recipe collections keep their existing membership and permissions. Joining a household never joins a recipe collection.

## Behaviour

- Each account can belong to one household and keeps its personal planner and shopping list.
- The planner and shopping screens share an account-specific selection: Personal or the household name. Collection selection is independent.
- Create a household from the planner or household settings. Start empty or explicitly copy personal meals. Copying leaves personal meals and groceries intact; shopping is generated separately.
- Invitations are private, single-use links that expire after seven days. Acceptance explains what is shared, preserves personal data and opens the shared planner.
- Every member can plan meals and edit groceries. The owner can rename the household, manage invitations and members, transfer ownership, or delete the household with explicit confirmation.
- Planned recipe details are snapshots. Household members can cook from the saved meal without receiving access to the source collection or personal recipe notes, ratings or cooking history.
- Household members use the same meal revisions and shopping preview checks. Stale saves require review. Drafts are isolated by account, planner and tab.
- Membership changes take effect immediately on the server. Removed members cannot read or change household data. Existing shared meals and groceries stay with the household.
- Members can copy upcoming household meals to their personal planner before leaving. Copies use new meal identities, preserve leftover links and do not overwrite existing personal meals.

The planner and shopping screens use the same stored choice on that device, keyed by account. A new household or accepted invitation selects its shared planner. Each open tab retains its own current choice. Household meal and shopping queries refresh every five seconds while visible; membership refreshes every fifteen seconds and on window focus. The server checks membership on every operation. Lost membership shows an unavailable state with an explicit switch to Personal, rather than redirecting shared edits into a personal planner.

`/household` contains setup and settings. `/join-household#<token>` retains the invitation through sign-in, explains sharing and requires acceptance. Tokens are hashed in the database, expire after seven days and are consumed once. An account can belong to one household; a household supports up to 20 members and 10 active invitations. The existing Pro policy applies to creation, invitations and receiving ownership. Joining and using an existing household remain available after downgrade. Collections retain their existing policy and membership.

Copying meals includes earlier cooking sessions needed by upcoming leftovers. Repeated copying skips the same copied meal identities, retaining later personal edits. Copies do not copy a shopping trip or groceries. Personal and household shopping lists must be generated separately.

Owners must transfer ownership or explicitly delete their household before account deletion can be completed. Account deletion removes a non-owner's membership while keeping shared meals and groceries for the remaining members.

## Delivery and verification

Use versioned database migrations, preserve existing personal records, and test with the repository's disposable PostgreSQL wrapper. Cover access boundaries, invitations and competing acceptance, membership removal, concurrent partner edits, recipe snapshots, copied leftovers, and separate personal and household shopping lists. Inspect the rendered planner, shopping and household flows at desktop and mobile widths before completion.

### Verified locally on 22 October 2026

- `pnpm test`: 63 files passed, one skipped; 475 tests passed and eight skipped. The wrapper removed its disposable PostgreSQL container and volume.
- `pnpm build:release`, `pnpm check-types`, `pnpm check` and `git diff --check` passed. The Drizzle metadata check reported no schema changes.
- Migration tests covered clean provisioning, upgrades from older releases, unversioned adoption and repeated verification. The local development database was migrated and verified; no hosted database was changed.
- Browser checks used a temporary household and a separate fixture partner. Creation, invitation generation and API acceptance, shared recipe method access, duplicating a partner's private recipe, shopping generation, a purchase visible to the partner, personal/shared switching and ownership transfer were exercised.
- A competing grocery edit retained the user's draft, disabled Save until review and survived reload. Remote removal showed Household unavailable and required an explicit switch to Personal.
- Layouts were checked at 1280, 390 and 320 pixels. The temporary household, fixture partner, recipe and dependent shared data were removed afterwards; existing personal meals and groceries were preserved.

Invitation return through real Google or Discord sign-in was not exercised. No production deployment, paid AI calls, payments or external invitation delivery formed part of these checks.
