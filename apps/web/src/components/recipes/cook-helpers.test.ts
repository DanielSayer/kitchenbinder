import { describe, expect, it } from "vitest";
import {
  formatQuantity,
  parseServings,
  scaleIngredient,
  splitQuantity,
} from "./scale-ingredients";
import {
  formatClock,
  ingredientName,
  ingredientsUsed,
  stepDurations,
} from "./step-timers";

describe("scaleIngredient", () => {
  it("scales leading whole numbers, fractions and ranges", () => {
    expect(scaleIngredient("800 g cherry tomatoes", 0.5)).toBe(
      "400 g cherry tomatoes",
    );
    expect(scaleIngredient("1 1/2 cups flour", 2)).toBe("3 cups flour");
    expect(scaleIngredient("½ lemon", 3)).toBe("1½ lemon");
    expect(scaleIngredient("2-3 garlic cloves", 2)).toBe("4-6 garlic cloves");
    expect(scaleIngredient("1 tsp paprika", 1.5)).toBe("1½ tsp paprika");
    expect(scaleIngredient("400g tin tomatoes", 2)).toBe("800g tin tomatoes");
  });
  it("leaves lines without a leading quantity alone", () => {
    expect(scaleIngredient("Salt, to taste", 2)).toBe("Salt, to taste");
    expect(scaleIngredient("1 onion", 1)).toBe("1 onion");
  });
  it("splits quantity and unit for emphasis", () => {
    expect(splitQuantity("3 tbsp olive oil", 2)).toEqual({
      quantity: "6 tbsp",
      rest: " olive oil",
    });
    expect(splitQuantity("Basil")).toEqual({ quantity: "", rest: "Basil" });
  });
  it("formats kitchen quantities", () => {
    expect(formatQuantity(0.3)).toBe("⅓");
    expect(formatQuantity(1.74)).toBe("1¾");
    expect(formatQuantity(1.97)).toBe("2");
    expect(formatQuantity(12.4)).toBe("12");
    expect(formatQuantity(0.05)).toBe("¼");
  });
  it("parses servings", () => {
    expect(parseServings("4-6")).toBe(4);
    expect(parseServings("Serves 2")).toBe(2);
    expect(parseServings("")).toBeNull();
    expect(parseServings(null)).toBeNull();
  });
});

describe("stepDurations", () => {
  it("finds durations, ranges and combined hours", () => {
    expect(
      stepDurations("Roast for 25 minutes until blistered.").map(
        (item) => item.seconds,
      ),
    ).toEqual([1500]);
    expect(stepDurations("Simmer 10-15 mins.")[0]?.seconds).toBe(600);
    const combined = stepDurations("Bake for 1 hour 30 minutes, then rest.");
    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({
      seconds: 5400,
      text: "1 hour 30 minutes",
    });
    expect(stepDurations("Cook for an hour")[0]?.seconds).toBe(3600);
    expect(stepDurations("Cut into 5cm pieces")).toEqual([]);
  });
  it("formats clocks", () => {
    expect(formatClock(1500)).toBe("25:00");
    expect(formatClock(5400)).toBe("1:30:00");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("ingredientsUsed", () => {
  it("matches ingredient key words in a step", () => {
    const ingredients = [
      "800 g cherry tomatoes",
      "2 tins butter beans, drained",
      "4 garlic cloves, bashed",
      "1 tsp smoked paprika",
    ];
    expect(ingredientName(ingredients[1] ?? "")).toBe("butter beans");
    expect(
      ingredientsUsed(
        "Stir through the beans and paprika, then the tomato.",
        ingredients,
      ),
    ).toEqual(["cherry tomatoes", "butter beans", "smoked paprika"]);
  });
});
