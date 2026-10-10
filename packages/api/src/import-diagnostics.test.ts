import { afterEach, expect, it, vi } from "vitest";
import { importFailure, logImport } from "./import-diagnostics";

afterEach(() => vi.restoreAllMocks());

it("retains useful failure codes without exposing exception data or causes", () => {
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const cause = Object.assign(
    new Error("Bearer secret-key; private recipe text"),
    {
      statusCode: 429,
      responseBody: "private provider response",
      url: "https://example.com/private?token=secret",
      requestBodyValues: { prompt: "private recipe" },
    },
  );
  const error = Object.assign(
    new Error("private account and database details", { cause }),
    {
      code: "BAD_GATEWAY",
    },
  );
  logImport({
    event: "import_failed",
    importId: "test-reference",
    stage: "generating",
    elapsedMs: 100,
    usageReleased: false,
    failure: importFailure(error),
  });
  const line = String(write.mock.calls[0]?.[0]);
  expect(JSON.parse(line)).toMatchObject({
    importId: "test-reference",
    stage: "generating",
    failure: { type: "Error", code: "BAD_GATEWAY", statusCode: 429 },
  });
  expect(line).not.toMatch(/secret|private|Bearer|example\.com|prompt/);
});

it("drops arbitrary error codes and names instead of treating them as safe diagnostics", () => {
  const error = Object.assign(new Error("private data"), {
    name: "private details: token",
    code: "https://example.com/?token=secret",
  });
  expect(importFailure(error)).toEqual({ type: "UnknownError" });
  expect(importFailure("secret-key")).toEqual({ type: "UnknownError" });
});
