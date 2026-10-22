# Meal planner

`/planner` shows a Monday-to-Sunday week, with stacked days on small screens. Each account keeps its personal meals and active shopping trip. An optional [household](households.md) has a separate shared planner and shopping list. The selector on the planner and shopping screens chooses which one is active. Recipe collection membership is independent.

Add recipes, linked leftovers or eating-out entries. Recipes have original servings, servings to cook and servings to eat now. The difference is available for leftovers. Each cooking session counts separately, even when the same recipe appears more than once. Leftovers refer to a previous date; missing sessions and over-allocated portions are flagged and block shopping generation for affected dates. Editing the meal date moves it. Duplicate creates a separate session. Unfinished meal forms are stored locally per account; Cancel discards the draft and closing the dialog retains it.

Make shopping list defaults to the week currently being viewed. Change dates selects an inclusive range of meal dates, up to 32 days, without a separate shopping-date input. Review ingredients shows included meals, ingredient changes and uncertain quantities before saving. Saving preserves unchanged items, manual groceries and bought/owned quantities, including when choosing a different week. Quantity increases add only the extra amount required. Removed meals keep bought/owned ingredients as surplus and remove their unbought ingredients. Meals included in the saved list show an On list label on their cards.

Recipe ingredients, title, description, method and yield/timings are copied when scheduled. Recipe notes, ratings and cooking history are excluded. Open a meal title to cook from its saved details, even without access to the source collection. Older meals retain their saved ingredients and explicitly say when no method was saved. Subsequent recipe edits or deletion do not silently rewrite planned meals. Original serving counts must be confirmed when a yield is ambiguous. Leading numeric quantities, fractions and mixed fractions can be scaled; ranges and unspecified quantities receive a visible check-quantity note. This is quantity scaling, not unit conversion or pantry inventory.

Only ingredient-affecting changes make a trip stale. Moving a meal within its coverage, changing the eating-out description or changing the portions eaten without changing cooking quantities does not. Moving a recipe into/out of coverage, changing recipes or changing its cooking scale does. The planner and shopping screens show a Review list action when meals change instead of a permanent trip summary. Stale meal trips cannot be regenerated or checked off through the older shopping actions.

Personal operations use the account lock. Household operations and membership changes use the household lock and check current membership before reading or writing. Planner revisions protect competing meal edits. Applying a preview checks a server-computed token against both planner state and current shopping rows. A concurrent meal edit, purchase or grocery edit requires another preview. No change is applied before that check passes. Open meal drafts retain their original baseline in tab storage, keyed by account and planner. Grocery text drafts also retain their baseline and ask for review when another person changes the item.

## Database setup

The versioned schema includes `meal_planner`, with personal or household ownership, revision, JSON meal entries and the active trip snapshot. Migration `0006_households.sql` preserves existing personal meals and groceries while adding household ownership; `0007_household_constraint_names.sql` aligns constraint names with generated schema metadata. With the direct migration credential injected as `DATABASE_URL`, run `pnpm db:migrate` and `pnpm db:verify` while web and worker are stopped, then start both from the same candidate image with runtime credentials. An unversioned database needs a backup, restored-copy rehearsal and explicitly reviewed `pnpm db:adopt`, followed by verification. Follow the [deployment runbook](deployment.md); schema push is not a deployment step. Resetting the selected shopping list clears only that planner's active-trip link, retaining its meals.

## Verification

```sh
pnpm build:release
pnpm check-types
pnpm test packages/api/src/planner.integration.test.ts packages/api/src/households.integration.test.ts
```

Run from the repository root. The build generates web routes before type checking on a clean checkout. The `pnpm test` wrapper provisions and removes a disposable PostgreSQL 18 database; never invoke Vitest directly or use the development/production database. The planner integration suite creates isolated accounts and cleans them up. It covers authentication, recipe access, privacy, competing edits, repeated cooking sessions, leftover validation, stale previews, preserving groceries and purchased portions, removing covered meals, empty trips and resetting the active-trip link.
