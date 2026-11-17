# Context

Words for recipes, meal plans and shopping lists in Kitchenbinder.

## Language

- **Ingredient line**: One line of a recipe's ingredient list as written, plus its parse: what to buy, how much and in what unit, or that the line is a heading. The written text stays the source of truth.
  _Avoid_: ingredient string, ingredient row, item text
- **Scale factor**: How many times the recipe's amounts a cook needs, from servings wanted over the recipe's base servings. An ingredient line reads the same at a scale factor on the recipe page and the shopping list.
  _Avoid_: multiplier, ratio, portion factor
