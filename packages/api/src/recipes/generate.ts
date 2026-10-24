import { createOpenAI } from "@ai-sdk/openai";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { aiPolicy } from "@prep-sheet/env/ai-policy";
import { env } from "@prep-sheet/env/server";
import { TRPCError } from "@trpc/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { ImageCandidate } from "../import-contract";
import { extractImages, extractPage } from "./extract-page";
import { fetchPage, PAGE_ERROR, recipeUrl } from "./fetch-page";
import { buildRecipeSystemPrompt } from "./prompt";

const resultSchema = z.object({
  recipe: recipeContentSchema.nullable(),
  origin: z.enum(["imported", "generated"]),
  tagIds: z.array(z.string()).max(105),
  imageIndex: z.number().int().nullable(),
});

// The recipe's own metadata image wins; otherwise the AI may choose one.
export function preferredImage(images: readonly ImageCandidate[]) {
  return images.find((image) => image.source === "recipe");
}

export function withImageChoices(
  content: string,
  images: readonly ImageCandidate[],
) {
  if (!images.length || preferredImage(images)) return content;
  return `${content}

Image candidates: ${JSON.stringify(images.map(({ url, alt, source }, index) => ({ index, url, alt, source })))}`;
}

export function requireRecipeProvider(apiKey = env.OPENAI_API_KEY) {
  if (!apiKey?.trim())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Recipe creation is temporarily unavailable. Please try again later or add a recipe manually.",
    });
  return apiKey.trim();
}

export async function generateRecipe(
  input: string,
  tags: { id: string; name: string; description: string }[] = [],
  capturedSourceUrl?: string,
  capturedImages: ImageCandidate[] = [],
) {
  const apiKey = requireRecipeProvider();
  const prepared = await prepareRecipeInput(input, capturedSourceUrl);
  const { sourceUrl } = prepared;
  const images = capturedSourceUrl ? capturedImages : prepared.images;
  const content = withImageChoices(prepared.content, images);
  const system = recipeSystemPrompt(content, tags, sourceUrl);
  try {
    const { output } = await generateText({
      model: createOpenAI({ apiKey })(env.OPENAI_MODEL),
      output: Output.object({ schema: resultSchema }),
      maxOutputTokens: aiPolicy.maxOutputTokens,
      maxRetries: 0,
      providerOptions: { openai: { serviceTier: "default" } },
      abortSignal: AbortSignal.timeout(90000),
      system,
      prompt: content,
    });
    if (!output.recipe)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: sourceUrl
          ? PAGE_ERROR
          : "I couldn't find one complete recipe. Paste ingredients and steps, or describe a dish you'd like to make.",
      });
    const origin = sourceUrl ? ("imported" as const) : output.origin;
    const imageUrl =
      origin === "imported"
        ? (preferredImage(images)?.url ??
          (output.imageIndex === null
            ? undefined
            : images[output.imageIndex]?.url) ??
          null)
        : null;
    return {
      content: output.recipe,
      tagIds: [...new Set(output.tagIds)].filter((id) =>
        tags.some((tag) => tag.id === id),
      ),
      sourceUrl,
      origin,
      imageUrl,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (
      error instanceof Error &&
      /no credits|insufficient_quota|exceeded your current quota/i.test(
        error.message,
      )
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Recipe creation is paused because the OpenAI API account has no credits. Add API credits, then try again.",
      });
    }
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message:
        "Recipe creation didn't finish. Your input is still here. Please try again.",
      cause: error,
    });
  }
}

export function recipeSystemPrompt(
  content: string,
  tags: { id: string; name: string; description: string }[],
  sourceUrl?: string | null,
) {
  const system = buildRecipeSystemPrompt(sourceUrl ? "web" : "input", tags);
  if (
    Buffer.byteLength(content, "utf8") > aiPolicy.maxContentBytes ||
    Buffer.byteLength(system, "utf8") > aiPolicy.maxSystemBytes
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This recipe input is too large. Shorten the recipe text or available tags and try again.",
    });
  return system;
}

export async function prepareRecipeInput(
  input: string,
  capturedSourceUrl?: string,
  importId?: string,
) {
  let sourceUrl: string | null = capturedSourceUrl ?? null;
  let content = input;
  let images: ImageCandidate[] = [];
  if (!capturedSourceUrl && /^(https?:\/\/|www\.)/i.test(input)) {
    try {
      sourceUrl = recipeUrl(
        input.startsWith("www.") ? `https://${input}` : input,
      ).href;
      const html = await fetchPage(sourceUrl, undefined, 0, importId);
      content = extractPage(html);
      if (content.length < 80) throw new Error(PAGE_ERROR);
      images = extractImages(html, sourceUrl);
    } catch (cause) {
      throw new TRPCError({ code: "BAD_REQUEST", message: PAGE_ERROR, cause });
    }
  }
  return { content, sourceUrl, images };
}
