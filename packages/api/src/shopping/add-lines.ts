import { parseIngredient } from "@prep-sheet/db/ingredients";
import { shoppingItem } from "@prep-sheet/db/schema/shopping";
import { TRPCError } from "@trpc/server";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, resolveHousehold } from "../households/access";
import { checkCapacity } from "./trip";

export const itemText = z.string().trim().min(1).max(2000);
const line = z.object({ id: z.uuid(), text: itemText });

export const addLinesInput = z.object({
  // Omitted householdId = the caller's personal household.
  householdId: z.uuid().optional(),
  lines: z
    .array(line)
    .min(1)
    .max(100)
    .refine(
      (lines) => new Set(lines.map((entry) => entry.id)).size === lines.length,
      "Each line needs its own ID.",
    ),
});

/**
 * Adds free-text lines to a household's list in one go, in input order.
 * A line whose ID is already on this list with the same text is a no-op, so
 * retries are safe; a deleted line comes back. Changed text, or an ID used by
 * another household, is a conflict and nothing is added.
 */
export async function addLines(
  tx: Database,
  userId: string,
  input: z.output<typeof addLinesInput>,
) {
  const householdId = await resolveHousehold(tx, userId, input.householdId, {
    lock: true,
  });
  const existing = new Map(
    (
      await tx
        .select({
          id: shoppingItem.id,
          householdId: shoppingItem.householdId,
          text: shoppingItem.text,
        })
        .from(shoppingItem)
        .where(
          inArray(
            shoppingItem.id,
            input.lines.map((entry) => entry.id),
          ),
        )
    ).map((item) => [item.id, item]),
  );
  for (const { id, text } of input.lines) {
    const item = existing.get(id);
    if (item && item.householdId !== householdId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This item ID has already been used.",
      });
    if (item && item.text !== text)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This item ID is already on your list with different text. Use a new ID for a different item.",
      });
  }
  const additions = input.lines.flatMap(({ id, text }, position) =>
    existing.has(id)
      ? []
      : [
          {
            id,
            text,
            ingredient: parseIngredient(text),
            householdId,
            addedBy: userId,
            // Same-transaction rows share createdAt; position keeps input order.
            position,
          },
        ],
  );
  if (!additions.length) return;
  const [count] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(shoppingItem)
    .where(eq(shoppingItem.householdId, householdId));
  checkCapacity((count?.total ?? 0) + additions.length);
  await tx.insert(shoppingItem).values(additions);
}
