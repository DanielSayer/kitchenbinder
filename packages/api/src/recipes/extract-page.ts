import { type CheerioAPI, load } from "cheerio";
import { type ImageCandidate, imageCandidateSchema } from "../import-contract";

function findRecipe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(findRecipe).find(Boolean);
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const types = [object["@type"]].flat();
  if (types.includes("Recipe")) return object;
  return Object.values(object).map(findRecipe).find(Boolean);
}

function recipeMetadata($: CheerioAPI) {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const recipe = findRecipe(JSON.parse($(script).text()));
      if (recipe) return recipe as Record<string, unknown>;
    } catch {
      /* A page can contain unrelated or malformed metadata. */
    }
  }
}

export function extractPage(html: string) {
  const $ = load(html);
  const recipe = recipeMetadata($);
  if (recipe) return JSON.stringify(recipe).slice(0, 40000);
  $("script, style, nav, footer, header, aside, noscript, form").remove();
  const article = $("article, main").first();
  return (article.length ? article : $("body"))
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40000);
}

// schema.org image: a URL, an ImageObject, or a list of either.
export function metadataImages(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.flatMap((item) => metadataImages(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return metadataImages(object.url ?? object.contentUrl, depth + 1);
}

// Largest srcset entry, else the (possibly lazy-loaded) src.
function imageSource(attributes: Record<string, string | undefined>) {
  const srcset = attributes.srcset ?? attributes["data-srcset"];
  const largest = srcset
    ?.split(",")
    .map((entry) => entry.trim().split(/\s+/))
    .map(([url, size]) => ({ url, width: Number.parseInt(size ?? "", 10) }))
    .filter((entry) => entry.url && Number.isFinite(entry.width))
    .sort((a, b) => b.width - a.width)[0]?.url;
  return (
    largest ??
    attributes["data-src"] ??
    attributes["data-lazy-src"] ??
    attributes.src
  );
}

export function imageCandidates(
  values: { url: string | undefined; alt?: string; source: string }[],
  pageUrl: string,
): ImageCandidate[] {
  const seen = new Set<string>();
  const candidates: ImageCandidate[] = [];
  for (const value of values) {
    if (candidates.length >= 10) break;
    if (!value.url || /^data:|\.svg(?:$|\?)/i.test(value.url)) continue;
    let url: string;
    try {
      const resolved = new URL(value.url, pageUrl);
      resolved.hash = "";
      url = resolved.href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    const parsed = imageCandidateSchema.safeParse({
      url,
      alt: (value.alt ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      source: value.source,
    });
    if (!parsed.success) continue;
    seen.add(url);
    candidates.push(parsed.data);
  }
  return candidates;
}

export function extractImages(html: string, pageUrl: string) {
  const $ = load(html);
  const recipe = recipeMetadata($);
  const meta = (selector: string) => $(selector).first().attr("content");
  const content = $("article img, main img")
    .toArray()
    .filter((image) => {
      const { width, height } = image.attribs;
      return !(
        (width && Number(width) < 200) ||
        (height && Number(height) < 200)
      );
    })
    .slice(0, 8)
    .map((image) => ({
      url: imageSource(image.attribs),
      alt: image.attribs.alt,
      source: "content",
    }));
  return imageCandidates(
    [
      ...metadataImages(recipe?.image).map((url) => ({
        url,
        source: "recipe",
      })),
      { url: meta('meta[property="og:image"]'), source: "page" },
      { url: meta('meta[name="twitter:image"]'), source: "page" },
      ...content,
    ],
    pageUrl,
  );
}
