# Personal meal planner

`/planner` shows a Monday-to-Sunday week, with stacked days on small screens. Each account owns its meals and one active shopping trip. Shared-collection recipes can be scheduled, but the planner is private.

Add recipes, linked leftovers or eating-out entries. Recipes have original servings, servings to cook and servings to eat now. The difference is available for leftovers. Each cooking session counts separately, even when the same recipe appears more than once. Leftovers refer to a previous date; missing sessions and over-allocated portions are flagged and block shopping generation for affected dates. Editing the meal date moves it. Duplicate creates a separate session. Unfinished meal forms are stored locally per account; Cancel discards the draft and closing the dialog retains it.

Make shopping list defaults to the week currently being viewed. Change dates selects an inclusive range of meal dates, up to 32 days, without a separate shopping-date input. Review ingredients shows included meals, ingredient changes and uncertain quantities before saving. Saving preserves unchanged items, manual groceries and bought/owned quantities, including when choosing a different week. Quantity increases add only the extra amount required. Removed meals keep bought/owned ingredients as surplus and remove their unbought ingredients. Meals included in the saved list show an On list label on their cards.

Recipe ingredients and titles are copied when scheduled. Subsequent recipe edits or deletion do not silently rewrite planned meals. Original serving counts must be confirmed when a yield is ambiguous. Leading numeric quantities, fractions and mixed fractions can be scaled; ranges and unspecified quantities receive a visible check-quantity note. This is quantity scaling, not unit conversion or pantry inventory.

Only ingredient-affecting changes make a trip stale. Moving a meal within its coverage, changing the eating-out description or changing the portions eaten without changing cooking quantities does not. Moving a recipe into/out of coverage, changing recipes or changing its cooking scale does. The planner and shopping screens show a Review list action when meals change instead of a permanent trip summary. Stale meal trips cannot be regenerated or checked off through the older shopping actions.

Planner writes use account-scoped locks and revisions. Applying a preview checks a server-computed token against both planner state and current shopping rows. A concurrent meal edit, purchase or grocery edit requires another preview. No change is applied before that check passes.

## Database setup

The versioned schema includes `meal_planner`, with account ownership, revision, JSON meal entries and the active trip snapshot. With the direct migration credential injected as `DATABASE_URL`, run `pnpm db:migrate` and `pnpm db:verify` while web and worker are stopped, then start both from the same candidate image with runtime credentials. An unversioned database needs a backup, restored-copy rehearsal and explicitly reviewed `pnpm db:adopt`, followed by verification. Follow the [deployment runbook](deployment.md); schema push is not a deployment step. Resetting the shopping list also clears the active planner-trip link, while retaining planned meals.

## Verification

```sh
pnpm build:release
pnpm check-types
pnpm test packages/api/src/planner.integration.test.ts
```

Run from the repository root. The build generates web routes before type checking on a clean checkout. The `pnpm test` wrapper provisions and removes a disposable PostgreSQL 18 database; never invoke Vitest directly or use the development/production database. The planner integration suite creates isolated accounts and cleans them up. It covers authentication, recipe access, privacy, competing edits, repeated cooking sessions, leftover validation, stale previews, preserving groceries and purchased portions, removing covered meals, empty trips and resetting the active-trip link.
