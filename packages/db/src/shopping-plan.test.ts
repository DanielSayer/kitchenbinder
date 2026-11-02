import { describe, expect, it } from "vitest";
import {
  categoriseGrocery,
  combinedQuantity,
  generateShoppingPlan,
  groceryGroup,
  parseGrocery,
} from "./shopping-plan";

describe("shopping categories", () => {
  it.each([
    ["2 onions", "Produce"],
    ["200g chicken breasts", "Meat & seafood"],
    ["oat milk", "Dairy & eggs"],
    ["toilet paper", "Cleaning & household"],
    ["dishwashing liquid", "Cleaning & household"],
    ["frozen peas", "Frozen"],
    ["ice cream", "Frozen"],
    ["wholemeal bread", "Bakery"],
    ["chicken stock", "Pantry"],
    ["fish sauce", "Pantry"],
    ["peanut butter", "Pantry"],
    ["coconut milk", "Pantry"],
    ["bread flour", "Pantry"],
    ["garlic salt", "Pantry"],
    ["olive oil, for the chicken", "Pantry"],
    ["eggplant", "Produce"],
    ["dried basil", "Pantry"],
    ["mystery grocery", "Other"],
  ])("classifies %s as %s", (text, category) =>
    expect(categoriseGrocery(text)).toBe(category),
  );
});
const imperial = { unitSystem: "imperial", measureStandard: "us" } as const;

describe("conservative grocery totals", () => {
  it("keeps familiar fractions readable", () => {
    expect(combinedQuantity(["1/3 cup flour"], imperial)).toBe("⅓ cup");
    expect(combinedQuantity(["1/2 tsp salt"])).toBe("½ tsp");
    expect(combinedQuantity(["½ lemon", "¼ lemon"])).toBe("¾");
  });
  it.each([
    [["200 g plain flour", "0.5kg plain flour"], "700 g"],
    [["250 ml milk", "1 litre milk"], "1250 ml"],
    [["1 onion, diced", "2 onions"], "3"],
    [["½ cup flour", "1 1/2 cups flour"], "260 g"],
    [["1½ tbsp olive oil", "1/2 tablespoon olive oil"], "2 tbsp"],
    [["2 tsp sugar", "1 teaspoon sugar"], "3 tsp"],
    [["1 tbsp oil", "3 tsp oil"], "35 ml"],
  ])("adds compatible lines %j", (lines, total) =>
    expect(combinedQuantity(lines)).toBe(total),
  );
  it("adds cups and grams of the same ingredient", () => {
    expect(combinedQuantity(["200g plain flour", "1 cup plain flour"])).toBe(
      "330 g",
    );
    expect(
      combinedQuantity(["200g plain flour", "1 cup plain flour"], imperial),
    ).toBe("12 oz");
  });
  it("shows totals in the user's units", () => {
    expect(
      combinedQuantity(["½ cup flour", "1 1/2 cups flour"], imperial),
    ).toBe("2 cups");
    expect(combinedQuantity(["250 g mince", "250 g mince"], imperial)).toBe(
      "1 lb",
    );
  });
  it.each([
    "1-2 onions",
    "2 x 400g tins tomatoes",
    "400 g tin tomatoes",
    "salt to taste",
    "1 onion or shallot",
    "2 bunches coriander",
    "1/0 cup flour",
    "200 g flour plus extra",
    "about 1 cup milk",
  ])("preserves ambiguous line %s", (text) =>
    expect(parseGrocery(text)).toBeNull(),
  );
  it("keeps different units and ingredients separate", () => {
    expect(combinedQuantity(["200g chicken", "1 cup chicken"])).toBeNull();
    expect(combinedQuantity(["1 red onion", "1 brown onion"])).toBeNull();
    expect(
      combinedQuantity(["100g chicken breasts", "100g chicken thighs"]),
    ).toBeNull();
  });
  it("accounts for every source exactly once and only merges safe matches", () => {
    const items = [
      "200g plain flour",
      "0.5kg plain flour",
      "1 cup plain flour",
      "2 tins tomatoes",
      "1 tin tomatoes",
      "1 red onion",
      "2 onions",
      "laundry detergent",
    ].map((text, index) => ({ id: String(index), text }));
    const plan = generateShoppingPlan(items);
    expect(plan.groups).toHaveLength(6);
    expect(plan.groups.flatMap((group) => group.itemIds).sort()).toEqual(
      items.map((item) => item.id),
    );
    expect(
      plan.groups.find(
        (group) => group.name === "Plain flour" && group.itemIds.length === 3,
      )?.itemIds,
    ).toEqual(["0", "1", "2"]);
  });
});

describe("garlic and other counted lines", () => {
  it("adds cloves whatever the preparation", () => {
    expect(
      combinedQuantity([
        "3 cloves garlic, finely sliced",
        "3 cloves of garlic, crushed",
        "3 garlic cloves, minced",
      ]),
    ).toBe("9 cloves");
    expect(combinedQuantity(["1 clove garlic"])).toBe("1 clove");
  });
  it("uses stored ingredients when given", () => {
    const plan = generateShoppingPlan([
      { id: "a", text: "3 cloves garlic, crushed" },
      {
        id: "b",
        text: "garlic (3 cloves), sliced",
        ingredient: {
          quantity: 3,
          quantityMax: null,
          unit: "clove",
          size: null,
          item: "garlic",
          detail: "sliced",
          optional: false,
        },
      },
    ]);
    expect(plan.groups).toEqual([
      { category: "Produce", name: "Garlic", itemIds: ["a", "b"] },
    ]);
  });
});

describe("groceryGroup", () => {
  it("gives lines that add up the same key", () => {
    const flour = groceryGroup("200g plain flour");
    expect(flour).toEqual({
      category: "Pantry",
      key: expect.any(String),
      name: "Plain flour",
    });
    expect(groceryGroup("1 cup plain flour").key).toBe(flour.key);
    expect(groceryGroup("3 garlic cloves").key).toBe(
      groceryGroup("1 clove garlic, crushed").key,
    );
  });
  it("keeps lines apart when they can't be added", () => {
    expect(groceryGroup("200g chicken").key).not.toBe(
      groceryGroup("1 cup chicken").key,
    );
    expect(groceryGroup("2 garlic cloves").key).not.toBe(
      groceryGroup("1 garlic").key,
    );
    expect(groceryGroup("salt to taste")).toEqual({
      category: "Pantry",
      key: null,
      name: "salt to taste",
    });
  });
});
