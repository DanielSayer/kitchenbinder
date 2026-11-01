import { describe, expect, it } from "vitest";
import {
  type AiIngredient,
  aiIngredientLines,
  ingredientColumns,
} from "./ingredient-data";

const blank: AiIngredient = {
  heading: false,
  quantity: null,
  quantityMax: null,
  unit: null,
  sizeQuantity: null,
  sizeUnit: null,
  item: "",
  detail: null,
  optional: false,
};

describe("aiIngredientLines", () => {
  it("keeps valid model output and normalises items", () => {
    const lines = aiIngredientLines(
      ["For the sauce:", "1 onion or 2 shallots", "2 x 400g tins tomatoes"],
      [
        { ...blank, heading: true },
        { ...blank, quantity: 1, item: "Onions", detail: "or 2 shallots" },
        {
          ...blank,
          quantity: 2,
          unit: "tin",
          sizeQuantity: 400,
          sizeUnit: "g",
          item: "tomatoes",
        },
      ],
    );
    expect(lines).toMatchObject([
      { heading: true, parsed: null, source: "ai" },
      { source: "ai", parsed: { quantity: 1, item: "onion" } },
      {
        source: "ai",
        parsed: { unit: "tin", size: { quantity: 400, unit: "g" } },
      },
    ]);
  });

  it("falls back to the code parser for invented or invalid values", () => {
    const [invented, invalid] = aiIngredientLines(
      ["salt", "2 eggs"],
      [
        { ...blank, quantity: 1, item: "salt" },
        { ...blank, quantity: -2, item: "egg" },
      ],
    );
    expect(invented).toMatchObject({
      source: "code",
      parsed: { quantity: null, item: "salt" },
    });
    expect(invalid).toMatchObject({
      source: "code",
      parsed: { quantity: 2, item: "egg" },
    });
  });

  it("ignores output that doesn't line up with the ingredients", () => {
    const lines = aiIngredientLines(
      ["2 eggs", "1 onion or shallot"],
      [{ ...blank, quantity: 2, item: "egg" }],
    );
    expect(lines.map((line) => line.source)).toEqual(["code", "code"]);
    expect(ingredientColumns(["1 onion or shallot"], lines)).toMatchObject({
      ingredientsPendingAt: expect.any(Date),
    });
  });
});
