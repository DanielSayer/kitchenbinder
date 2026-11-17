import type { CallToolResult } from "@modelcontextprotocol/server";
import { mcpResource } from "@prep-sheet/auth/oauth";
import { hasAssistantAccess } from "../entitlement";
import { toolWork } from "../limits";
import { failure, success, ToolError, toToolError } from "./result";
import type { Tool, ToolContext } from "./tool";

/** Runs before every tool; throw `ToolError` to refuse the call. */
type Guard = (
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolContext,
) => unknown;

const withinRateLimit: Guard = (tool, input, { user }) => {
  const retryAfter = toolWork.take(user.id, tool.cost?.(input) ?? 1);
  if (retryAfter !== null)
    throw new ToolError(
      "TOO_MANY_REQUESTS",
      `Too many requests. Try again in ${retryAfter} seconds.`,
      { retryAfter },
    );
};

// Checked on every call so lapsed subscriptions lose access immediately.
const hasProPlan: Guard = async (_tool, _input, { user }) => {
  if (await hasAssistantAccess(user.id)) return;
  const pricingUrl = new URL("/pricing", mcpResource).href;
  throw new ToolError(
    "PRO_REQUIRED",
    `Connecting an AI assistant is included with Kitchenbinder Pro. Choose or renew Pro at ${pricingUrl}`,
    { pricingUrl },
  );
};

const guards: Guard[] = [withinRateLimit, hasProPlan];

export async function invokeTool(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<CallToolResult> {
  try {
    for (const guard of guards) await guard(tool, input, context);
    return success(await tool.run(input, context));
  } catch (error) {
    const toolError = toToolError(error);
    if (toolError.code === "INTERNAL_SERVER_ERROR")
      console.error(
        JSON.stringify({ event: "mcp_tool_failed", tool: tool.name }),
      );
    return failure(toolError);
  }
}
