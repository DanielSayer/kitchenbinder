import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { failure, success, ToolError, toToolError } from "./result";

describe("tool results", () => {
  it("wraps JSON-safe data with a text summary", () => {
    expect(
      success({ summary: "Done.", data: { at: new Date(0), skip: undefined } }),
    ).toEqual({
      content: [{ type: "text", text: "Done." }],
      structuredContent: { data: { at: "1970-01-01T00:00:00.000Z" } },
    });
  });
  it("flags failures and merges the code into data", () => {
    expect(
      failure(new ToolError("CONFLICT", "Taken.", { mealId: "m" })),
    ).toEqual({
      content: [{ type: "text", text: "Taken." }],
      structuredContent: { data: { code: "CONFLICT", mealId: "m" } },
      isError: true,
    });
  });
  it("exposes router errors but hides internal and unknown errors", () => {
    expect(
      toToolError(new TRPCError({ code: "FORBIDDEN", message: "No access." })),
    ).toMatchObject({ code: "FORBIDDEN", message: "No access." });
    for (const error of [
      new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "db detail" }),
      Object.assign(new Error("duplicate key"), { code: "23505" }),
      "thrown string",
    ])
      expect(toToolError(error)).toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Kitchenbinder couldn't complete that action. Try again shortly.",
      });
  });
});
