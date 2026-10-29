import { mkdir, writeFile } from "node:fs/promises";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { expect, it } from "vitest";
import { sampleRecipe } from "./fixtures";
import { generateRecipe } from "./generate";
import { recipePdf } from "./pdf";

it.skipIf(process.env.LIVE_AI_TEST !== "1")(
  "auto-tags using supplied choices",
  async () => {
    const tags = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Under 30 minutes",
        description: "Total time strictly below 30 minutes. Omit if unknown.",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Vegetarian",
        description: "No meat or fish.",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        name: "Slow cooked",
        description: "At least two hours of cooking.",
      },
    ];
    const result = await generateRecipe(
      "Tomato toast. Serves 1. Prep 5 minutes, cook 2 minutes, total 7 minutes. Ingredients: 1 slice bread, 1 tomato, 1 tsp olive oil. Steps: Toast the bread for 2 minutes. Slice the tomato. Put tomato on toast and drizzle with oil.",
      tags,
    );
    expect(result.recipes[0]?.tagIds).toEqual(
      expect.arrayContaining(tags.slice(0, 2).map((tag) => tag.id)),
    );
    expect(result.recipes[0]?.tagIds).toHaveLength(2);
    expect(
      result.recipes[0]?.tagIds.every((id) =>
        tags.some((tag) => tag.id === id),
      ),
    ).toBe(true);
  },
  100000,
);

it.skipIf(process.env.LIVE_AI_TEST !== "1").each([
  {
    name: "derives cook time from total minus prep despite zero metadata",
    times: '"prepTime":"PT10M","cookTime":"PT0M","totalTime":"PT40M"',
    prep: [10],
    cook: 30,
  },
  {
    name: "converts hours and derives missing prep time",
    times: '"cookTime":"PT1H","totalTime":"PT1H10M"',
    prep: [10],
    cook: 60,
  },
  {
    name: "excludes separately stated waiting time",
    times:
      '"prepTime":"PT10M","totalTime":"PT1H10M","description":"Total includes 30 minutes of cooling after cooking."',
    prep: [10],
    cook: 30,
  },
  {
    name: "leaves an unsupported split unknown",
    times: '"totalTime":"PT40M"',
    prep: [null],
    cook: null,
  },
  {
    name: "does not derive a negative cook time",
    times: '"prepTime":"PT50M","totalTime":"PT40M"',
    // The stated prep time may be preserved or marked unknown due to the conflict.
    prep: [50, null],
    cook: null,
  },
])(
  "$name",
  async ({ times, prep, cook }) => {
    const imported = await generateRecipe(
      `{"@type":"Recipe","name":"Tomato rice",${times},"recipeIngredient":["1 cup rice","2 cups water","1 tomato, chopped"],"recipeInstructions":["Combine the rice, water and tomato in a saucepan.","Bring to a boil, then cover and simmer until the rice is tender."]}`,
    );
    expect(imported.origin).toBe("imported");
    expect(prep).toContain(imported.recipes[0]?.content.prepMinutes);
    expect(imported.recipes[0]?.content.cookMinutes).toBe(cook);
  },
  100000,
);

it.skipIf(process.env.LIVE_AI_TEST !== "1")(
  "uses the configured OpenAI model for generation and pasted extraction",
  async () => {
    try {
      const generated = await generateRecipe(
        "Generate a simple lemon pasta recipe for two people.",
      );
      expect(
        recipeContentSchema.safeParse(generated.recipes[0]?.content).success,
      ).toBe(true);
      expect(generated.origin).toBe("generated");
      const imported = await generateRecipe(
        "Tomato toast. Serves 1. Ingredients: 1 slice bread, 1 tomato, 1 tsp olive oil. Steps: Toast the bread. Slice the tomato. Put tomato on toast and drizzle with oil.",
      );
      expect(imported.origin).toBe("imported");
      expect(imported.recipes[0]?.content.ingredients).toHaveLength(3);
      const [first] = generated.recipes;
      if (!first) throw new Error("No generated recipe");
      await mkdir("tmp/pdfs", { recursive: true });
      await writeFile(
        "tmp/pdfs/live-recipe.pdf",
        await recipePdf(first.content, null, generated.origin),
      );
    } catch (error) {
      // Print only the cause message; never request headers or credentials.
      const cause = (error as Error).cause;
      throw new Error(
        cause instanceof Error ? cause.message : (error as Error).message,
      );
    }
  },
  200000,
);

it("renders a recipe and a long recipe to paginated PDFs", async () => {
  await mkdir("tmp/pdfs", { recursive: true });
  const short = await recipePdf(
    sampleRecipe,
    "https://example.com/recipe",
    "imported",
  );
  expect(short.subarray(0, 5).toString()).toBe("%PDF-");
  await writeFile("tmp/pdfs/recipe.pdf", short);
  const long = await recipePdf(
    {
      ...sampleRecipe,
      title:
        "A long recipe with fractions, accents and temperature: ½ cup crème fraîche at 180°C",
      steps: Array.from(
        { length: 24 },
        (_, index) => `Step ${index + 1}. ${sampleRecipe.steps[index % 3]}`,
      ),
    },
    null,
    "generated",
  );
  await writeFile("tmp/pdfs/long-recipe.pdf", long);
});
