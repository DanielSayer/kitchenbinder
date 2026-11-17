import { describe, expect, it } from "vitest";
import {
  formatClock,
  ingredientName,
  ingredientsUsed,
  stepDurations,
} from "./step-timers";

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
