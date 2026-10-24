import type { CaptureResult } from "./capture-contract";

// Serialized by scripting.executeScript. Keep all runtime dependencies inside this
// function. It runs in the isolated world, reads the loaded DOM and never fetches.
export function extractRecipe(): CaptureResult {
  const error = (
    code: Extract<CaptureResult, { kind: "error" }>["code"],
  ): CaptureResult => ({ kind: "error", code });
  const url = new URL(location.href);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    document.contentType !== "text/html"
  )
    return error("unsupported");
  // Query strings and fragments can contain account tokens or tracking data.
  url.search = "";
  url.hash = "";
  if (url.href.length > 4096) return error("too-large");
  const clean = (value: string) =>
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const heading = clean(
    `${document.title} ${document.querySelector("h1")?.textContent ?? ""}`,
  );
  if (
    /just a moment|checking your browser|verify (?:you are|you're) human|security verification|attention required|access denied/i.test(
      heading,
    ) ||
    document.querySelector(
      "#challenge-running, #challenge-stage, form#challenge-form",
    )
  )
    return error("challenge");
  type Recipes = Extract<CaptureResult, { kind: "captured" }>["recipes"];
  type Image = NonNullable<Recipes[number]["images"]>[number];
  const recipes: Recipes = [];
  let oversized = false;
  // Absolute, credential-free http(s) photo URLs. The server fetches them.
  const imageList = (
    values: { url: unknown; alt?: unknown; source: Image["source"] }[],
  ) => {
    const images: Image[] = [];
    for (const value of values) {
      if (images.length >= 10) break;
      if (
        typeof value.url !== "string" ||
        /^data:|\.svg(?:$|\?)/i.test(value.url)
      )
        continue;
      try {
        const image = new URL(value.url, location.href);
        image.hash = "";
        if (
          !["http:", "https:"].includes(image.protocol) ||
          image.username ||
          image.password ||
          image.href.length > 2048 ||
          images.some((item) => item.url === image.href)
        )
          continue;
        images.push({
          url: image.href,
          alt:
            typeof value.alt === "string" ? clean(value.alt).slice(0, 200) : "",
          source: value.source,
        });
      } catch {
        /* Skip malformed image URLs. */
      }
    }
    return images;
  };
  const meta = (selector: string) =>
    document.querySelector(selector)?.getAttribute("content");
  const pageImages = [
    { url: meta('meta[property="og:image"]'), source: "page" as const },
    { url: meta('meta[name="twitter:image"]'), source: "page" as const },
  ];
  const contentImages = (root: ParentNode) =>
    [...root.querySelectorAll("img")]
      .filter((image) => image.naturalWidth >= 200 || image.width >= 200)
      .slice(0, 8)
      .map((image) => ({
        url: image.currentSrc || image.src,
        alt: image.alt,
        source: "content" as const,
      }));
  const add = (
    title: string,
    content: string,
    format: "json-ld" | "text",
    images: Image[],
  ) => {
    if (content.length > 32_000 || recipes.length >= 10) {
      oversized = true;
      return;
    }
    if (!recipes.some((recipe) => recipe.content === content))
      recipes.push({
        title: clean(title).slice(0, 300) || "Untitled recipe",
        content,
        format,
        ...(images.length ? { images } : {}),
      });
  };
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : undefined;
  // schema.org image: a URL, an ImageObject, or a list of either.
  const metadataImages = (value: unknown, depth = 0): unknown[] => {
    if (depth > 3) return [];
    if (Array.isArray(value))
      return value.flatMap((item) => metadataImages(item, depth + 1));
    const item = record(value);
    return item
      ? metadataImages(item.url ?? item.contentUrl, depth + 1)
      : [value];
  };
  let visited = 0;
  const instructions = (value: unknown, depth = 0): string[] => {
    if (depth > 12 || ++visited > 10_000) {
      oversized = true;
      return [];
    }
    if (typeof value === "string") return [clean(value)].filter(Boolean);
    if (Array.isArray(value))
      return value.flatMap((item) => instructions(item, depth + 1));
    const item = record(value);
    if (!item) return [];
    return [
      ...(typeof item.text === "string" ? [clean(item.text)] : []),
      ...instructions(item.itemListElement, depth + 1),
    ];
  };
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 20 || ++visited > 10_000) {
      oversized = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const item = record(value);
    if (!item) return;
    const types = Array.isArray(item["@type"])
      ? item["@type"]
      : [item["@type"]];
    if (
      types.some(
        (type) =>
          typeof type === "string" &&
          /^(?:https?:\/\/schema\.org\/)?Recipe$/.test(type),
      )
    ) {
      const ingredients = Array.isArray(item.recipeIngredient)
        ? item.recipeIngredient
            .filter((entry): entry is string => typeof entry === "string")
            .map(clean)
            .filter(Boolean)
        : [];
      const steps = instructions(item.recipeInstructions);
      if (ingredients.length && steps.length) {
        const name =
          typeof item.name === "string"
            ? item.name
            : document.querySelector("h1")?.textContent || document.title;
        // Allowlist recipe fields. Never return author, reviews, arbitrary JSON or HTML.
        const metadata = [
          "recipeYield",
          "prepTime",
          "cookTime",
          "totalTime",
        ].flatMap((key) =>
          typeof item[key] === "string" ? [`${key}: ${clean(item[key])}`] : [],
        );
        add(
          name,
          [
            clean(name),
            ...metadata,
            "Ingredients",
            ...ingredients,
            "Instructions",
            ...steps,
          ].join("\n"),
          "json-ld",
          imageList([
            ...metadataImages(item.image).map((url) => ({
              url,
              source: "recipe" as const,
            })),
            ...pageImages,
          ]),
        );
      }
    }
    for (const nested of Object.values(item))
      if (typeof nested === "object" && nested !== null)
        visit(nested, depth + 1);
  };
  let jsonSize = 0;
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    const raw = script.textContent ?? "";
    jsonSize += raw.length;
    if (jsonSize > 1_000_000) {
      oversized = true;
      break;
    }
    try {
      visit(JSON.parse(raw));
    } catch {
      /* Malformed metadata can fall back to visible text. */
    }
  }
  if (!recipes.length && !oversized) {
    const excluded =
      'script, style, noscript, template, form, input, textarea, select, button, nav, footer, aside, iframe, [hidden], [aria-hidden="true"], [contenteditable], [role="dialog"], [role="navigation"], [role="form"], .comments, #comments, [class*="account"], [class*="newsletter"], [class*="cookie"], [class*="social"]';
    const visibleText = (root: Element) => {
      for (
        let ancestor: Element | null = root;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        if (
          ancestor.matches(excluded) ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return "";
      }
      const parts: string[] = [];
      let size = 0;
      let nodes = 0;
      const walk = (node: Node, depth: number): void => {
        if (++nodes > 20_000 || depth > 100 || size > 32_000) {
          oversized = true;
          return;
        }
        if (node instanceof Element) {
          if (node.matches(excluded)) return;
          const style = getComputedStyle(node);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.opacity === "0"
          )
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const text = clean(node.textContent ?? "");
          if (text) {
            parts.push(text);
            size += text.length + 1;
          }
        } else
          for (const child of node.childNodes) {
            if (oversized) break;
            walk(child, depth + 1);
          }
      };
      walk(root, 0);
      return parts.join("\n");
    };
    const cards = [
      ...document.querySelectorAll(
        '.wprm-recipe-container, .tasty-recipes, .recipe-card, [itemtype$="/Recipe"]',
      ),
    ];
    const roots = cards.length
      ? cards.filter(
          (card) =>
            !cards.some((other) => other !== card && other.contains(card)),
        )
      : [...document.querySelectorAll("main, article")].filter(
          (node) => !node.parentElement?.closest("main, article"),
        );
    for (const root of roots.slice(0, 11)) {
      const content = visibleText(root);
      if (
        /\bingredients\b/i.test(content) &&
        /\b(instructions|directions|method|preparation)\b/i.test(content) &&
        content.length >= 100
      )
        add(
          root.querySelector("h1, h2, .wprm-recipe-name")?.textContent ||
            document.title,
          content,
          "text",
          imageList([...pageImages, ...contentImages(root)]),
        );
    }
  }
  const result: CaptureResult = {
    kind: "captured",
    sourceUrl: url.href,
    recipes,
  };
  // Photos are optional; never let them make a capture too large.
  if (JSON.stringify(result).length > 128_000)
    for (const recipe of recipes) delete recipe.images;
  if (oversized || JSON.stringify(result).length > 128_000)
    return error("too-large");
  return recipes.length ? result : error("missing");
}
