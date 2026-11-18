// The import module's only public interface. An import turns a website or
// photos into recipes: queued, fetching, processing (AI), ready (checkpoint
// stored), then saved or failed. See lifecycle.ts for the allowed moves.
//
// contract.ts and diagnostics.ts have no dependencies. Modules the import
// module itself uses (recipes/generate, fetch-page, extract-page, worker-wakeup)
// import them directly to avoid a cycle.

export {
  discardWebsiteImport,
  submitPhotoImport,
  submitWebsiteImport,
} from "./admission";
export {
  type ImageCandidate,
  type ImportStatus,
  imageCandidateSchema,
  photoDiscardSchema,
  photoImportLimits,
  photoImportSchema,
  recipesPerImport,
  websiteImportSchema,
} from "./contract";
export { type AiPeriod, importCounts } from "./counts";
export { importFailure, logImport, type Stage } from "./diagnostics";
export { inspectQueue, type ProcessOptions, processNext } from "./queue";
export type { ProcessResult } from "./result";
export { importStatus, recentImports } from "./status";
