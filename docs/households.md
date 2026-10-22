# Households

Households share meal planning and shopping. Recipe collections keep their existing membership and permissions. Joining a household never joins a recipe collection.

## Intended behaviour

- Each account can belong to one household and keeps its personal planner and shopping list.
- The planner and shopping screens share an account-specific selection: Personal or the household name. Collection selection is independent.
- Create a household from the planner or household settings. Start empty or explicitly copy personal meals. Copying leaves personal meals and groceries intact; shopping is generated separately.
- Invitations are private, single-use links that expire after seven days. Acceptance explains what is shared, preserves personal data and opens the shared planner.
- Every member can plan meals and edit groceries. The owner can rename the household, manage invitations and members, transfer ownership, or delete the household with explicit confirmation.
- Planned recipe details are snapshots. Household members can cook from the saved meal without receiving access to the source collection or personal recipe notes, ratings or cooking history.
- Household members use the same meal revisions and shopping preview checks. Stale saves require review. Drafts are isolated by account, planner and tab.
- Membership changes take effect immediately on the server. Removed members cannot read or change household data. Existing shared meals and groceries stay with the household.
- Members can copy upcoming household meals to their personal planner before leaving. Copies use new meal identities, preserve leftover links and do not overwrite existing personal meals.

## Delivery and verification

Use versioned database migrations, preserve existing personal records, and test with the repository's disposable PostgreSQL wrapper. Cover access boundaries, invitations and competing acceptance, membership removal, concurrent partner edits, recipe snapshots, copied leftovers, and separate personal and household shopping lists. Inspect the rendered planner, shopping and household flows at desktop and mobile widths before completion.
