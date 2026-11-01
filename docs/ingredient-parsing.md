# Ingredient parsing

Recipes keep their ingredient lines as written. Alongside them, `recipe.ingredient_data` stores each line's structure: quantity, range, unit, package size, item, detail (preparation, size, notes) and whether it is optional. The server derives it; clients never send it. Shopping items copy their line's structure into `shopping_item.ingredient` when added.

`3 cloves garlic, finely sliced`, `3 cloves of garlic, crushed` and `3 garlic cloves, minced` all become 3 × clove of `garlic`, so the generated shopping list shows 9 cloves.

## Where structure comes from

- **AI imports** return structured ingredients with the recipe (`ingredientDetails`). Results are matched to lines by position and validated. A quantity the line never states, an invalid value or a mismatched count falls back to the code parser.
- **Manual recipes and edits** use the code parser in `packages/db/src/ingredients.ts`. Unchanged lines keep their earlier result, including AI results. The parser returns null when unsure (alternatives, "plus extra", loose amounts).
- **Background AI** reads lines the code parser couldn't, plus every recipe saved before this feature (the backfill). Lines the AI has tried are final and are not retried.

The unit table is shared by parsing, scaling and shopping totals. Cups and spoons default to Australian sizes (250 ml cup, 20 ml tablespoon); `unitBase` also has US sizes for a future user preference.

## Background parsing

Recipes waiting for the AI have `ingredients_pending_at` set. Saves that leave an unreadable line set it and wake the worker. The worker parses one recipe at a time in idle time, after imports. A claim moves the timestamp 15 minutes ahead as a lease, so a crash or provider failure retries after the lease. A provider failure makes the worker wait instead of moving on. An edit made while the AI is working wins: results are saved only if the recipe revision is unchanged.

Background parsing only runs when AI is enabled (`AI_ENABLED`/`OPENAI_API_KEY`). With AI off, unreadable lines stay unparsed and appear on their own on the shopping list, as before. Logs: `ingredients_parsed` and `ingredients_parse_failed`, with recipe IDs and counts only.

Background calls are not counted against the import AI budget. One call sends a recipe's unreadable lines (all lines for the backfill) with a short system prompt and returns about 60 tokens per line. At the reviewed `gpt-6-luna` price that is well under US$0.01 per recipe.

## Deployment

Migration `0014_ingredient_data` adds the columns and flags every existing recipe for the backfill. Run it as described in the [deployment runbook](deployment.md). After startup, the worker works through existing recipes during idle time.

## Verification

```sh
pnpm test packages/db/src/ingredients.test.ts packages/db/src/shopping-plan.test.ts
pnpm test packages/api/src/recipes/ingredient-data.test.ts packages/api/src/recipes/ingredient-parsing.integration.test.ts
```
