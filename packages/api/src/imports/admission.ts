import { createHash } from "node:crypto";
import { db } from "@prep-sheet/db";
import { recipeImport, recipeImportPhoto } from "@prep-sheet/db/schema/import";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { refreshBillingIfStale } from "../billing/polar";
import { pricing } from "../billing/policy";
import {
  accountPlan,
  lockAccount,
  requireAiCredit,
  requireRecipeRoom,
  savedRecipeCount,
} from "../billing/usage";
import type { Database } from "../households/access";
import { type Placement, preparePlacement } from "../households/placement";
import type { UploadedPhoto } from "../photo-upload";
import { notifyImportWorker } from "../worker-wakeup";
import {
  photoDiscardSchema,
  photoImportSchema,
  websiteImportSchema,
} from "./contract";
import { importCounts } from "./counts";
import { logImport } from "./diagnostics";
import { admit, deletePhotos, tombstone } from "./lifecycle";
import { importStatus } from "./status";

type ImportInput = Placement & {
  id: string;
  content: string;
  sourceUrl: string | null;
  sourceKind: "website" | "photo";
  photos?: UploadedPhoto[];
};

const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

function fingerprintOf(input: ImportInput) {
  // "groupId" keeps fingerprints of imports admitted before households stable.
  return sha256(
    JSON.stringify({
      content: input.content,
      sourceUrl: input.sourceUrl,
      groupId: input.householdId,
      ...(input.collectionId ? { collectionId: input.collectionId } : {}),
      sourceKind: input.sourceKind,
      // A retry must resend the same photos; different photos conflict.
      ...(input.photos
        ? { photos: input.photos.map(({ data }) => sha256(data)) }
        : {}),
    }),
  );
}

function websiteInput(value: unknown): ImportInput {
  const input = websiteImportSchema.parse(value);
  return {
    id: input.id,
    content: input.input,
    householdId: input.householdId ?? null,
    collectionId: input.collectionId ?? null,
    sourceUrl: null,
    sourceKind: "website",
  };
}

export function submitWebsiteImport(userId: string, value: unknown) {
  return submit(userId, websiteInput(value));
}

/** Photos must already be checked by readPhotoUpload. */
export function submitPhotoImport(
  userId: string,
  value: unknown,
  photos: UploadedPhoto[],
) {
  const input = photoImportSchema.parse(value);
  return submit(userId, {
    id: input.id,
    content: input.input,
    householdId: input.householdId ?? null,
    collectionId: input.collectionId ?? null,
    sourceUrl: null,
    sourceKind: "photo",
    photos,
  });
}

export function discardWebsiteImport(userId: string, value: unknown) {
  const photo = photoDiscardSchema.safeParse(value);
  return discard(
    userId,
    photo.success
      ? { id: photo.data.id, sourceKind: "photo", fingerprint: null }
      : websiteInput(value),
  );
}

async function submit(userId: string, input: ImportInput) {
  const fingerprint = fingerprintOf(input);
  const [existing] = await db
    .select({ id: recipeImport.id })
    .from(recipeImport)
    .where(eq(recipeImport.id, input.id));
  // Recover admitted requests even if the billing provider is unavailable.
  if (!existing) await refreshBillingIfStale(userId);
  const admitted = await db.transaction(async (tx) => {
    // The only account lock. Admissions and retries are serialized per
    // account, so concurrent submissions cannot both pass a limit.
    await lockAccount(tx, userId);
    const [existing] = await tx
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, input.id));
    if (existing) {
      if (existing.userId !== userId || existing.fingerprint !== fingerprint)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This import ID has already been used. Recover the original import or capture again.",
        });
      return false;
    }
    await preparePlacement(tx, userId, input, { lock: false });
    const usageBucket = await checkLimits(tx, userId);
    const [collision] = await tx
      .select({ id: recipe.id })
      .from(recipe)
      .where(eq(recipe.id, input.id));
    if (collision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This recipe ID is already in use.",
      });
    await admit(tx, {
      id: input.id,
      userId,
      householdId: input.householdId,
      collectionId: input.collectionId,
      input: input.content,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl,
      fingerprint,
      usageBucket,
    });
    if (input.photos?.length)
      await tx.insert(recipeImportPhoto).values(
        input.photos.map((photo, position) => ({
          importId: input.id,
          position,
          mediaType: photo.mediaType,
          data: photo.data,
        })),
      );
    return true;
  });
  if (admitted) {
    logImport({
      event: "import_queued",
      importId: input.id,
      sourceKind: input.sourceKind,
    });
    await notifyImportWorker();
  }
  const status = await importStatus(userId, input.id);
  // Repeated submissions also recover a missed notification for an admitted job.
  if (!admitted && (status.kind === "queued" || status.kind === "processing"))
    await notifyImportWorker();
  return status;
}

/** Caller holds the account lock. Returns the bucket the attempt is charged to. */
async function checkLimits(tx: Database, userId: string) {
  const plan = await accountPlan(tx, userId);
  const counts = await importCounts(tx, userId, plan);
  if (counts.dailyAttempts >= pricing.ai.dailyAttemptsPerAccount)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `You've used your ${pricing.ai.dailyAttemptsPerAccount} AI attempts in the last 24 hours. Try again when an attempt expires.`,
    });
  requireRecipeRoom(plan, await savedRecipeCount(tx, userId), counts.inFlight);
  const usageBucket = requireAiCredit(plan, counts.aiAttempts);
  if (counts.inFlight >= pricing.ai.pendingPerAccount)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Your recipe queue is full. Wait for an import to finish.",
    });
  if (counts.recentSubmissions >= 5)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Please wait a minute before starting another import.",
    });
  return usageBucket;
}

// Photo discards match by ID only: a reloaded page no longer has the photos.
type DiscardInput =
  | ImportInput
  | { id: string; sourceKind: "photo"; fingerprint: null };

async function discard(userId: string, input: DiscardInput) {
  const fingerprint =
    "fingerprint" in input ? input.fingerprint : fingerprintOf(input);
  await db.transaction(async (tx) => {
    await lockAccount(tx, userId);
    const [existing] = await tx
      .select()
      .from(recipeImport)
      .where(eq(recipeImport.id, input.id));
    if (existing) {
      if (
        existing.userId !== userId ||
        (fingerprint !== null && existing.fingerprint !== fingerprint)
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "This import ID has already been used.",
        });
      if (existing.state !== "saved" && existing.state !== "failed")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Your import is still processing. Check it again shortly.",
        });
      await deletePhotos(tx, [input.id]);
      return;
    }
    const { recentSubmissions } = await importCounts(tx, userId);
    if (recentSubmissions >= 60)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Please wait a minute before cancelling another request.",
      });
    // A durable tombstone prevents a delayed submission from being accepted after reset.
    await tombstone(tx, {
      id: input.id,
      userId,
      householdId: "householdId" in input ? input.householdId : null,
      collectionId: "collectionId" in input ? input.collectionId : null,
      // Never a real fingerprint, so a delayed upload with this ID conflicts.
      fingerprint: fingerprint ?? "discarded",
      sourceUrl: "sourceUrl" in input ? input.sourceUrl : null,
      sourceKind: input.sourceKind,
      error:
        "This import was discarded. Start another import to save the recipe.",
    });
  });
  await notifyImportWorker();
}
