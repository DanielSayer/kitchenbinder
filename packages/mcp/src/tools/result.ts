import type { CallToolResult } from "@modelcontextprotocol/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ToolOutput } from "./tool";

/** An expected failure that the assistant should see and can act on. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ToolError";
  }
}

const jsonValue = z.json();

function toResult(text: string, data: unknown, isError: boolean) {
  // Dates become ISO strings; strip database-specific prototypes at the boundary.
  const value = jsonValue.parse(JSON.parse(JSON.stringify(data)));
  return {
    content: [{ type: "text", text }],
    structuredContent: { data: value },
    ...(isError ? { isError: true } : {}),
  } satisfies CallToolResult;
}

export function success({ summary, data }: ToolOutput): CallToolResult {
  return toResult(summary, data, false);
}

export function failure(error: ToolError): CallToolResult {
  return toResult(error.message, { code: error.code, ...error.details }, true);
}

/**
 * Map any thrown value to a `ToolError`. Router validation and permission
 * errors are user-facing; anything else is hidden behind a generic message.
 */
export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR")
    return new ToolError(error.code, error.message);
  return new ToolError(
    "INTERNAL_SERVER_ERROR",
    "Kitchenbinder couldn't complete that action. Try again shortly.",
  );
}
