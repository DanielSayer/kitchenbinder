import { z } from "zod";

/** Spread into a tool input to make it household-scoped. */
export const householdScope = {
  householdId: z
    .uuid()
    .optional()
    .describe(
      "Household ID from get_account_overview. Omit for your personal household. There is no server-side current-household selection.",
    ),
};

export const textLine = z.string().trim().min(1).max(2000);
export const textLines = z.array(textLine).min(1).max(100);
export const portionCount = z.number().int().min(1).max(100);
export const mealSlot = z.enum(["", "Breakfast", "Lunch", "Dinner"]);

/** Client-chosen ID that makes an identical retry safe. */
export function retryId(description: string) {
  return z.uuid().optional().describe(description);
}
