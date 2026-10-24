import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { importInputSchema } from "../import-contract";
import { extractImages } from "./extract-page";
import { fetchImage } from "./fetch-page";
import { preferredImage, withImageChoices } from "./generate";
import { processPhoto } from "./media";

const page = "https://recipes.test/soup/";
const metadata = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe("image candidates", () => {
  it("puts the recipe's metadata images first, then page and content images", () => {
    const html = `<head>
      <meta property="og:image" content="/og.jpg">
      <meta name="twitter:image" content="https://cdn.test/og.jpg">
    </head>${metadata({
      "@graph": [
        {
          "@type": "Recipe",
          image: [
            { "@type": "ImageObject", url: "https://cdn.test/a.jpg" },
            "https://cdn.test/b.jpg#crop",
          ],
        },
      ],
    })}<main>
      <img src="/logo.svg" alt="Logo">
      <img src="data:image/png;base64,AAAA">
      <img src="/pixel.gif" width="1" height="1">
      <img data-src="/lazy.jpg" alt="  Soup  in a bowl ">
      <img srcset="/s.jpg 300w, /l.jpg 1200w" src="/s.jpg">
    </main>`;
    expect(extractImages(html, page)).toEqual([
      { url: "https://cdn.test/a.jpg", alt: "", source: "recipe" },
      { url: "https://cdn.test/b.jpg", alt: "", source: "recipe" },
      { url: "https://recipes.test/og.jpg", alt: "", source: "page" },
      { url: "https://cdn.test/og.jpg", alt: "", source: "page" },
      {
        url: "https://recipes.test/lazy.jpg",
        alt: "Soup in a bowl",
        source: "content",
      },
      { url: "https://recipes.test/l.jpg", alt: "", source: "content" },
    ]);
  });

  it("drops unsafe URLs and caps the list", () => {
    const images = Array.from(
      { length: 20 },
      (_, index) => `<img src="https://cdn.test/${index}.jpg">`,
    ).join("");
    const html = `<meta property="og:image" content="javascript:alert(1)"><meta name="twitter:image" content="https://user:pass@cdn.test/x.jpg"><article>${images}</article>`;
    const found = extractImages(html, page);
    expect(found).toHaveLength(8);
    expect(found.every(({ source }) => source === "content")).toBe(true);
  });
});

describe("image choice", () => {
  const page = {
    url: "https://cdn.test/p.jpg",
    alt: "",
    source: "page" as const,
  };
  const recipe = {
    url: "https://cdn.test/r.jpg",
    alt: "",
    source: "recipe" as const,
  };
  it("uses the metadata image without asking the AI", () => {
    const images = [page, recipe];
    expect(preferredImage(images)?.url).toBe(recipe.url);
    expect(withImageChoices("Soup", images)).toBe("Soup");
  });
  it("lists other candidates for the AI", () => {
    expect(withImageChoices("Soup", [])).toBe("Soup");
    expect(withImageChoices("Soup", [page])).toBe(
      `Soup\n\nImage candidates: [{"index":0,"url":"https://cdn.test/p.jpg","alt":"","source":"page"}]`,
    );
  });
  it("rejects malformed candidates from the extension", () => {
    const base = {
      id: crypto.randomUUID(),
      content: "x".repeat(80),
      sourceUrl: "https://recipes.test/soup",
    };
    expect(
      importInputSchema.safeParse({
        ...base,
        images: [{ url: "file:///etc/passwd", alt: "", source: "page" }],
      }).success,
    ).toBe(false);
    expect(
      importInputSchema.safeParse({
        ...base,
        images: Array(11).fill(page),
      }).success,
    ).toBe(false);
    expect(
      importInputSchema.safeParse({ ...base, images: [page] }).success,
    ).toBe(true);
  });
});

describe("photo processing", () => {
  it("writes two WebP widths without metadata or enlargement", async () => {
    const input = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#c04020" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "Someone" } } })
      .toBuffer();
    const photo = await processPhoto(input);
    expect(photo).toMatchObject({ width: 1200, height: 600 });
    expect(photo.color).toMatch(/^#[0-9a-f]{6}$/);
    for (const variant of photo.variants) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(variant.width);
      expect(meta.exif).toBeUndefined();
    }
    const small = await processPhoto(
      await sharp({
        create: { width: 300, height: 200, channels: 3, background: "#fff" },
      })
        .png()
        .toBuffer(),
    );
    expect(small).toMatchObject({ width: 300, height: 200 });
  });

  it("rejects non-images and oversized pixel counts", async () => {
    await expect(processPhoto(Buffer.from("not an image"))).rejects.toThrow();
    await expect(
      processPhoto(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        ),
      ),
    ).rejects.toThrow(/Unsupported photo format/);
    const huge = await sharp({
      create: { width: 8000, height: 6000, channels: 3, background: "#fff" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(processPhoto(huge)).rejects.toThrow(/pixel limit/i);
  });

  it("refuses to fetch images from private addresses", async () => {
    await expect(fetchImage("http://127.0.0.1/a.jpg")).rejects.toThrow(
      "Paste the recipe text",
    );
  });
});
