import { describe, expect, it } from "vitest";
import {
  type Amount,
  convertAmount,
  convertQuantity,
  densityOf,
  formatAmount,
  type MeasurePreferences,
  preferredAmount,
  unitChoices,
} from "./units";

const metric: MeasurePreferences = {
  unitSystem: "metric",
  measureStandard: "au",
};
const imperial: MeasurePreferences = {
  unitSystem: "imperial",
  measureStandard: "us",
};
const amount = (
  quantity: number,
  unit: Amount["unit"],
  quantityMax: number | null = null,
): Amount => ({ quantity, quantityMax, unit });
const shown = (value: Amount, item: string, prefs: MeasurePreferences) =>
  formatAmount(preferredAmount(value, item, prefs));

describe("densities", () => {
  it("finds ingredients by name and by their last words", () => {
    expect(densityOf("plain flour")).toBeCloseTo(0.528);
    expect(densityOf("Caster Sugar")).toBeCloseTo(0.845);
    expect(densityOf("organic plain flour")).toBeCloseTo(0.528);
    expect(densityOf("cups")).toBeNull();
  });
  it("doesn't mistake a different thing for a known one", () => {
    expect(densityOf("red pepper")).toBeNull();
    expect(densityOf("cashew butter")).toBeNull();
    expect(densityOf("chicken thigh")).toBeNull();
  });
});

describe("converting", () => {
  it("converts within a dimension", () => {
    expect(convertQuantity(1, "kg", "g", "")).toBe(1000);
    expect(convertQuantity(1, "lb", "g", "")).toBeCloseTo(453.59);
    expect(convertQuantity(1, "cup", "ml", "")).toBe(250);
    expect(convertQuantity(1, "tbsp", "tsp", "")).toBe(4);
  });
  it("reads recipe cups as Australian and sizes target cups by preference", () => {
    expect(convertQuantity(240, "ml", "cup", "", "us")).toBe(1);
    expect(convertQuantity(250, "ml", "cup", "", "au")).toBe(1);
    expect(convertQuantity(1, "cup", "ml", "", "us")).toBe(250);
  });
  it("converts volume to weight with a density", () => {
    expect(convertQuantity(1, "cup", "g", "plain flour")).toBeCloseTo(132);
    expect(convertQuantity(132, "g", "cup", "flour")).toBeCloseTo(1);
    expect(convertQuantity(1, "cup", "g", "chicken")).toBeNull();
  });
  it("never converts counted units", () => {
    expect(convertQuantity(2, "clove", "g", "garlic")).toBeNull();
    expect(convertQuantity(2, "tin", "ml", "tomatoes")).toBeNull();
  });
  it("converts both ends of a range", () => {
    expect(convertAmount(amount(1, "kg", 2), "g", "")).toEqual(
      amount(1000, "g", 2000),
    );
  });
  it("offers the written unit plus its metric and imperial forms", () => {
    expect(unitChoices(amount(500, "g"), "chicken")).toEqual(["g", "lb"]);
    expect(unitChoices(amount(2, "cup"), "plain flour")).toEqual(["cup", "g"]);
    expect(unitChoices(amount(0.5, "cup"), "milk")).toEqual(["cup", "ml"]);
    expect(unitChoices(amount(1, "tsp"), "baking powder")).toEqual(["tsp"]);
    expect(unitChoices(amount(2, "clove"), "garlic")).toEqual(["clove"]);
  });
});

describe("preferred units", () => {
  it.each([
    [amount(1, "cup"), "plain flour", "130 g"],
    [amount(1, "cup"), "milk", "250 ml"],
    [amount(0.5, "cup"), "brown sugar", "115 g"],
    [amount(1, "cup"), "mystery sauce", "250 ml"],
    [amount(2, "cup"), "chicken stock", "500 ml"],
    [amount(5, "cup"), "chicken stock", "1.25 l"],
    [amount(1, "lb"), "beef mince", "450 g"],
    [amount(2.5, "lb"), "beef mince", "1.15 kg"],
    [amount(200, "g"), "butter", "200 g"],
    [amount(2, "tbsp"), "olive oil", "2 tbsp"],
    [amount(8, "fl_oz"), "water", "235 ml"],
    [amount(2.5, "cup"), "milk", "625 ml"],
  ])("metric shows %j %s as %s", (value, item, text) =>
    expect(shown(value, item, metric)).toBe(text),
  );
  it.each([
    [amount(500, "g"), "beef mince", "1 lb"],
    [amount(200, "g"), "butter", "7 oz"],
    [amount(100, "g"), "feta", "3½ oz"],
    [amount(125, "g"), "butter", "4½ oz"],
    [amount(1.15, "kg"), "potatoes", "2½ lb"],
    [amount(500, "ml"), "chicken stock", "2 cups"],
    [amount(60, "ml"), "milk", "¼ cup"],
    [amount(30, "ml"), "lemon juice", "2 tbsp"],
    [amount(1, "cup"), "flour", "1 cup"],
    [amount(1, "tsp"), "salt", "1 tsp"],
  ])("imperial shows %j %s as %s", (value, item, text) =>
    expect(shown(value, item, imperial)).toBe(text),
  );
  it("keeps counted units", () => {
    expect(shown(amount(3, "clove"), "garlic", metric)).toBe("3 cloves");
    expect(shown(amount(1, "clove"), "garlic", imperial)).toBe("1 clove");
  });
});

describe("formatting", () => {
  it.each([
    [amount(1.5, "cup"), "1½ cups"],
    [amount(0.5, "cup"), "½ cup"],
    [amount(1, "cup"), "1 cup"],
    [amount(2, "tbsp", 3), "2-3 tbsp"],
    [amount(1234, "g"), "1250 g"],
    [amount(1.2345, "kg"), "1.25 kg"],
    [amount(2.5, "g"), "2.5 g"],
    [amount(132, "g"), "130 g"],
  ])("formats %j as %s", (value, text) =>
    expect(formatAmount(value)).toBe(text),
  );
});
