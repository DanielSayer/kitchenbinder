import { recipeImport, recipeImportPhoto } from "@prep-sheet/db/schema/import";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { Database } from "../households/access";

// Every write of an import's state goes through this file.

type ImportRow = typeof recipeImport.$inferSelect;
export type ImportState = ImportRow["state"];

/** Admitted imports that have not finished. They count against limits. */
export const inFlightStates = [
  "queued",
  "fetching",
  "processing",
  "ready",
] as const satisfies readonly ImportState[];
/** A worker is fetching or generating. Limited across every worker. */
export const activeStates = [
  "fetching",
  "processing",
] as const satisfies readonly ImportState[];
// Uploaded photos are only kept while generation may still start.
const photoStates: readonly ImportState[] = [
  "queued",
  "fetching",
  "processing",
];

const moves: Record<ImportState, readonly ImportState[]> = {
  queued: ["fetching"],
  // Fetching is safe to repeat, so an expired fetch is queued again.
  fetching: ["queued", "processing", "failed"],
  // Generation reached AI and is never replayed.
  processing: ["ready", "failed"],
  // Ready to ready claims or reschedules a save of the checkpoint.
  ready: ["ready", "saved", "failed"],
  saved: [],
  failed: [],
};

/** A worker's claim on one import. */
export type Claim = { id: string; workerToken: string };

/** Which rows a transition may change. */
export type Target =
  /** Only while the worker still holds its claim. */
  | { held: Claim }
  /** An unclaimed row this transaction has locked for update. */
  | { locked: string }
  /** Every row whose claim expired, whichever worker held it. */
  | { expired: SQL };

type Changes = Omit<
  Partial<typeof recipeImport.$inferInsert>,
  "id" | "userId" | "state"
>;

function guard(target: Target) {
  if ("held" in target)
    return and(
      eq(recipeImport.id, target.held.id),
      eq(recipeImport.workerToken, target.held.workerToken),
    );
  if ("locked" in target) return eq(recipeImport.id, target.locked);
  return target.expired;
}

/** Moves the targeted rows still in `from`. Returns the IDs that moved. */
export async function transition(
  database: Database,
  target: Target,
  from: ImportState | readonly ImportState[],
  to: ImportState,
  changes: Changes = {},
) {
  const sources: readonly ImportState[] =
    typeof from === "string" ? [from] : from;
  for (const source of sources)
    if (!moves[source].includes(to))
      throw new Error(`An import cannot move from ${source} to ${to}.`);
  const moved = await database
    .update(recipeImport)
    .set({ ...changes, state: to })
    .where(and(inArray(recipeImport.state, sources), guard(target)))
    .returning({ id: recipeImport.id });
  const ids = moved.map(({ id }) => id);
  if (
    !photoStates.includes(to) &&
    sources.some((source) => photoStates.includes(source))
  )
    await deletePhotos(database, ids);
  return ids;
}

type Admitted = Omit<
  typeof recipeImport.$inferInsert,
  "state" | "workerToken" | "startedAt"
>;

export async function admit(database: Database, values: Admitted) {
  await database.insert(recipeImport).values({ ...values, state: "queued" });
}

/** A failed row that holds an import ID, so a delayed submission is refused. */
export async function tombstone(
  database: Database,
  values: Omit<Admitted, "usageReleased" | "usageBucket" | "input">,
) {
  await database.insert(recipeImport).values({
    ...values,
    input: "",
    state: "failed",
    usageReleased: true,
  });
}

export async function deletePhotos(database: Database, ids: string[]) {
  if (ids.length)
    await database
      .delete(recipeImportPhoto)
      .where(inArray(recipeImportPhoto.importId, ids));
}
