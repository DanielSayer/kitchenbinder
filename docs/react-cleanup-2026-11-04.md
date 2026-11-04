# React state and component cleanup

This branch starts at `742ba3b` on `origin/master`. It preserves product behaviour, markup, styles, API contracts, storage formats, and retry identities. It adds no dependencies.

## State ownership

- Recipe editing uses `recipe-editor-state.ts` for draft fields, their baseline and revision, save status, and conflict-review transitions. `recipe-conflict-review.tsx` owns the review presentation and focus. Storage access and save orchestration remain outside the reducer.
- Meal editing uses `meal-editor-state.ts` for recipe selection, search/note changes, servings defaults, review choices, and draft rebasing. `use-meal-draft.ts` owns servings parsing and new/edit defaults, persistence, and save orchestration, including fetching the current plan before merging. Details and conflict review have separate components.
- Library selection uses `use-library-selection.ts` for selected IDs, selection mode, collection scope, and the target collection. Leaving a collection clears the selection. Picking recipes on All retains the destination until selection ends or another collection is opened.
- Shopping queries and optimistic mutations live in `use-shopping-items.ts`. The query cache remains the source of server data. Quick-entry text and its retry ID update together. Swipe rows, item editing, and pure grocery grouping have separate files.
- Photo preparation and thumbnail URL ownership live in `use-import-photos.ts`, using ordinary local state for photos, preparation status, and errors. The composer still owns queue admission and durable request IDs. The ready recipe and its sheet-open state update together.
- Household invite controls and ownership forms have their own files. Household management still owns its existing cache updates, undo callbacks, and navigation.

TanStack Query already owns server state. These changes use local reducers for local workflows; they do not introduce a second cache or a global store.

## Effects

Library search handles typing and its debounce in the change handler. A guarded render update reconciles external URL changes without an effect that copies search state after the commit. The timer cleanup effect remains.

Import destination choices reset when the saved placement changes. A guarded render update replaces the prop-copying effect and its JSON parse/type assertion. A refetch with unchanged placement retains the user's choices.

Effects that synchronise browser resources remain: tab draft restoration/persistence, unload warnings, focus, thumbnail cleanup, and gesture timer cleanup. The meal editor still fills servings after its selected-recipe query resolves. Cook timers, wake locks, installation listeners, and modal focus/scroll handling were inspected and left with their existing browser lifecycle effects.

The render guards follow React's documented approach to [adjusting local state when an input changes](https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).

## Regression checks

Existing recipe and meal tests cover restored drafts, baseline revisions, independent changes, competing edits, failed saves, and racing saves. Existing composer tests cover queue recovery, destinations, and photo submissions.

Added regression tests cover:

- Meal recipe changes, preserving custom portions and the original baseline, new and duplicate meal defaults, and opening details for ambiguous servings.
- Quick-entry retry IDs and preserving newer typing after success or failure.
- Library selection resets and preserving a destination while choosing recipes on All.
- Search debouncing, URL navigation, and cancelling pending searches on unmount.
- Keeping destination choices across unchanged refetches and resetting them after saved placement changes.
- Releasing thumbnail URLs on removal, replacement, and unmount, retaining picked photos when another file fails preparation, and ignoring conversions that settle after unmount without starting the next file or creating new thumbnail URLs.

Rendered interactions are exercised in jsdom. No manual browser or device verification is claimed.

Validation completed:

- `pnpm test`: 80 test files passed, one skipped; 682 tests passed, eight skipped.
- `pnpm check-types`: root and every TypeScript package passed.
- `pnpm check`: all 440 checked files passed.
- `pnpm --filter web build`: client and server production artifacts built successfully.
- `git diff --check origin/master`: passed.

Review follow-up verification:

- Photo hook and composer suites: 23 tests passed, including conversions that resolve or reject after unmount. Deferred conversion is mocked; no device conversion check is claimed.
- Planner suites: 17 tests passed, including recipe selection, servings defaults, and draft-baseline preservation.
- `pnpm --filter web check-types`, `pnpm check`, the web production build, and `git diff --check` passed.
