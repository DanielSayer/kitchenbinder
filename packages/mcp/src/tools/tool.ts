import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { Context } from "@prep-sheet/api/context";
import type { appRouter } from "@prep-sheet/api/routers/index";
import type { z } from "zod";

type Session = NonNullable<Context["session"]>;

/** Everything a tool may use. Domain rules stay behind the tRPC caller. */
export interface ToolContext {
  user: Session["user"];
  api: ReturnType<typeof appRouter.createCaller>;
}

/** A successful tool outcome: a short human summary plus JSON-safe data. */
export interface ToolOutput {
  summary: string;
  data: unknown;
}

export interface Tool<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: Input;
  annotations: ToolAnnotations;
  /** Rate-limit units consumed by one call. Defaults to 1. */
  cost?(input: z.output<Input>): number;
  /** Return an output, or throw `ToolError` for an expected failure. */
  run(input: z.output<Input>, context: ToolContext): Promise<ToolOutput>;
}

/** Identity helper that infers `Input` from the schema for typed handlers. */
export function defineTool<Input extends z.ZodObject>(
  tool: Tool<Input>,
): Tool<Input> {
  return tool;
}

const closedWorld = { openWorldHint: false } as const;

/** Behaviour hints only; they never grant user authorisation. */
export const behaviour = {
  read: {
    ...closedWorld,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  /** Adds data; a repeat without the same retry ID adds it again. */
  create: {
    ...closedWorld,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  /** Sets state; repeating the same call is harmless. */
  update: {
    ...closedWorld,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  remove: {
    ...closedWorld,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
} satisfies Record<string, ToolAnnotations>;
