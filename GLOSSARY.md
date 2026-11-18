# Context

Words for recipes, meal plans and shopping lists in Kitchenbinder.

## Language

- **Ingredient line**: One line of a recipe's ingredient list as written, plus its parse: what to buy, how much and in what unit, or that the line is a heading. The written text stays the source of truth.
  _Avoid_: ingredient string, ingredient row, item text
- **Scale factor**: How many times the recipe's amounts a cook needs, from servings wanted over the recipe's base servings. An ingredient line reads the same at a scale factor on the recipe page and the shopping list.
  _Avoid_: multiplier, ratio, portion factor
- **Import**: One request to turn a website or photos into recipes. It is admitted, waits in a queue, then saves its recipes or fails.
  _Avoid_: job, request
- **Checkpoint**: The recipes an import generated, stored before they are saved. A failed save tries again from the checkpoint.
  _Avoid_: draft
- **AI attempt**: One model call that counts against an account's limits, whether or not it produces a recipe.
  _Avoid_: generation, credit use
