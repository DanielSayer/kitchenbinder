# Planner meal suggestions

Extends the [household meal planner](meal-planner.md).

## Problem

Deciding what to cook is slow; entering meals is not. Suggestions help a household pick dishes it rates highly or has not had in a while.

## Placement

Only in the planner's add-meal sheet, in the dish step, before the user types. Typing switches to the normal search. Picking a suggestion behaves exactly like picking a search result (servings, Review details and so on stay the same).

## Pool

- Recipes the caller can access (the same set as the dish picker), narrowed to the selected collection when a collection filter is active.
- Exclude recipes already planned in the viewed week. Adding a meal removes it from the rows straight away.
- Exclude recipes with a household rating below 2.5.
- At most 2000 accessible recipes are considered.

## Household signals

- **Last had**: the more recent of the latest household planner meal dated before the viewed week and the latest cook-log entry (`recipe_cooking`) by any household member.
- **Rating**: average of household members who rated the recipe, falling back to the caller's own rating.
- **Favourite**: favourited by any household member.

In "Just me" these reduce to the caller's own data.

## Rows

A recipe appears in one row only; the first matching row wins. Each card states why it appears, e.g. "★4.5 · last had 6 wks ago".

1. **Favourites you haven't had lately**: rated 4+ or favourited, not had in 3+ weeks.
2. **Forgotten**: not had in 2+ months, any rating.
3. **Never tried**: never planned or cooked, even if rated.

Thresholds are fixed in v1, not settings.

## Variety

- Weighted shuffle over each row's top ~15 candidates, showing 6. Older and higher-rated recipes are more likely to appear.
- Seeded per household and week, so the rows stay stable while the user plans a week and rotate the next. A Shuffle action rerolls the seed.
- Soft tag cap: at most 2 cards per tag in each row, using any tag on the recipe. This does nothing for untagged recipes.

## Few recipes

Rows always show. A row with too few candidates shows one card fewer and ends with an "Import recipes" nudge card.

## Out of scope (v1)

- Copying a previous week or day (Duplicate already covers repeating a meal).
- Auto-planning a whole week.
- AI auto-tagging (cuisine, main protein) to improve the tag cap.
- User-adjustable thresholds.
- Suggestions outside the planner.

## Implementation

`planner.suggestions` (`packages/api/src/recipes/suggestions.ts`) loads signals for up to 2000 accessible recipes and the household plan. Ranking, the seeded shuffle and the tag cap are pure (`packages/api/src/recipes/suggest.ts`). The client sends `today` and the viewed week's start, which follows the user's week-start preference. The rows (`apps/web/src/components/planner/suggestion-rows.tsx`) refresh with the planner query when a meal is saved.

```sh
pnpm test packages/api/src/recipes/suggest.test.ts
pnpm test packages/api/src/planner.integration.test.ts
pnpm test apps/web/src/components/planner
```
