# Households, recipes and collections

Design reference: `docs/design/pantry.html` (Pantry design system). Where the mock and this doc differ, this doc wins.

## Model

- **Household = tenancy.** Users belong to many households. Meal plan and shopping list are scoped per household. Every user owns exactly one personal household named "Just me" (`household.personal = true`). It cannot be deleted, left, renamed away from personal semantics, or invited into. Former "groups" are households.
- **Household colour.** `household.color` is one of `tomato | olive | butter | plum | sage` (default chosen round-robin; "Just me" = `sage`). Used for the header chip and markers.
- **Recipes are personal.** `recipe.user_id` is the owner. Recipes are shared by granting a household access (`recipe_share`). Share targets are households only (sharing with one person = a household with them).
- **Collections are personal.** A collection is a curated, ordered recipe grouping owned by a user (`collection`, `collection_recipe`). Separate from tags: tags say what a recipe is, collections say why you keep it. Collections are shared with households (`collection_share`).
- **Tags are personal** to the recipe owner. A recipe shows its owner's tags; others with access see them read-only.
- Favourites, ratings and cooking history stay per user.

## Recipe access

A user can access a non-deleted recipe when any of:

1. they own it;
2. it is shared with a household they belong to;
3. it is in a collection shared with a household they belong to **and** the recipe owner is the collection owner (no transitive re-sharing of others' recipes).

Only the owner edits, deletes, tags or shares a recipe. A household member may add any accessible recipe to their own collections, plan and shopping list. Collection owners may add any recipe they can access to their collection; others see only entries they can access.

## Migration (0008)

`0006_households.sql` and `0007_household_constraint_names.sql` are published
history and remain unchanged. `0008_pantry_households.sql` upgrades that history
to the current model. Existing shared planner households stay separate from
former recipe groups, retaining their IDs, members, invitations, meal snapshots,
revisions, trips, shopping items and generated shopping plans. A user can retain
membership in both, as well as their new personal household.

- Copy `group`/`group_member`/`group_invite` into the existing household tables, preserving IDs, timestamps and invitation states. Add `personal`, `color` and membership in multiple households. Remove the old group tables after converting their dependent records.
- Create a personal "Just me" household (owner + member) for every user.
- Group-owned recipes become owned by their creator (`user_id`); if the creator is gone, the group owner. Each is shared with that household. Drop `recipe.group_id`.
- Group tags: for each recipe owner of a tagged recipe, merge into that owner's personal tag with the same `lower(name)` (create if missing) and repoint `recipe_tag`. Drop `tag.group_id`.
- Personal meal planner and shopping records move from `user_id` to `household_id` = the user's personal household. Existing shared records keep their `household_id`. Personal shopping items keep their former `user_id` as `added_by`; historical shared items have no recorded author and retain null attribution.
- `recipe_import.group_id` → `household_id` (= share with that household on save). Add nullable `collection_id` (= add to that collection on save).
- No collections exist before the migration.

## UX

- Household is a global context: header chip "Family ▾" (household colour) opens a bottom sheet to switch/manage households. Scopes Plan and Shop. Hidden when the user has only one household. Selection persists per device (localStorage) and falls back to "Just me".
- Recipes tab: binder-divider tabs are collections: `All · <collection> … · +`. "All" = every recipe the user can access. List/grid toggle stays.
- Add meal / add to list can pick any accessible recipe.
- Mobile first: bottom tab bar (Add, Recipes, Shop, Plan, You), bottom sheets instead of pages/menus, undo toasts instead of confirms, sticky CTAs. Desktop still works.

## Implementation notes

- Access predicate: `packages/api/src/households/access.ts` (`recipePermission`, `accessibleRecipe`, `ownedRecipe`, `visibleCollection`). Placement on save (share + collection): `households/placement.ts`.
- "Just me" is created by the better-auth user-create hook and lazily (idempotently) by `ensurePersonalHousehold` (`packages/db/src/households.ts`) from `households.list` and any planner/shopping call without `householdId`. Sharing with "Just me" is rejected by `share` procedures and ignored for saves.
- Planner/shopping procedures take optional `householdId`; omitted = "Just me". Membership is checked and writes take a household row lock.
- Imports and manual saves take optional `householdId` (share on save) and `collectionId` (the caller's collection, appended). Lost access before saving fails the import, as before. The extension sends `householdId`; legacy `groupId` is still accepted.
- Leaving or being removed from a household keeps the shares you made there; unshare to withdraw. Owners must transfer ownership or delete before leaving. Deleting a household removes shares, plan and list; recipes stay with their owners (orphaned recipes shared only there are deleted).
- Account deletion: owned shared households pass to the longest-standing other member, or are deleted when empty. "Just me" is deleted with its plan and list. Recipes shared with a household survive with `user_id` null (read-only); all other owned recipes, collections and tags are deleted. Shopping items keep `added_by` null.
