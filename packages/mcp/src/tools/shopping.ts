import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { householdScope, retryId, textLines } from "./schemas";
import { behaviour, defineTool } from "./tool";

export const getShoppingList = defineTool({
  name: "get_shopping_list",
  description:
    "Read a household's shopping items and their IDs, original text, status and recipe attribution. Status needed means still to buy, bought means checked off, owned means already at home.",
  input: z.object(householdScope),
  annotations: behaviour.read,
  async run({ householdId }, { api }) {
    const items = await api.shopping.list({ householdId });
    const needed = items.filter((item) => item.status === "needed").length;
    return {
      summary: `${needed} item(s) still needed, ${items.length} in total.`,
      data: { items },
    };
  },
});

/**
 * Stable UUID for one line of a batch. Binding the request, position and text
 * means an identical retry recovers the same items while a changed line gets
 * a new ID.
 */
function batchItemId(requestId: string, index: number, text: string) {
  const hex = createHash("sha256")
    .update(JSON.stringify([requestId, index, text]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const addShoppingItems = defineTool({
  name: "add_shopping_items",
  description:
    "Add free-text ingredient or shopping lines, such as '6 eggs' or '500 g plain flour'. Kitchenbinder parses quantities and units. All lines are added together or none are. Supply a stable requestId to make identical retries safe; retry the unchanged full input with the same requestId.",
  input: z.object({
    ...householdScope,
    items: textLines,
    requestId: retryId(
      "Reuse for an identical retry. Use a new ID for a different request.",
    ),
  }),
  annotations: behaviour.create,
  cost: ({ items }) => items.length,
  async run({ householdId, items, requestId = randomUUID() }, { api }) {
    const lines = items.map((text, index) => ({
      id: batchItemId(requestId, index, text),
      text,
    }));
    await api.shopping.addLines({ householdId, lines });
    return {
      summary: `${lines.length} shopping item(s) added.`,
      data: { requestId, items: lines },
    };
  },
});

export const checkOffShoppingItem = defineTool({
  name: "check_off_shopping_item",
  description:
    "Mark one existing shopping item as bought, or set bought=false to put it back on the needed list. Get the item ID from get_shopping_list. Repeating the same status is safe.",
  input: z.object({
    ...householdScope,
    itemId: z.uuid(),
    bought: z.boolean().default(true),
  }),
  annotations: behaviour.update,
  async run({ householdId, itemId, bought }, { api }) {
    const status = bought ? "bought" : "needed";
    await api.shopping.updateItem({
      householdId,
      id: itemId,
      kind: "status",
      status,
    });
    return {
      summary: bought ? "Item checked off." : "Item returned to the list.",
      data: { itemId, status },
    };
  },
});

export const addRecipeToShoppingList = defineTool({
  name: "add_recipe_to_shopping_list",
  description:
    "Copy a saved recipe's ingredient lines to the household shopping list with recipe attribution. Existing items from that recipe are kept and repeated additions do not duplicate them. Uses the recipe's original servings; it does not generate a meal-plan shopping trip.",
  input: z.object({ ...householdScope, recipeId: z.uuid() }),
  annotations: behaviour.update,
  async run({ householdId, recipeId }, { api }) {
    await api.shopping.addRecipes({ householdId, recipeIds: [recipeId] });
    return {
      summary: "Recipe ingredients added to the shopping list.",
      data: { recipeId },
    };
  },
});
