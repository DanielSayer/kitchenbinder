import { describe, expect, it } from "vitest";
import {
  isIngredientHeading,
  needsAiParse,
  normaliseItem,
  parseIngredient,
  parseIngredientLines,
  parseQuantity,
  unitBase,
} from "./ingredients";

describe("parseQuantity", () => {
  it.each([
    ["2", 2],
    ["1.5", 1.5],
    ["1,5", 1.5],
    ["1,000", 1000],
    ["1/2", 0.5],
    ["1 1/2", 1.5],
    ["1½", 1.5],
    ["½", 0.5],
  ])("reads %s", (text, value) => expect(parseQuantity(text)).toBe(value));
  it("rejects nonsense", () => expect(parseQuantity("x")).toBeNaN());
});

describe("parseIngredient", () => {
  it.each([
    [
      "3 cloves garlic, finely sliced",
      { quantity: 3, unit: "clove", item: "garlic", detail: "finely sliced" },
    ],
    [
      "3 cloves of garlic, crushed",
      { quantity: 3, unit: "clove", item: "garlic", detail: "crushed" },
    ],
    [
      "3 garlic cloves, minced",
      { quantity: 3, unit: "clove", item: "garlic", detail: "minced" },
    ],
    [
      "2 crushed garlic cloves",
      { quantity: 2, unit: "clove", item: "garlic", detail: "crushed" },
    ],
    ["200 g pasta", { quantity: 200, unit: "g", item: "pasta", detail: null }],
    ["400g pasta", { quantity: 400, unit: "g", item: "pasta" }],
    ["1.5kg potatoes", { quantity: 1.5, unit: "kg", item: "potato" }],
    ["1 tbsp olive oil", { quantity: 1, unit: "tbsp", item: "olive oil" }],
    [
      "½ tsp chilli flakes",
      { quantity: 0.5, unit: "tsp", item: "chilli flake" },
    ],
    [
      "1 1/2 cups plain flour",
      { quantity: 1.5, unit: "cup", item: "plain flour" },
    ],
    [
      "2 tablespoons soy sauce",
      { quantity: 2, unit: "tbsp", item: "soy sauce" },
    ],
    ["8 fl oz milk", { quantity: 8, unit: "fl_oz", item: "milk" }],
    ["1 lb ground beef", { quantity: 1, unit: "lb", item: "ground beef" }],
    [
      "1 large onion, finely chopped",
      {
        quantity: 1,
        unit: null,
        item: "onion",
        detail: "large, finely chopped",
      },
    ],
    [
      "2 finely chopped red onions",
      { quantity: 2, item: "red onion", detail: "finely chopped" },
    ],
    ["3 eggs", { quantity: 3, unit: null, item: "egg" }],
    ["½ lemon", { quantity: 0.5, item: "lemon" }],
    ["half a lemon", { quantity: 0.5, item: "lemon" }],
    ["an onion", { quantity: 1, item: "onion" }],
    ["2 bay leaves", { quantity: 2, item: "bay leaf" }],
    ["4 tomatoes", { quantity: 4, item: "tomato" }],
    ["2 chillies", { quantity: 2, item: "chilli" }],
    [
      "1 punnet strawberries",
      { quantity: 1, unit: "punnet", item: "strawberry" },
    ],
    [
      "2-3 garlic cloves",
      { quantity: 2, quantityMax: 3, unit: "clove", item: "garlic" },
    ],
    ["2 to 3 carrots", { quantity: 2, quantityMax: 3, item: "carrot" }],
    [
      "a good pinch of salt",
      { quantity: 1, unit: "pinch", item: "salt", detail: "good" },
    ],
    ["a handful of basil", { quantity: 1, unit: "handful", item: "basil" }],
    [
      "400 g tin chickpeas, drained",
      {
        quantity: 1,
        unit: "tin",
        size: { quantity: 400, unit: "g" },
        item: "chickpeas",
        detail: "drained",
      },
    ],
    [
      "2 x 400g tins crushed tomatoes",
      {
        quantity: 2,
        unit: "tin",
        size: { quantity: 400, unit: "g" },
        item: "crushed tomato",
      },
    ],
    [
      "1 can (400 ml) coconut milk",
      {
        quantity: 1,
        unit: "can",
        size: { quantity: 400, unit: "ml" },
        item: "coconut milk",
      },
    ],
    ["500 g minced beef", { quantity: 500, unit: "g", item: "minced beef" }],
    [
      "salt, to taste",
      { quantity: null, unit: null, item: "salt", optional: true },
    ],
    [
      "fresh coriander leaves, to serve",
      { item: "fresh coriander leaf", optional: true, detail: "to serve" },
    ],
    [
      "60 g baby spinach (optional)",
      { quantity: 60, item: "baby spinach", optional: true },
    ],
    ["1 tbsp butter (softened)", { item: "butter", detail: "softened" }],
    ["1 cup whole milk", { item: "whole milk" }],
    ["1 green capsicum", { item: "green capsicum" }],
  ])("reads %s", (text, expected) =>
    expect(parseIngredient(text)).toMatchObject(expected),
  );

  it.each([
    "1 onion or shallot",
    "200 g flour plus extra for dusting",
    "about 1 cup milk",
    "approximately 2 cups stock",
    "a few sprigs thyme",
    "a little olive oil",
    "juice of 1 lemon",
    "1/0 cup flour",
    "2 x tins tomatoes",
    "",
  ])("leaves %s for the AI", (text) =>
    expect(parseIngredient(text)).toBeNull(),
  );

  it("does not mistake words for units", () => {
    expect(parseIngredient("1 large egg")).toMatchObject({
      unit: null,
      item: "egg",
    });
    expect(parseIngredient("2 green onions")).toMatchObject({
      unit: null,
      item: "green onion",
    });
    expect(parseIngredient("1 lime")).toMatchObject({
      unit: null,
      item: "lime",
    });
  });
});

