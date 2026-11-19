import type { Meal } from "@prep-sheet/db/meal-planner";
import { describe, expect, it } from "vitest";
import { type ShoppingTrip, shoppingDemands, tripIsStale } from "./demands";
import { type Item, reconcile } from "./reconcile";

// The reconciliation step is pure; these tests drive it in-process.
const curry: Extract<Meal, { kind: "recipe" }> = {
  id: "curry",
  kind: "recipe",
  date: "2026-09-21",
  slot: "Dinner",
  recipeId: "recipe",
  title: "Curry",
  baseServings: 2,
  cook: 4,
  eat: 2,
  ingredients: ["200 g rice", "½ tsp salt"],
};
const coverage = {
  shoppingDate: "2026-09-19",
  start: "2026-09-20",
  end: "2026-09-25",
};

describe("shopping demands", () => {
  it("counts each cooking session once and excludes leftovers and eating out", () => {
    const meals: Meal[] = [
      curry,
      { ...curry, id: "second", date: "2026-09-23" },
      {
        id: "leftover",
        date: "2026-09-22",
        slot: "Lunch",
        kind: "leftovers",
        sourceId: curry.id,
        portions: 2,
      },
      {
        id: "out",
        date: "2026-09-24",
        slot: "",
        kind: "out",
        description: "Dinner",
      },
    ];
    const demands = shoppingDemands(meals, coverage);
    expect(demands).toHaveLength(4);
    expect(demands.map((demand) => demand.key)).toEqual([
      "curry:0",
      "curry:1",
      "second:0",
      "second:1",
    ]);
    expect(demands.every((demand) => demand.factor === 2)).toBe(true);
  });
  it("leaves ingredient headings off the shopping list", () => {
    const demands = shoppingDemands(
      [{ ...curry, ingredients: ["For the rice:", "200 g rice"] }],
      coverage,
    );
    expect(demands.map((demand) => [demand.key, demand.text])).toEqual([
      ["curry:1", "200 g rice"],
    ]);
  });
  it("uses the snapshot's line parses, falling back to the code parser", () => {
    const [rice, salt] = shoppingDemands(
      [
        {
          ...curry,
          ingredients: ["Sauce", "200 g rice", "½ tsp salt"],
          ingredientData: [
            { text: "Sauce", heading: true, parsed: null, source: "ai" },
            {
              text: "200 g rice",
              heading: false,
              parsed: {
                quantity: 200,
                quantityMax: null,
                unit: "g",
                size: null,
                item: "basmati rice",
                detail: null,
                optional: false,
              },
              source: "ai",
            },
          ],
        },
      ],
      coverage,
    );
    expect(rice?.parsed?.item).toBe("basmati rice");
    expect(salt).toMatchObject({
      text: "½ tsp salt",
      parsed: { item: "salt" },
    });
  });
  it("only marks shopping stale for ingredient-affecting changes", () => {
    const trip = {
      ...coverage,
      demands: shoppingDemands([curry], coverage),
      allocations: [],
    };
    expect(
      tripIsStale(
        [{ ...curry, date: "2026-09-23", slot: "Lunch", eat: 3 }],
        trip,
      ),
    ).toBe(false);
    expect(tripIsStale([{ ...curry, cook: 6 }], trip)).toBe(true);
    expect(tripIsStale([{ ...curry, date: "2026-09-26" }], trip)).toBe(true);
    expect(tripIsStale([], trip)).toBe(true);
  });
});

const riceCurry = { ...curry, ingredients: ["200 g rice", "1 onion"] };
let nextId = 0;
function item(fields: Partial<Item> & Pick<Item, "text">): Item {
  nextId += 1;
  return {
    id: `item-${nextId}`,
    householdId: "household",
    addedBy: "user",
    ingredient: null,
    status: "needed",
    recipeId: null,
    recipeTitle: null,
    servings: null,
    position: 0,
    createdAt: new Date(0),
    ...fields,
  };
}
/** Review and apply a trip, returning the list and trip it leaves. */
function shop(items: Item[], meals: Meal[], trip: ShoppingTrip | null) {
  const demands = shoppingDemands(meals, coverage);
  const result = reconcile(items, demands, trip, "household", "user");
  return {
    ...result,
    items: [
      ...result.retained,
      ...result.additions.map(({ id, ...addition }) =>
        item({ ...addition, id: id ?? "" }),
      ),
    ],
    trip: { ...coverage, demands, allocations: result.allocations },
  };
}
function setStatus(items: Item[], text: string, status: Item["status"]) {
  return items.map((entry) =>
    entry.text === text ? { ...entry, status } : entry,
  );
}
const texts = (items: Item[]) => items.map((entry) => entry.text).sort();

