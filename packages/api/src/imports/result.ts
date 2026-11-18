import type { Stage } from "./diagnostics";

/** What one call to processNext did. */
export type ProcessResult =
  /** Nothing was eligible to claim. */
  | { kind: "idle" }
  | { kind: "saved"; importId: string; recipes: number }
  /** Saving the checkpoint failed; a later attempt saves it without calling AI again. */
  | { kind: "retrying"; importId: string; attempt: number; delayMs: number }
  /** The import is finished without recipes. Released usage was never charged. */
  | { kind: "failed"; importId: string; stage: Stage; usageReleased: boolean }
  /** Another worker took over after this worker's claim expired. */
  | { kind: "lost"; importId: string };