describe("normaliseItem", () => {
  it.each([
    ["Onions", "onion"],
    ["potatoes", "potato"],
    ["berries", "berry"],
    ["peaches", "peach"],
    ["asparagus", "asparagus"],
    ["hummus", "hummus"],
    ["glass noodles", "glass noodles"],
    ["oats", "oats"],
    ["brown lentils", "brown lentils"],
    ["swiss", "swiss"],
  ])("%s → %s", (text, item) => expect(normaliseItem(text)).toBe(item));
});

describe("headings", () => {
  it.each(["For the sauce:", "Dressing:", "for the marinade", "TOPPING"])(
    "%s is a heading",
    (text) => expect(isIngredientHeading(text)).toBe(true),
  );
  it.each(["2 eggs", "salt: to taste 2g", "Salt"])("%s is not", (text) =>
    expect(isIngredientHeading(text)).toBe(false),
  );
});

describe("parseIngredientLines", () => {
  it("reuses unchanged lines and parses new ones", () => {
    const previous = [
      {
        text: "1 onion or shallot",
        heading: false,
        parsed: {
          quantity: 1,
          quantityMax: null,
          unit: null,
          size: null,
          item: "onion",
          detail: "or shallot",
          optional: false,
        },
        source: "ai" as const,
      },
    ];
    const lines = parseIngredientLines(
      ["For the base:", "1 onion or shallot", "2 eggs", "1 egg or 2 yolks"],
      previous,
    );
    expect(lines[0]).toMatchObject({ heading: true, parsed: null });
    expect(lines[1]).toBe(previous[0]);
    expect(lines[2]).toMatchObject({ source: "code", parsed: { item: "egg" } });
    expect(lines[3]).toMatchObject({ source: "code", parsed: null });
    expect(needsAiParse(lines)).toBe(true);
    expect(needsAiParse(lines.slice(0, 3))).toBe(false);
    expect(needsAiParse(null)).toBe(true);
  });
});

describe("unitBase", () => {
  it("uses Australian spoons and cups by default", () => {
    expect(unitBase("cup")).toBe(250);
    expect(unitBase("tbsp")).toBe(20);
    expect(unitBase("cup", "us")).toBe(240);
    expect(unitBase("kg")).toBe(1000);
    expect(unitBase("clove")).toBeNull();
  });
});
