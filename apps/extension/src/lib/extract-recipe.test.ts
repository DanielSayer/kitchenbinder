import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureResultSchema } from "./capture-contract";
import { extractRecipe } from "./extract-recipe";

const recipe = {
  "@type": "Recipe",
  name: "Butter chicken",
  recipeIngredient: ["700 g chicken", "80 ml yogurt"],
  recipeInstructions: [
    {
      "@type": "HowToSection",
      itemListElement: [
        {
          "@type": "HowToStep",
          text: "Marinate for 1 hour, then cook through.",
        },
      ],
    },
  ],
};
const metadata = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const card =
  "<article><h1>Simple soup</h1><h2>Ingredients</h2><p>2 carrots, 1 onion and 500 ml vegetable stock.</p><h2>Method</h2><p>Chop the vegetables and simmer in the stock for 20 minutes.</p></article>";
let dom: JSDOM | undefined;
function capture(
  html: string,
  url = "https://recipes.test/soup?token=private#account",
) {
  dom = new JSDOM(html, { url });
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal(
    "getComputedStyle",
    dom.window.getComputedStyle.bind(dom.window),
  );
  return captureResultSchema.parse(extractRecipe());
}
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
});

describe("loaded recipe capture", () => {
  it("ignores visible-text cards inside hidden ancestors", () => {
    expect(
      capture(
        `<div hidden>${card.replace("<article>", '<article class="recipe-card">')}</div>`,
      ),
    ).toEqual({ kind: "error", code: "missing" });
  });
  it("rejects excessive nesting and combined response size", () => {
    let nested: unknown = recipe;
    for (let index = 0; index < 25; index++) nested = { nested };
    expect(capture(metadata(nested))).toEqual({
      kind: "error",
      code: "too-large",
    });
    expect(
      capture(
        metadata(
          Array.from({ length: 5 }, (_, index) => ({
            ...recipe,
            name: `Recipe ${index}`,
            recipeInstructions: "x".repeat(27_000),
          })),
        ),
      ),
    ).toEqual({ kind: "error", code: "too-large" });
  });
  it("reads Recipe graphs and sections, strips URL tokens and excludes unrelated metadata without fetching", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = capture(
      metadata({
        "@graph": [
          {
            ...recipe,
            author: { email: "private@example.test" },
            review: "private review",
            totalTime: "PT100M",
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      kind: "captured",
      sourceUrl: "https://recipes.test/soup",
      recipes: [
        {
          title: "Butter chicken",
          format: "json-ld",
          content: expect.stringContaining("Marinate for 1 hour"),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("supports type arrays, multiple recipes, missing titles and duplicate metadata", () => {
    const result = capture(
      `<title>Page title</title>${metadata([recipe, recipe, { ...recipe, "@type": ["Thing", "https://schema.org/Recipe"], name: undefined, recipeIngredient: ["1 potato"] }])}`,
    );
    expect(result).toMatchObject({
      kind: "captured",
      recipes: [{ title: "Butter chicken" }, { title: "Page title" }],
    });
    if (result.kind === "captured") expect(result.recipes).toHaveLength(2);
  });
  it("falls back from broken or incomplete metadata to visible recipe text, excluding forms and hidden content", () => {
    const result = capture(
      `<script type="application/ld+json">broken</script>${metadata({ "@type": "Recipe", name: "Incomplete" })}${card.replace("</article>", '<form>private form<input value="private input"></form><div hidden>private hidden</div><p style="display:none">private css</p><div class="account">private account</div><textarea>private textarea</textarea><aside>private aside</aside></article>')}`,
    );
    expect(result).toMatchObject({
      kind: "captured",
      recipes: [{ title: "Simple soup", format: "text" }],
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("keeps multiple visible cards separate", () => {
    const result = capture(
      `<main>${card.replace("<article>", '<article class="recipe-card">')}${card.replace("<article>", '<article class="recipe-card">').replaceAll("Simple soup", "Carrot stew").replace("2 carrots", "3 carrots")}</main>`,
    );
    if (result.kind !== "captured") throw new Error("Expected recipes");
    expect(result.recipes).toHaveLength(2);
  });
  it.each([
    "Just a moment...",
    "Checking your browser",
    "Verify you are human",
    "Access denied",
  ])("detects challenge title %s even with metadata", (title) => {
    expect(capture(`<title>${title}</title>${metadata(recipe)}`)).toEqual({
      kind: "error",
      code: "challenge",
    });
  });
  it("collects photo candidates as absolute URLs, recipe metadata first", () => {
    const result = capture(
      `<meta property="og:image" content="/og.jpg">${metadata({
        ...recipe,
        image: [{ "@type": "ImageObject", url: "/dish.jpg#x" }, "data:x"],
      })}`,
    );
    expect(result.kind === "captured" && result.recipes[0]?.images).toEqual([
      { url: "https://recipes.test/dish.jpg", alt: "", source: "recipe" },
      { url: "https://recipes.test/og.jpg", alt: "", source: "page" },
    ]);
  });
  it("detects a challenge form", () => {
    expect(capture('<form id="challenge-form"></form>')).toEqual({
      kind: "error",
      code: "challenge",
    });
  });
  it("rejects unsupported URLs and pages without a recipe", () => {
    expect(capture(card, "file:///recipe.html")).toEqual({
      kind: "error",
      code: "unsupported",
    });
    expect(capture("<main><h1>Welcome</h1><p>My account</p></main>")).toEqual({
      kind: "error",
      code: "missing",
    });
  });
  it("rejects oversized recipes, input metadata and excessive recipe choices without truncating", () => {
    expect(
      capture(metadata({ ...recipe, recipeIngredient: ["x".repeat(32_001)] })),
    ).toEqual({ kind: "error", code: "too-large" });
    expect(capture(metadata({ other: "x".repeat(1_000_001) }))).toEqual({
      kind: "error",
      code: "too-large",
    });
    expect(
      capture(
        metadata(
          Array.from({ length: 11 }, (_, index) => ({
            ...recipe,
            name: `Recipe ${index}`,
          })),
        ),
      ),
    ).toEqual({ kind: "error", code: "too-large" });
  });
  it("validates capture responses and rejects unexpected fields and unsafe links", () => {
    const value = {
      kind: "captured",
      sourceUrl: "javascript:alert(1)",
      recipes: [{ title: "Test", content: "Test", format: "text" }],
    };
    expect(captureResultSchema.safeParse(value).success).toBe(false);
    expect(
      captureResultSchema.safeParse({
        ...value,
        sourceUrl: "https://recipes.test/",
        token: "secret",
      }).success,
    ).toBe(false);
  });
});
