import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { parseIngredientLines } from "@prep-sheet/db/ingredients";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { sampleRecipe } from "./fixtures";
import type { AiIngredient } from "./ingredient-data";
import {
  linesForAi,
  type ParseIngredients,
  parseNextRecipeIngredients,
} from "./ingredient-parsing";

const created: string[] = [];
afterAll(async () => {
  await db.delete(recipe).where(inArray(recipe.id, created));
});

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
const answers: Record<string, AiIngredient> = {
  "For the sauce:": { ...blank, heading: true },
  "3 cloves garlic, crushed": {
    ...blank,
    quantity: 3,
    unit: "clove",
    item: "garlic",
    detail: "crushed",
  },
  "1 egg or 2 yolks": {
    ...blank,
    quantity: 1,
    item: "egg",
    detail: "or 2 yolks",
  },
};
const fake = vi.fn<ParseIngredients>(async (lines) =>
  lines.map((line) => answers[line] ?? blank),
);

// Long-overdue recipes are claimed before any other test's.
async function waiting(
  ingredients: string[],
  ingredientData: ReturnType<typeof parseIngredientLines> | null,
) {
  const id = randomUUID();
  created.push(id);
  await db.insert(recipe).values({
    id,
    title: "Parsing test",
    content: { ...sampleRecipe, ingredients },
    origin: "manual",
    ingredientData,
    ingredientsPendingAt: new Date("2000-01-01T00:00:00Z"),
  });
  return id;
}
async function stored(id: string) {
  const [row] = await db
    .select({
      data: recipe.ingredientData,
      pending: recipe.ingredientsPendingAt,
    })
    .from(recipe)
    .where(eq(recipe.id, id));
  return row;
}

describe("background ingredient parsing", () => {
  const ingredients = Object.keys(answers);

  it("backfills every line of an unparsed recipe", async () => {
    fake.mockClear();
    const id = await waiting(ingredients, null);
    expect(await parseNextRecipeIngredients(fake, true)).toBe(true);
    expect(fake).toHaveBeenCalledWith(ingredients);
    const row = await stored(id);
    expect(row?.pending).toBeNull();
    expect(row?.data).toMatchObject([
      { heading: true, source: "ai" },
      { source: "ai", parsed: { unit: "clove", item: "garlic" } },
      { source: "ai", parsed: { item: "egg", detail: "or 2 yolks" } },
    ]);
  });

  it("only sends lines the code parser couldn't read, and never retries them", async () => {
    fake.mockClear();
    const id = await waiting(ingredients, parseIngredientLines(ingredients));
    expect(await parseNextRecipeIngredients(fake, true)).toBe(true);
    expect(fake).toHaveBeenCalledWith(["1 egg or 2 yolks"]);
    const row = await stored(id);
    expect(row?.data?.[1]).toMatchObject({ source: "code" });
    expect(row?.data?.[2]).toMatchObject({ source: "ai" });
    expect(linesForAi(ingredients, row?.data ?? null)).toEqual([]);
  });

  it("keeps an edit made while the AI was working", async () => {
    const id = await waiting(ingredients, null);
    const edited = parseIngredientLines(["2 eggs"]);
    const editing: ParseIngredients = async (lines) => {
      await db
        .update(recipe)
        .set({
          content: { ...sampleRecipe, ingredients: ["2 eggs"] },
          ingredientData: edited,
          ingredientsPendingAt: null,
          revision: sql`${recipe.revision} + 1`,
        })
        .where(eq(recipe.id, id));
      return fake(lines);
    };
    expect(await parseNextRecipeIngredients(editing, true)).toBe(true);
    expect((await stored(id))?.data).toEqual(edited);
  });

  it("does nothing while AI is disabled", async () => {
    const id = await waiting(ingredients, null);
    fake.mockClear();
    expect(await parseNextRecipeIngredients(fake, false)).toBe(false);
    expect(fake).not.toHaveBeenCalled();
    expect((await stored(id))?.pending).toEqual(
      new Date("2000-01-01T00:00:00Z"),
    );
    await db.delete(recipe).where(eq(recipe.id, id));
  });
  it("leaves the recipe waiting after a provider failure", async () => {
    const id = await waiting(ingredients, null);
    const failing: ParseIngredients = async () => {
      throw new Error("provider down");
    };
    expect(await parseNextRecipeIngredients(failing, true)).toBe(false);
    const row = await stored(id);
    expect(row?.data).toBeNull();
    expect(row?.pending?.getTime()).toBeGreaterThan(Date.now());
  });
});
