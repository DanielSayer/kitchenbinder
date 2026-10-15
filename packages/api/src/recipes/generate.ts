import { createOpenAI } from "@ai-sdk/openai";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { aiPolicy } from "@prep-sheet/env/ai-policy";
import { env } from "@prep-sheet/env/server";
import { TRPCError } from "@trpc/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { extractPage } from "./extract-page";
import { fetchPage, PAGE_ERROR, recipeUrl } from "./fetch-page";
import { buildRecipeSystemPrompt } from "./prompt";

const resultSchema = z.object({
  recipe: recipeContentSchema.nullable(),
  origin: z.enum(["imported", "generated"]),
  tagIds: z.array(z.string()).max(105),
});

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
) {
  const apiKey = requireRecipeProvider();
  const { content, sourceUrl } = await prepareRecipeInput(
    input,
    capturedSourceUrl,
  );
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
    return {
      content: output.recipe,
      tagIds: [...new Set(output.tagIds)].filter((id) =>
        tags.some((tag) => tag.id === id),
      ),
      sourceUrl,
      origin: sourceUrl ? ("imported" as const) : output.origin,
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
  if (!capturedSourceUrl && /^(https?:\/\/|www\.)/i.test(input)) {
    try {
      sourceUrl = recipeUrl(
        input.startsWith("www.") ? `https://${input}` : input,
      ).href;
      content = extractPage(await fetchPage(sourceUrl, undefined, 0, importId));
      if (content.length < 80) throw new Error(PAGE_ERROR);
    } catch (cause) {
      throw new TRPCError({ code: "BAD_REQUEST", message: PAGE_ERROR, cause });
    }
  }
  return { content, sourceUrl };
}
