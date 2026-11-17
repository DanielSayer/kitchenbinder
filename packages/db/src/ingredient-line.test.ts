import { describe, expect, it } from "vitest";
import {
  baseServings,
  displayLine,
  displayQuantity,
  type IngredientLine,
  ingredientLines,
  scaleLine,
} from "./ingredient-line";

const metric = { unitSystem: "metric", measureStandard: "au" } as const;
const imperial = { unitSystem: "imperial", measureStandard: "us" } as const;
const systems = { metric, imperial };
const line = (text: string) => ingredientLines([text])[0] as IngredientLine;

describe("ingredient lines", () => {
  it("prefers the recipe's stored parse and code-parses the rest", () => {
    const stored: IngredientLine[] = [
      {
        text: "Sauce",
        heading: true,
        parsed: null,
        source: "ai",
      },
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
    ];
    const lines = ingredientLines(
      ["Sauce", "1 onion", "For the rice:", "200 g rice"],
      stored,
    );
    expect(lines.map(({ heading }) => heading)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(lines.map(({ parsed }) => parsed?.item ?? null)).toEqual([
      null,
      "brown onion",
      null,
      "rice",
    ]);
  });

  it.each([
    ["4", 4],
    ["4-6", 4],
    ["Serves 4", 4],
    ["4 servings", 4],
    ["12 cookies", 12],
    ["", null],
    [null, null],
    ["a crowd", null],
    ["0", null],
  ])("reads base servings %j as %j", (text, expected) => {
    expect(baseServings(text)).toBe(expected);
  });

  it.each([
    ["800 g cherry tomatoes", 0.5, "400 g cherry tomatoes"],
    ["200 g rice", 2, "400 g rice"],
    ["1,000 g rice", 2, "2000 g rice"],
    ["½ tsp salt", 2, "1 tsp salt"],
    ["1 tsp paprika", 1.5, "1½ tsp paprika"],
    ["1 1/2 cups flour", 2, "3 cups flour"],
    ["1½ cups flour", 0.5, "¾ cups flour"],
    ["1 cup sugar", 2 / 3, "⅔ cup sugar"],
    ["½ lemon", 3, "1½ lemon"],
    ["2-3 garlic cloves", 2, "4-6 garlic cloves"],
    ["1-2 onions", 2, "2-4 onions"],
    ["400g tin tomatoes", 2, "2 x 400g tins tomatoes"],
    ["2 x 400 g tins tomatoes", 2, "4 x 400 g tins tomatoes"],
    ["1 onion", 1, "1 onion"],
    ["Salt to taste", 1, "Salt to taste"],
  ])("scales %j ×%d to %j", (text, factor, expected) => {
    expect(scaleLine(line(text), factor)).toMatchObject({
      text: expected,
      uncertain: false,
    });
  });

  it.each([
    ["Salt, to taste", 2],
    ["1/0 cup flour", 2],
  ])("flags %j ×%d instead of guessing", (text, factor) => {
    expect(scaleLine(line(text), factor)).toEqual({
      text: `${text} [check quantity for ×${factor} recipe]`,
      ingredient: line(text).parsed,
      uncertain: true,
    });
  });

  it("scales the parse, keeping package sizes", () => {
    expect(scaleLine(line("2-3 garlic cloves"), 2).ingredient).toMatchObject({
      quantity: 4,
      quantityMax: 6,
      unit: "clove",
    });
    expect(scaleLine(line("400g tin tomatoes"), 2).ingredient).toMatchObject({
      quantity: 2,
      unit: "tin",
      size: { quantity: 400, unit: "g" },
    });
    const sugar = scaleLine(line("1 cup sugar"), 2 / 3).ingredient;
    expect(sugar?.quantity).toBeCloseTo(2 / 3);
  });

  it.each([
    // Converted to the user's units, scaled first.
    ["1 cup plain flour", 1, "metric", "130 g", " plain flour"],
    ["1 cup plain flour", 2, "metric", "260 g", " plain flour"],
    ["2 cups milk", 1, "metric", "500 ml", " milk"],
    ["500g beef mince", 1, "imperial", "1 lb", " beef mince"],
    // Already in the user's units, or not convertible: as written.
    ["1 1/2 tbsp olive oil", 1, "metric", "1 1/2 tbsp", " olive oil"],
    ["3 tbsp olive oil", 2, "metric", "6 tbsp", " olive oil"],
    ["3 garlic cloves", 1, "metric", "3", " garlic cloves"],
    ["Basil", 1, "metric", "", "Basil"],
    ["Salt, to taste", 2, "metric", "", "Salt, to taste"],
    // The recipe's own conversion instead of a second one.
    ["2 cups (500 ml) beef stock", 1, "metric", "500 ml", " beef stock"],
    ["2 cups (500 ml) beef stock", 2, "metric", "1 l", " beef stock"],
    ["3/4 cup (185 ml) orange juice", 1, "metric", "185 ml", " orange juice"],
    ["2 cups (500 ml) beef stock", 1, "imperial", "2 cups", " beef stock"],
    ["1 tbsp (20 ml) oil", 1, "metric", "1 tbsp", " oil"],
    // Written in both systems: only the user's.
    [
      "14 oz / 400g can crushed tomatoes",
      1,
      "metric",
      "400 g",
      " can crushed tomatoes",
    ],
    [
      "14 oz / 400g can crushed tomatoes",
      1,
      "imperial",
      "14 oz",
      " can crushed tomatoes",
    ],
    [
      "14 oz / 400g can crushed tomatoes",
      2,
      "metric",
      "2",
      " x 400 g cans crushed tomatoes",
    ],
  ] as const)(
    "shows %j ×%d in %s as %j + %j",
    (text, factor, system, quantity, rest) => {
      expect(
        displayQuantity(text, factor, line(text).parsed, systems[system]),
      ).toMatchObject({ quantity, rest });
    },
  );

  it("uses a unit the cook picked", () => {
    const text = "1 cup plain flour";
    const shown = displayQuantity(text, 1, line(text).parsed, metric, "cup");
    expect(shown.quantity).toBe("1 cup");
    expect(shown.choices?.map((choice) => choice.unit)).toEqual(["cup", "g"]);
  });

  it("uses a parse given with a line written in both systems", () => {
    const beef = "3 lb / 1.5 kg beef chuck";
    const parsed = {
      quantity: 3,
      quantityMax: null,
      unit: "lb",
      size: null,
      item: "beef chuck",
      detail: null,
      optional: false,
    } as const;
    expect(displayQuantity(beef, 1, parsed, metric)).toMatchObject({
      quantity: "1.5 kg",
      rest: " beef chuck",
    });
    expect(displayQuantity(beef, 1, parsed, imperial).quantity).toBe("3 lb");
  });

  it("leaves lines whose text doesn't match the parse", () => {
    expect(
      displayQuantity("1 cup flour", 1, line("2 cups flour").parsed, metric)
        .quantity,
    ).toBe("1 cup");
  });

  it.each([
    ["1 cup plain flour", 2, "260 g plain flour"],
    ["1 cup plain flour", 0.4, "55 g plain flour"],
    ["400g tin tomatoes", 2, "2 x 400g tins tomatoes"],
    ["Salt, to taste", 2, "Salt, to taste [check quantity for ×2 recipe]"],
  ])("shows %j scaled ×%d on a shopping list as %j", (text, factor, shown) => {
    const scaled = scaleLine(line(text), factor);
    expect(displayLine(scaled.text, scaled.ingredient, metric)).toBe(shown);
  });
});