describe("reconciling a trip with the list", () => {
  it("scales repeated cooking sessions and excludes leftovers and eating out", () => {
    const { items, trip } = shop(
      [],
      [
        riceCurry,
        { ...riceCurry, id: "second", date: "2026-09-23" },
        {
          id: "leftover",
          date: "2026-09-22",
          slot: "Lunch",
          kind: "leftovers",
          sourceId: curry.id,
          portions: 2,
        },
        {
          id: "out",
          date: "2026-09-24",
          slot: "Dinner",
          kind: "out",
          description: "Dinner with friends",
        },
      ],
      null,
    );
    expect(texts(items)).toEqual([
      "2 onion",
      "2 onion",
      "400 g rice",
      "400 g rice",
    ]);
    expect(
      new Set(
        trip.allocations.map(
          (allocation) =>
            trip.demands.find((demand) => demand.key === allocation.key)
              ?.mealId,
        ),
      ),
    ).toEqual(new Set(["curry", "second"]));
  });
  it("scales lines like the recipe page, keeping the recipe's parse", () => {
    const { items, warnings } = shop(
      [],
      [
        {
          ...curry,
          title: "Stew",
          ingredients: [
            "Sauce",
            "2-3 garlic cloves",
            "400g tin tomatoes",
            "1 onion",
            "Salt, to taste",
          ],
          ingredientData: [
            { text: "Sauce", heading: true, parsed: null, source: "ai" },
            {
              text: "1 onion",
              heading: false,
              parsed: {
                quantity: 1,
                quantityMax: null,
                unit: null,
                size: null,
                item: "brown onion",
                detail: null,
                optional: false,
              },
              source: "ai",
            },
          ],
        },
      ],
      null,
    );
    expect(warnings).toEqual([
      "Stew: Salt, to taste [check quantity for ×2 recipe]",
    ]);
    expect(
      Object.fromEntries(items.map((entry) => [entry.text, entry.ingredient])),
    ).toEqual({
      "4-6 garlic cloves": expect.objectContaining({
        quantity: 4,
        quantityMax: 6,
        unit: "clove",
      }),
      "2 x 400g tins tomatoes": expect.objectContaining({
        quantity: 2,
        unit: "tin",
        size: { quantity: 400, unit: "g" },
      }),
      "2 onion": expect.objectContaining({ quantity: 2, item: "brown onion" }),
      "Salt, to taste [check quantity for ×2 recipe]": expect.objectContaining({
        quantity: null,
        item: "salt",
      }),
    });
  });
  it("keeps manual groceries and bought or owned amounts, adding only extra portions", () => {
    const soap = item({ text: "Dish soap" });
    const first = shop([soap], [riceCurry], null);
    let items = setStatus(first.items, "400 g rice", "bought");
    items = setStatus(items, "2 onion", "owned");
    const next = shop(items, [{ ...riceCurry, cook: 6 }], first.trip);
    expect(next.removed).toEqual([]);
    expect(
      next.items.map((entry) => [entry.text, entry.status]).sort(),
    ).toEqual([
      ["1 onion", "needed"],
      ["2 onion", "owned"],
      ["200 g rice", "needed"],
      ["400 g rice", "bought"],
      ["Dish soap", "needed"],
    ]);
    expect(
      next.changes
        .filter((change) => change.kind === "keep")
        .map((change) => change.after)
        .sort(),
    ).toEqual(["Keep already owned quantity.", "Keep bought quantity."]);
  });
  it("keeps bought states and manual edits on unchanged meals", () => {
    const first = shop([], [riceCurry], null);
    const [rice, onion] = first.items;
    if (!rice || !onion) throw new Error("Missing ingredients");
    const items = [{ ...rice, text: "My preferred rice" }, onion];
    const moved = { ...riceCurry, date: "2026-09-23", slot: "Lunch" as const };
    expect(tripIsStale([moved], first.trip)).toBe(false);
    const next = shop(items, [moved], first.trip);
    expect(next.items).toEqual(items);
    expect(next.changes).toEqual([]);
  });
  it("remembers bought amounts after they leave the list", () => {
    const first = shop([], [riceCurry], null);
    const rice = first.items.find((entry) => entry.text === "400 g rice");
    if (!rice) throw new Error("Missing rice");
    const trip = {
      ...first.trip,
      allocations: first.trip.allocations.map((allocation) =>
        allocation.itemId === rice.id
          ? { ...allocation, clearedBought: true as const }
          : allocation,
      ),
    };
    const items = first.items.filter((entry) => entry !== rice);
    const same = shop(items, [riceCurry], trip);
    expect(same.additions).toEqual([]);
    const more = shop(same.items, [{ ...riceCurry, cook: 6 }], same.trip);
    expect(texts(more.items).filter((text) => text.includes("rice"))).toEqual([
      "200 g rice",
    ]);
  });
  it("removes only needed lines when a meal leaves coverage", () => {
    const first = shop([], [riceCurry], null);
    const items = setStatus(first.items, "400 g rice", "bought");
    const next = shop(
      items,
      [{ ...riceCurry, date: "2026-10-01" }],
      first.trip,
    );
    expect(next.items.map((entry) => entry.text)).toEqual(["400 g rice"]);
    expect(next.trip.allocations).toEqual([]);
    expect(next.changes).toContainEqual(
      expect.objectContaining({
        kind: "keep",
        after: "Kept as bought; no longer needed for these meals.",
      }),
    );
  });
  it("replaces only recipe lines still needed on the first trip, like later trips", () => {
    const linked = { recipeId: "other-recipe", recipeTitle: "Salad" };
    const needed = item({ text: "2 tomatoes", ...linked });
    const bought = item({ text: "1 cucumber", status: "bought", ...linked });
    const owned = item({ text: "Olive oil", status: "owned", ...linked });
    const manual = item({ text: "Dish soap" });
    const first = shop([needed, bought, owned, manual], [riceCurry], null);
    expect(first.removed).toEqual([needed.id]);
    expect(first.retained).toEqual([bought, owned, manual]);
    const added = item({ text: "2 tomatoes", ...linked });
    const later = shop([...first.items, added], [riceCurry], first.trip);
    expect(later.removed).toEqual([]);
  });
  it("caps the list at 1,000 items", () => {
    const items = Array.from({ length: 999 }, (_, index) =>
      item({ text: `Grocery ${index}` }),
    );
    expect(() => shop(items, [riceCurry], null)).toThrow(
      "This trip exceeds 1,000 ingredients. Choose fewer meals.",
    );
  });
});
